import { describe, it, expect, vi } from "vitest";

import { createFindDocumentsTool, searchableFields } from "../src/agent/tools/findDocuments.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const ctx = { toolCallId: "t", messages: [] } as any;

const col = (slug: string, fields: SchemaField[], extra: Record<string, any> = {}) =>
  ({
    slug,
    fields,
    hasVersions: true,
    hasDrafts: true,
    hasAuth: false,
    timestamps: true,
    ...extra,
  }) as any;

const schema: SchemaContext = {
  globals: [],
  collections: [
    col("pages", [
      { name: "title", type: "text" },
      { name: "slug", type: "text", unique: true },
      { name: "blocks", type: "blocks", blocks: [] },
    ]),
    col("pages-v2", [
      { name: "title", type: "text" },
      { name: "slug", type: "text", unique: true },
    ]),
    col(
      "authors",
      [
        { name: "fullName", type: "text" },
        { name: "bio", type: "textarea" },
      ],
      { useAsTitle: "fullName" }
    ),
    col("embeddings", [{ name: "vector", type: "json" }]),
  ],
};

const data: Record<string, any[]> = {
  pages: [{ id: 1, title: "Home", slug: "home" }],
  "pages-v2": [{ id: 7, title: "About us", slug: "about", _status: "published" }],
  authors: [{ id: 3, fullName: "Denis Radin", bio: "about everything" }],
};

const likeMatch = (value: unknown, q: string) => {
  const hay = String(value ?? "").toLowerCase();

  return q
    .toLowerCase()
    .split(/\s+/u)
    .every((w) => hay.includes(w));
};

function fakeIo(fail: string[] = []) {
  const io = {
    list: vi.fn(async (collection: string, opts: any) => {
      if (fail.includes(collection))
        return { docs: [], totalDocs: 0, totalPages: 0, error: "forbidden" };
      const clauses: any[] = opts.where.or ?? [opts.where];
      const docs = (data[collection] ?? []).filter((d) =>
        clauses.some((c) => Object.entries(c).some(([f, cond]: any) => likeMatch(d[f], cond.like)))
      );

      return { docs: docs.slice(0, opts.limit), totalDocs: docs.length, totalPages: 1 };
    }),
  } as any;

  return io;
}

describe("searchableFields", () => {
  it("puts the title field first, then the unique text fields", () => {
    expect(searchableFields(schema.collections[2])).toEqual(["fullName"]);
    expect(searchableFields(schema.collections[0])).toEqual(["title", "slug"]);
    expect(searchableFields(schema.collections[3])).toEqual([]);
  });
});

describe("findDocuments", () => {
  it("searches every searchable collection at once and returns the hits with their collection", async () => {
    const io = fakeIo();
    const r: any = await createFindDocumentsTool(io, schema).execute!({ query: "about" }, ctx);

    expect(r.error).toBeUndefined();
    expect(r.searched).toEqual(["pages", "pages-v2", "authors"]);
    expect(io.list).toHaveBeenCalledTimes(3);
    expect(r.totalDocs).toBe(1);
    expect(r.docs).toEqual([
      { collection: "pages-v2", id: 7, title: "About us", slug: "about", _status: "published" },
    ]);
    expect(r.byCollection).toEqual([{ collection: "pages-v2", totalDocs: 1, shown: 1 }]);
  });

  it("matches useAsTitle for a collection whose name field is not called title", async () => {
    const r: any = await createFindDocumentsTool(fakeIo(), schema).execute!(
      { query: "Denis Radin" },
      ctx
    );

    expect(r.docs).toEqual([{ collection: "authors", id: 3, title: "Denis Radin" }]);
  });

  it("narrows to the given collections and refuses unknown ones", async () => {
    const io = fakeIo();
    const r: any = await createFindDocumentsTool(io, schema).execute!(
      { query: "about", collections: ["pages"] },
      ctx
    );

    expect(r.searched).toEqual(["pages"]);
    expect(r.totalDocs).toBe(0);
    expect(r.note).toMatch(/No document in 1 collection/u);
    const bad: any = await createFindDocumentsTool(io, schema).execute!(
      { query: "about", collections: ["nope"] },
      ctx
    );

    expect(bad.error).toMatch(/Unknown collection/u);
  });

  it("reports a collection that failed by name and still returns the others", async () => {
    const r: any = await createFindDocumentsTool(fakeIo(["pages"]), schema).execute!(
      { query: "about" },
      ctx
    );

    expect(r.totalDocs).toBe(1);
    expect(r.failed).toEqual([{ collection: "pages", error: "forbidden" }]);
  });

  it("asks for all the words with a like clause per name field", async () => {
    const io = fakeIo();

    await createFindDocumentsTool(io, schema).execute!(
      { query: "financial team", collections: ["pages"] },
      ctx
    );
    expect(io.list.mock.calls[0][1].where).toEqual({
      or: [{ title: { like: "financial team" } }, { slug: { like: "financial team" } }],
    });
  });
});
