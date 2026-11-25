import { describe, expect, it } from "vitest";
import { searchContent } from "../src/agent/tools/searchContent.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  collections: [
    {
      slug: "notes",
      fields: [
        { name: "title", type: "text" },
        { name: "source", type: "text" },
      ],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
  globals: [],
};
const docs = [
  { id: 1, title: "Plain", source: "https://site.example/moving-guide/" },
  { id: 2, title: "Encoded", source: "https://site.example/moving%2Dguide/" },
  { id: 3, title: "Broken code", source: "https://site.example/100%-moving/%zz" },
  { id: 4, title: "Other", source: "https://site.example/other/" },
];
const io: any = {
  transports: () => ({ read: "mcp", write: "mcp", create: "mcp" }),
  list: async () => ({ docs, totalDocs: docs.length, totalPages: 1 }),
};
const search = (query: string): Promise<any> =>
  searchContent({ io, schema, collectionSlugs: ["notes"] }, { collection: "notes", query } as any);

describe("searchContent and a percent-encoded address", () => {
  it("finds the address in its plain and in its encoded spelling", async () => {
    const result = await search("site.example/moving-guide");

    expect(result.matchedIds).toEqual([1, 2]);
  });

  it("counts a plain match one time", async () => {
    const result = await search("site.example/other");

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].matchCount).toBe(1);
  });

  it("reads a text with a broken code as it is", async () => {
    expect((await search("100%-moving")).matchedIds).toEqual([3]);
  });
});
