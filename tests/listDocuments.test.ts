import { describe, it, expect, vi } from "vitest";
import { listDocuments } from "../src/agent/tools/documents/listDocuments.js";
import type { SchemaContext } from "../src/types.js";
import type { DocumentIO } from "../src/agent/content/documentIo.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "articles",
      fields: [
        { name: "title", type: "text" },
        { name: "body", type: "textarea" },
        { name: "meta", type: "group", fields: [{ name: "summary", type: "textarea" }] },
      ],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
} as SchemaContext;

const articles = Array.from({ length: 40 }, (_, index) => ({
  id: index + 1,
  title: `Article ${index + 1}`,
  body: "word ".repeat(1000),
  meta: index === 6 ? {} : { summary: `Summary ${index + 1}` },
}));

function io(): DocumentIO {
  return {
    list: vi.fn(async () => ({ docs: articles, totalPages: 1, totalDocs: articles.length })),
  } as unknown as DocumentIO;
}

describe("listDocuments: a few fields of many documents", () => {
  it("cuts whole rows that are too large and names the call that returns every row", async () => {
    const out: any = await listDocuments(io(), schema, { collection: "articles", limit: 100 });
    const parsed = typeof out === "string" ? JSON.parse(out) : out;

    expect(parsed.docs.length).toBeLessThan(40);
    expect(parsed.rowsNote).toMatch(/`fields`/u);
    expect(parsed.ids).toHaveLength(40);
  });

  it("returns every row with the id and the named fields, a missing value as null", async () => {
    const out: any = await listDocuments(io(), schema, {
      collection: "articles",
      limit: 100,
      fields: ["title", "meta.summary"],
    });

    expect(out.docs).toHaveLength(40);
    expect(out.rowsNote).toBeUndefined();
    expect(out.docs[0]).toEqual({ id: 1, title: "Article 1", "meta.summary": "Summary 1" });
    expect(out.docs[6]).toEqual({ id: 7, title: "Article 7", "meta.summary": null });
  });

  it("refuses a field the collection does not have and lists the fields it has", async () => {
    const list = io();
    const out: any = await listDocuments(list, schema, {
      collection: "articles",
      fields: ["headline"],
    });

    expect(out.error).toMatch(/Unknown field\(s\) in `fields`: headline/u);
    expect(out.error).toMatch(/title, body, meta/u);
    expect(list.list).not.toHaveBeenCalled();
  });

  it("refuses a name that a group does not have and lists the fields of the group", async () => {
    const list = io();
    const out: any = await listDocuments(list, schema, {
      collection: "articles",
      fields: ["title", "meta.sumary"],
    });

    expect(out.error).toMatch(/Unknown field\(s\) in `fields`: meta\.sumary/u);
    expect(out.error).toContain('The fields of the group "meta": summary.');
    expect(list.list).not.toHaveBeenCalled();
  });

  it("reads the published versions when `where` asks for the published documents", async () => {
    const list = vi.fn(async () => ({ docs: [{ id: 2 }], totalPages: 1, totalDocs: 1 }));

    await listDocuments({ list } as unknown as DocumentIO, schema, {
      collection: "articles",
      where: '{"and":[{"title":{"contains":"a"}},{"_status":{"equals":"published"}}]}',
    });

    expect(list).toHaveBeenCalledTimes(1);
    expect((list.mock.calls[0] as any[])[1].draft).toBe(false);
  });

  it("tells a draft that was never published from a newer draft of a published document", async () => {
    const list = vi.fn(async (_collection: string, options: any) =>
      options.draft === false
        ? { docs: [{ id: 2 }], totalPages: 1, totalDocs: 1 }
        : {
            docs: [
              { id: 1, title: "Never out", _status: "draft" },
              { id: 2, title: "Out, with a newer draft", _status: "draft" },
              { id: 3, title: "Out", _status: "published" },
            ],
            totalPages: 1,
            totalDocs: 3,
          }
    );
    const out: any = await listDocuments({ list } as unknown as DocumentIO, schema, {
      collection: "articles",
      fields: ["title", "_status"],
    });

    expect(out.docs.map((row: any) => row.hasPublishedVersion)).toEqual([false, true, undefined]);
    expect((list.mock.calls[1] as any[])[1].where).toEqual({
      and: [{ id: { in: [1, 2] } }, { _status: { equals: "published" } }],
    });
  });
});
