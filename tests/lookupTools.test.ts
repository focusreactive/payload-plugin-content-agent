import { describe, it, expect, vi } from "vitest";
import { createLookupTools } from "../src/agent/content/lookupTools.js";
import type { SchemaContext } from "../src/types.js";
import type { DocumentIO } from "../src/agent/content/documentIo.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "reviews",
      fields: [{ name: "title", type: "text" }],
      hasVersions: false,
      hasDrafts: false,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "media",
      fields: [{ name: "filename", type: "text" }],
      hasVersions: false,
      hasDrafts: false,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

function fakeIo(list: DocumentIO["list"]): DocumentIO {
  return {
    transports: () => ({ read: "local", write: "local", create: "local" }),
    read: vi.fn(),
    write: vi.fn(),
    create: vi.fn(),
    list,
  } as unknown as DocumentIO;
}

const ctx = { toolCallId: "t", messages: [] } as any;

describe("lookupDocuments", () => {
  it("returns id + label pairs so a relationship field can be filled", async () => {
    const io = fakeIo(
      vi.fn(async () => ({
        docs: [
          { id: 4, title: "EasyPark", body: "a very long body that must not be returned" },
          { id: 7, title: "EmailOctopus" },
        ],
        totalPages: 1,
        totalDocs: 2,
      })) as any
    );
    const { lookupDocuments } = createLookupTools(io, schema);
    const res: any = await lookupDocuments.execute!({ collection: "reviews" }, ctx);

    expect(res.docs).toEqual([
      { id: 4, label: "EasyPark" },
      { id: 7, label: "EmailOctopus" },
    ]);
    expect(res.totalDocs).toBe(2);
    expect(JSON.stringify(res)).not.toContain("very long body");
  });

  it("reads the label from the title field and never returns an empty label", async () => {
    const io = fakeIo(
      vi.fn(async () => ({
        docs: [{ id: 1, filename: "sanity-logo.svg" }, { id: 2 }],
        totalPages: 1,
        totalDocs: 2,
      })) as any
    );
    const { lookupDocuments } = createLookupTools(io, schema);
    const res: any = await lookupDocuments.execute!({ collection: "media" }, ctx);

    expect(res.docs).toEqual([
      { id: 1, label: "sanity-logo.svg" },
      { id: 2, label: "(no title)" },
    ]);
  });

  it("passes a where clause through and refuses a where that is not a JSON object", async () => {
    const list = vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 }));
    const { lookupDocuments } = createLookupTools(fakeIo(list as any), schema);

    await lookupDocuments.execute!(
      { collection: "reviews", where: '{"title":{"contains":"Easy"}}' },
      ctx
    );
    expect((list.mock.calls[0] as any[])[1].where).toEqual({ title: { contains: "Easy" } });

    for (const where of ["title=Easy", "title equals Easy", "Easy", '"Easy"']) {
      const bad: any = await lookupDocuments.execute!({ collection: "reviews", where }, ctx);

      expect(bad.error).toMatch(/JSON object/u);
      expect(bad.error).toMatch(/title/u);
      expect(bad.error).toMatch(/`query`/u);
    }

    expect(list).toHaveBeenCalledTimes(1);
  });

  it("finds a document by the words of its name, with no field named", async () => {
    const list = vi.fn(async () => ({
      docs: [{ id: 4, title: "EasyPark" }],
      totalPages: 1,
      totalDocs: 1,
    }));
    const { lookupDocuments } = createLookupTools(fakeIo(list as any), schema);
    const res: any = await lookupDocuments.execute!(
      { collection: "reviews", query: " Easy " },
      ctx
    );

    expect((list.mock.calls[0] as any[])[1].where).toEqual({ title: { like: "Easy" } });
    expect(res.docs).toEqual([{ id: 4, label: "EasyPark" }]);

    await lookupDocuments.execute!(
      { collection: "reviews", query: "Easy", where: '{"_status":{"equals":"published"}}' },
      ctx
    );
    expect((list.mock.calls[1] as any[])[1].where).toEqual({
      and: [{ title: { like: "Easy" } }, { _status: { equals: "published" } }],
    });
  });

  it("refuses a where on a field the collection does not have and names its fields", async () => {
    const list = vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 }));
    const { lookupDocuments } = createLookupTools(fakeIo(list as any), schema);

    for (const where of [
      '{"name":{"contains":"Easy"}}',
      '{"or":[{"title":{"contains":"Easy"}},{"name.first":{"contains":"Easy"}}]}',
    ]) {
      const bad: any = await lookupDocuments.execute!({ collection: "reviews", where }, ctx);

      expect(bad.error).toMatch(/"reviews" has no field name/u);
      expect(bad.error).toMatch(/The fields of "reviews": .*title/u);
      expect(bad.error).toMatch(/`query`/u);
    }

    expect(list).not.toHaveBeenCalled();

    await lookupDocuments.execute!(
      {
        collection: "reviews",
        where: '{"and":[{"id":{"greater_than":5}},{"title":{"exists":true}}]}',
      },
      ctx
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("shows the status of each row and says so when several documents share a label", async () => {
    const list = vi.fn(async () => ({
      docs: [
        { id: 5, title: "Same name", _status: "published" },
        { id: 62, title: "Same name", _status: "draft" },
        { id: 7, title: "Other" },
      ],
      totalPages: 1,
      totalDocs: 3,
    }));
    const { lookupDocuments } = createLookupTools(fakeIo(list as any), schema);
    const res: any = await lookupDocuments.execute!({ collection: "reviews", query: "name" }, ctx);

    expect(res.docs).toEqual([
      { id: 5, label: "Same name", _status: "published" },
      { id: 62, label: "Same name", _status: "draft" },
      { id: 7, label: "Other" },
    ]);
    expect(res.sameLabel).toMatch(/a lookup never overrules an id of the task/u);
    const single: any = await lookupDocuments.execute!({ collection: "reviews" }, ctx);

    expect(single.sameLabel).toBeDefined();
  });

  it("names the other call when the collection has no text field for a name", async () => {
    const list = vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 }));
    const numbers: SchemaContext = {
      globals: [],
      collections: [
        { ...schema.collections[0], slug: "scores", fields: [{ name: "points", type: "number" }] },
      ],
    };
    const { lookupDocuments } = createLookupTools(fakeIo(list as any), numbers);
    const res: any = await lookupDocuments.execute!({ collection: "scores", query: "ten" }, ctx);

    expect(res.error).toMatch(/no text field/u);
    expect(res.error).toMatch(/points/u);
    expect(list).not.toHaveBeenCalled();
  });

  it("tells the editor NOT to invent an id when nothing matched", async () => {
    const { lookupDocuments } = createLookupTools(
      fakeIo(vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 })) as any),
      schema
    );
    const res: any = await lookupDocuments.execute!({ collection: "reviews" }, ctx);

    expect(res.note).toMatch(/invent an id/u);
  });

  it("returns the maximum for a larger limit and names the call that narrows the list", async () => {
    const list = vi.fn(async () => ({
      docs: Array.from({ length: 50 }, (_, index) => ({
        id: index + 1,
        title: `Review ${index + 1}`,
      })),
      totalPages: 3,
      totalDocs: 140,
    }));
    const { lookupDocuments } = createLookupTools(fakeIo(list as any), schema);

    expect(
      (lookupDocuments.inputSchema as any).safeParse({ collection: "reviews", limit: 1000 }).success
    ).toBe(true);
    const res: any = await lookupDocuments.execute!({ collection: "reviews", limit: 1000 }, ctx);

    expect((list.mock.calls[0] as any[])[1].limit).toBe(50);
    expect(res.returned).toBe(50);
    expect(res.note).toMatch(/50 of 140/u);
    expect(res.note).toMatch(/lookupDocuments.*`query`.*`where`/u);
  });

  it("refuses a collection outside the agent's schema", async () => {
    const { lookupDocuments } = createLookupTools(fakeIo(vi.fn() as any), schema);
    const res: any = await lookupDocuments.execute!({ collection: "users" }, ctx);

    expect(res.error).toMatch(/Unknown collection/u);
  });
});
