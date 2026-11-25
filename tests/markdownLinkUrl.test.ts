import { describe, expect, it } from "vitest";
import { linkUrlFromMatch } from "../src/agent/subAgents/lexicalMarkdown.js";

describe("linkUrlFromMatch (lexical 0.41 vs 0.50 LINK transformer groups)", () => {
  it("reads the url from the lexical 0.41 shape [full, text, url, title]", () => {
    expect(
      linkUrlFromMatch(["[Sanity](https://www.sanity.io)", "Sanity", "https://www.sanity.io", null])
    ).toBe("https://www.sanity.io");
  });
  it("reads the url from the lexical 0.50 shape [full, text, <url>, url, titles...]", () => {
    expect(
      linkUrlFromMatch([
        "[Sanity](https://www.sanity.io)",
        "Sanity",
        null,
        "https://www.sanity.io",
        null,
        null,
        null,
      ])
    ).toBe("https://www.sanity.io");
    expect(
      linkUrlFromMatch(["[x](<https://a.b/c d>)", "x", "https://a.b/c d", null, null, null, null])
    ).toBe("https://a.b/c d");
  });
  it("falls back to parsing the match text when no group carries the url", () => {
    expect(linkUrlFromMatch(["[x](https://fallback.io)", "x"])).toBe("https://fallback.io");
    expect(linkUrlFromMatch(["[x]()", "x", null])).toBe("");
  });
});
