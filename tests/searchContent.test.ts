import { describe, it, expect } from "vitest";
import { createSearchContentTool } from "../src/agent/tools/searchContent.js";
import type { SchemaContext, SchemaField } from "../src/types.js";
import type { DocumentIO } from "../src/agent/content/documentIo.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "body", type: "textarea" },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

function makeIo(docs: any[]): DocumentIO {
  return {
    transports: () => ({ read: "local", write: "local", create: "local" }),
    list: async () => ({ docs, totalPages: 1, totalDocs: docs.length }),
  } as any;
}

const opts = { toolCallId: "t", messages: [] } as any;

describe("searchContent: output size discipline", () => {
  it("returns matchedIds and matches uncapped for a small, realistic result set", async () => {
    const docs = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      title: `Post ${i}`,
      body: "contains the word needle right here",
    }));
    const t = createSearchContentTool(makeIo(docs), schema);
    const r: any = await t.execute!(
      { collection: "posts", query: "needle", contextChars: 150 },
      opts
    );

    expect(r.matchedIds).toHaveLength(5);
    expect(r.idsTruncated).toBeUndefined();
  });

  it("caps matchedIds at MAX_MATCHED_IDS with a CLEAN (non-corrupted) array + truncation note, instead of an unbounded id list", async () => {
    const docs = Array.from({ length: 2500 }, (_, i) => ({
      id: `doc-${i}`,
      title: `x`,
      body: "needle",
    }));
    const t = createSearchContentTool(makeIo(docs), schema);
    const r: any = await t.execute!(
      { collection: "posts", query: "needle", contextChars: 150 },
      opts
    );

    expect(r.totalMatches).toBe(2500);
    expect(r.matchedIds.length).toBeLessThanOrEqual(2000);
    expect(r.idsTruncated).toBe(true);
    expect(r.idsTruncatedNote).toMatch(/2000 of 2500/u);
    expect(Array.isArray(r.matchedIds)).toBe(true);
    expect(r.matchedIds.every((id: any) => typeof id === "string")).toBe(true);
  });

  it("the whole response is capped as an outer backstop when snippet detail alone would be huge", async () => {
    const longBody = `needle ${"x".repeat(2000)} needle ${"y".repeat(2000)} needle ${"z".repeat(2000)}`;
    const docs = Array.from({ length: 60 }, (_, i) => ({
      id: `doc-${i}`,
      title: `Post ${i}`,
      body: longBody,
    }));
    const t = createSearchContentTool(makeIo(docs), schema);
    const r: any = await t.execute!(
      { collection: "posts", query: "needle", contextChars: 500 },
      opts
    );

    expect(JSON.stringify(r).length).toBeLessThan(60_000);
  });
});

const paragraph = (text: string) => ({
  type: "paragraph",
  version: 1,
  children: [{ type: "text", version: 1, text }],
});

describe("searchContent reads rich text inside a block embedded in rich text", () => {
  it("finds a document whose only match is in the embedded block", async () => {
    const nested: SchemaContext = {
      globals: [],
      collections: [
        {
          ...schema.collections[0],
          fields: [
            {
              name: "content",
              type: "richText",
              editor: "lexical",
              blocks: [
                {
                  slug: "banner",
                  fields: [{ name: "content", type: "richText", editor: "lexical" }],
                },
              ],
            },
          ] as SchemaField[],
        },
      ],
    };
    const docs = [
      {
        id: "p1",
        content: {
          root: {
            type: "root",
            version: 1,
            children: [
              paragraph("Acme intro"),
              {
                type: "block",
                version: 1,
                fields: {
                  id: "b1",
                  blockType: "banner",
                  content: {
                    root: { type: "root", version: 1, children: [paragraph("Acme inside")] },
                  },
                },
              },
            ],
          },
        },
      },
    ];
    const t = createSearchContentTool(makeIo(docs), nested);
    const r: any = await t.execute!(
      { collection: "posts", query: "Acme inside", contextChars: 150 },
      opts
    );

    expect(r.matchedIds).toEqual(["p1"]);
  });
});
