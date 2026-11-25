import { afterEach, describe, expect, it, vi } from "vitest";
import { createSiteLinkProbe } from "../src/agent/tools/linkProbe.js";

afterEach(() => vi.unstubAllGlobals());

describe("the link probe of a caller from outside the site", () => {
  it("sends no request to a host other than the site's own", async () => {
    const fetch = vi.fn();

    vi.stubGlobal("fetch", fetch);

    expect(await createSiteLinkProbe("https://site.example")("https://outside.example/a")).toBe(
      "unknown"
    );
    expect(await createSiteLinkProbe(undefined)("https://outside.example/a")).toBe("unknown");
    expect(await createSiteLinkProbe("https://site.example")("not a url")).toBe("unknown");
    expect(fetch).not.toHaveBeenCalled();
  });
});
