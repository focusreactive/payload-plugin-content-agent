import { describe, it, expect } from "vitest";
import {
  analyzeToolCoverage,
  collectionsWithNoTools,
  buildToolAvailabilityNote,
} from "../src/agent/toolCoverage.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "media",
      fields: [],
      hasVersions: false,
      hasDrafts: false,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "pages",
      fields: [],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "site-settings",
      fields: [],
      hasVersions: false,
      hasDrafts: false,
      hasAuth: false,
      timestamps: false,
    },
  ],
};

const mcpTools = {
  findPosts: {},
  createPosts: {},
  updatePosts: {},
  findMedia: {},
  findSiteSettings: {},
  updateSiteSettings: {},
};

describe("tool coverage", () => {
  it("detects per-collection find/create/update", () => {
    const cov = analyzeToolCoverage(schema, mcpTools);
    const posts = cov.find((c) => c.slug === "posts")!;

    expect([posts.find, posts.create, posts.update]).toEqual([true, true, true]);
    const media = cov.find((c) => c.slug === "media")!;

    expect([media.find, media.create, media.update]).toEqual([true, false, false]);
    const ss = cov.find((c) => c.slug === "site-settings")!;

    expect([ss.find, ss.create, ss.update]).toEqual([true, false, true]);
  });

  it("flags only collections with NO tools (not read-only ones)", () => {
    const none = collectionsWithNoTools(analyzeToolCoverage(schema, mcpTools));

    expect(none.map((c) => c.slug)).toEqual(["pages"]);
  });

  it("builds a prompt note naming inaccessible collections", () => {
    const note = buildToolAvailabilityNote(analyzeToolCoverage(schema, mcpTools));

    expect(note).toContain('"pages"');
    expect(note).toContain("CANNOT Access");
    expect(note).not.toContain("media");
  });

  it("returns empty note when everything is accessible", () => {
    const full = {
      ...mcpTools,
      createMedia: {},
      updateMedia: {},
      createPages: {},
      findPages: {},
      updatePages: {},
      createSiteSettings: {},
    };

    expect(buildToolAvailabilityNote(analyzeToolCoverage(schema, full))).toBe("");
  });

  it("with a Local API fallback, tells the agent read/edit/create all work via universal tools", () => {
    const note = buildToolAvailabilityNote(analyzeToolCoverage(schema, mcpTools), true);

    expect(note).toContain('"pages"');
    expect(note).toContain("Limited MCP Tooling");
    expect(note).not.toContain("CANNOT Access");
    expect(note).toContain("createDocument");
  });
});
