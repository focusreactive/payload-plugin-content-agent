import { describe, it, expect, vi, afterEach } from "vitest";

const lookup = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({ default: { lookup } }));

import { createLinkProbe } from "../src/agent/tools/linkProbe.js";

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];
const PRIVATE = [{ address: "10.0.0.5", family: 4 }];

const res = (status: number, location?: string) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(location ? { location } : {}),
  }) as Response;

describe("the link probe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    lookup.mockReset();
  });

  it("404 and 410 are missing; 2xx is ok", async () => {
    lookup.mockResolvedValue(PUBLIC);

    for (const [status, want] of [
      [404, "missing"],
      [410, "missing"],
      [200, "ok"],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => res(status))
      );
      expect(await createLinkProbe()("https://site.test/p/")).toBe(want);
    }
  });

  it("follows a redirect and judges the page it lands on", async () => {
    lookup.mockResolvedValue(PUBLIC);
    const fetch = vi.fn(async (url: string) => (url.endsWith("/p") ? res(301, "/p/") : res(404)));

    vi.stubGlobal("fetch", fetch);
    expect(await createLinkProbe()("https://site.test/p")).toBe("missing");
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "https://site.test/p",
      "https://site.test/p/",
    ]);
  });

  it("auth walls, server errors, timeouts and network failures are unknown, never missing", async () => {
    lookup.mockResolvedValue(PUBLIC);

    for (const status of [401, 403, 429, 500, 503]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => res(status))
      );
      expect(await createLinkProbe()("https://site.test/p/")).toBe("unknown");
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    expect(await createLinkProbe()("https://site.test/p/")).toBe("unknown");
  });

  it("falls back to GET when HEAD is refused", async () => {
    lookup.mockResolvedValue(PUBLIC);
    const fetch = vi.fn(async (_u: string, init: any) =>
      init.method === "HEAD" ? res(405) : res(404)
    );

    vi.stubGlobal("fetch", fetch);
    expect(await createLinkProbe()("https://site.test/p/")).toBe("missing");
    expect(fetch.mock.calls.map((c) => c[1].method)).toEqual(["HEAD", "GET"]);
  });

  it("does not call a host on a private address, and never calls it missing", async () => {
    lookup.mockResolvedValue(PRIVATE);
    const fetch = vi.fn(async () => res(404));

    vi.stubGlobal("fetch", fetch);
    expect(await createLinkProbe()("https://intranet.test/p/")).toBe("unknown");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls the project's own host also on a private address", async () => {
    lookup.mockResolvedValue(PRIVATE);
    const fetch = vi.fn(async () => res(404));

    vi.stubGlobal("fetch", fetch);
    const probe = createLinkProbe("http://localhost:3000");

    expect(await probe("http://localhost:3000/p/")).toBe("missing");
    expect(await probe("http://localhost:4000/p/")).toBe("unknown");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not follow a redirect from the project's own host to another private host", async () => {
    lookup.mockResolvedValue(PRIVATE);
    const fetch = vi.fn(async () => res(302, "http://169.254.169.254/latest/meta-data/"));

    vi.stubGlobal("fetch", fetch);
    expect(await createLinkProbe("http://localhost:3000")("http://localhost:3000/p/")).toBe(
      "unknown"
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
