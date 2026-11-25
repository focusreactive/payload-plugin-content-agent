import { describe, it, expect } from "vitest";
import { normalizeSlug, mcpToolName } from "../src/agent/mcpNames.js";

describe("normalizeSlug mirrors plugin-mcp toCamelCase", () => {
  it("collapses hyphens, underscores, and spaces", () => {
    expect(normalizeSlug("blog-posts")).toBe("blogposts");
    expect(normalizeSlug("site_pages")).toBe("sitepages");
    expect(normalizeSlug("my collection")).toBe("mycollection");
    expect(mcpToolName("update", "site_pages")).toBe("updatesitepages");
  });
});
