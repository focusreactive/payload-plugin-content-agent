import { describe, it, expect, vi, afterEach } from "vitest";

const lookup = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({ default: { lookup } }));

import http from "node:http";
import type { AddressInfo } from "node:net";
import { Agent } from "undici";
import { pinnedAgent, safeFetch } from "../src/agent/tools/web.js";

const res = (status: number, location?: string) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(location ? { location } : {}),
  }) as Response;

const answers = (...addresses: string[]) =>
  addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

function stubFetch(handler: (url: string) => Response = () => res(200)) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => handler(url));

  vi.stubGlobal("fetch", fetch);

  return fetch;
}

describe("safeFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    lookup.mockReset();
  });

  it("fetches a host on a public address", async () => {
    lookup.mockResolvedValue(answers("93.184.216.34"));
    const fetch = stubFetch();
    const out = await safeFetch("https://example.com/a", {});

    expect(out.error).toBeUndefined();
    expect(out.finalUrl).toBe("https://example.com/a");
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it.each([
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:8.8.8.8]/",
    "http://[64:ff9b::169.254.169.254]/",
    "http://[64:ff9b::a00:5]/",
    "http://[64:ff9b:1::a00:5]/",
    "http://[2002:a9fe:a9fe::]/",
    "http://[2001:0:4136:e378:8000:63bf:f5ff:fffa]/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://240.0.0.1/",
  ])("refuses the private or internal address %s", async (url) => {
    const fetch = stubFetch();
    const out = await safeFetch(url, {});

    expect(out.error).toBe("Refusing to fetch private/internal address");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "http://8.8.8.8/",
    "http://172.32.0.1/",
    "http://100.128.0.1/",
    "http://[2001:4860::1]/",
    "http://[64:ff9b::808:808]/",
    "http://[2002:808:808::]/",
  ])("fetches the public address %s next to a private range", async (url) => {
    stubFetch();

    expect((await safeFetch(url, {})).error).toBeUndefined();
  });

  it.each(["file:///etc/passwd", "ftp://example.com/a", "gopher://example.com/", "not a url"])(
    "refuses %s",
    async (url) => {
      const fetch = stubFetch();
      const out = await safeFetch(url, {});

      expect(out.error).toMatch(/Disallowed URL scheme|Invalid URL/u);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("refuses a name when any of its addresses is private", async () => {
    lookup.mockResolvedValue(answers("93.184.216.34", "10.0.0.5"));
    const fetch = stubFetch();
    const out = await safeFetch("https://mixed.test/", {});

    expect(out.error).toBe("Refusing to fetch private/internal address");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a name that does not resolve", async () => {
    lookup.mockRejectedValue(new Error("ENOTFOUND"));

    expect((await safeFetch("https://nowhere.test/", {})).error).toBe("Failed to resolve hostname");
  });

  it("checks every redirect hop and refuses one that leads to a private address", async () => {
    lookup.mockResolvedValue(answers("93.184.216.34"));
    const fetch = stubFetch(() => res(302, "http://127.0.0.1:8080/admin"));
    const out = await safeFetch("https://example.com/a", {});

    expect(out.error).toBe("Refusing to fetch private/internal address");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("follows a relative redirect on the same host", async () => {
    lookup.mockResolvedValue(answers("93.184.216.34"));
    stubFetch((url) => (url.endsWith("/a") ? res(301, "/b") : res(200)));
    const out = await safeFetch("https://example.com/a", {});

    expect(out.finalUrl).toBe("https://example.com/b");
  });

  it("stops after too many redirects and on a redirect with no target", async () => {
    lookup.mockResolvedValue(answers("93.184.216.34"));
    stubFetch(() => res(302, "/again"));
    expect((await safeFetch("https://example.com/a", {})).error).toBe("Too many redirects (>3)");

    stubFetch(() => res(302));
    expect((await safeFetch("https://example.com/a", {})).error).toMatch(
      /redirect with no Location/u
    );
  });

  it("fetches a trusted host on a private address, and only that host and port", async () => {
    lookup.mockResolvedValue(answers("127.0.0.1"));
    const fetch = stubFetch();
    const trustedHosts = new Set(["localhost:3000"]);

    expect((await safeFetch("http://localhost:3000/a", { trustedHosts })).error).toBeUndefined();
    expect((await safeFetch("http://LOCALHOST:3000/a", { trustedHosts })).error).toBeUndefined();
    expect((await safeFetch("http://localhost:3001/a", { trustedHosts })).error).toBe(
      "Refusing to fetch private/internal address"
    );
    expect((await safeFetch("http://localhost.evil.test:3000/a", { trustedHosts })).error).toBe(
      "Refusing to fetch private/internal address"
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("trustedHosts");
  });

  it("keeps the scheme rule for a trusted host", async () => {
    const out = await safeFetch("ftp://localhost:3000/a", {
      trustedHosts: new Set(["localhost:3000"]),
    });

    expect(out.error).toMatch(/Disallowed URL scheme/u);
  });
});

const dispatcherOf = (fetch: ReturnType<typeof stubFetch>, call = 0) =>
  (fetch.mock.calls[call][1] as { dispatcher?: unknown }).dispatcher;

describe("safeFetch: the checked address stays the one in use (DNS rebinding)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    lookup.mockReset();
  });

  it("resolves a name once and pins the request to the checked addresses", async () => {
    lookup.mockResolvedValue(answers("93.184.216.34"));
    const fetch = stubFetch();

    await safeFetch("https://example.com/a", {});

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(dispatcherOf(fetch)).toBeInstanceOf(Agent);
  });

  it("checks and pins again on every redirect hop", async () => {
    lookup.mockResolvedValue(answers("93.184.216.34"));
    const fetch = stubFetch((url) =>
      url.endsWith("/a") ? res(301, "https://other.test/b") : res(200)
    );

    await safeFetch("https://example.com/a", {});

    expect(lookup.mock.calls.map((call) => call[0])).toEqual(["example.com", "other.test"]);
    expect(dispatcherOf(fetch, 0)).toBeInstanceOf(Agent);
    expect(dispatcherOf(fetch, 1)).toBeInstanceOf(Agent);
    expect(dispatcherOf(fetch, 1)).not.toBe(dispatcherOf(fetch, 0));
  });

  it("pins nothing for an address literal or a trusted host", async () => {
    const fetch = stubFetch();

    await safeFetch("http://8.8.8.8/", {});
    await safeFetch("http://localhost:3000/a", { trustedHosts: new Set(["localhost:3000"]) });

    expect(dispatcherOf(fetch, 0)).toBeUndefined();
    expect(dispatcherOf(fetch, 1)).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("connects to the pinned address and asks DNS for nothing", async () => {
    const server = http.createServer((req, response) => response.end(`host=${req.headers.host}`));

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      // The name does not exist: the request can only arrive through the pinned address.
      const response = await fetch(`http://rebound.invalid:${port}/`, {
        dispatcher: pinnedAgent([{ address: "127.0.0.1", family: 4 }]),
      } as RequestInit);

      expect(await response.text()).toBe(`host=rebound.invalid:${port}`);
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});
