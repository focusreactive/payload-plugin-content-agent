import { afterEach, describe, expect, it, vi } from "vitest";

import type { DocumentIO } from "../src/agent/content/documentIo.js";
import { createFindReplaceTool, findReplaceInputSchema } from "../src/agent/content/findReplace.js";
import { createCopyBlockTool } from "../src/agent/tools/blocks/copyBlock.js";
import { createBlockLibraryTool } from "../src/agent/tools/blocks/getBlockLibrary.js";
import { listDocuments } from "../src/agent/tools/documents/listDocuments.js";
import { findDocuments, searchableCollections } from "../src/agent/tools/findDocuments.js";
import { createWebTool } from "../src/agent/tools/web.js";
import type { SchemaCollection, SchemaContext, SchemaField } from "../src/types.js";

const opts = { toolCallId: "t", messages: [] } as any;

const collection = (slug: string, fields: SchemaField[]): SchemaCollection => ({
  slug,
  fields,
  hasVersions: true,
  hasDrafts: true,
  hasAuth: false,
  timestamps: true,
});

const schema: SchemaContext = {
  globals: [],
  collections: [
    collection("pages", [
      { name: "title", type: "text" },
      {
        name: "layout",
        type: "blocks",
        blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }],
      },
    ] as SchemaField[]),
    collection("notes", [{ name: "title", type: "text" }] as SchemaField[]),
    collection("counters", [{ name: "amount", type: "number" }] as SchemaField[]),
  ],
};

const io = (list: unknown): DocumentIO =>
  ({
    list,
    read: vi.fn(),
    write: vi.fn(),
    create: vi.fn(),
    transports: () => ({ read: "local", write: "local", create: "local" }),
  }) as unknown as DocumentIO;

afterEach(() => vi.unstubAllGlobals());

describe("web: a failed search is not an empty search", () => {
  it("returns an error when the search service refuses the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("blocked", { status: 429 }))
    );
    const result: any = await createWebTool().execute!(
      { action: "search", query: "some words" },
      opts
    );

    expect(result.error).toContain("HTTP 429");
    expect(result.error).toContain('not "no results"');
    expect(result.message).toBeUndefined();
  });
});

describe("getBlockLibrary: what the scan did not read", () => {
  it("says that the counts are lower bounds when the collection has more documents", async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, layout: [] }));
    const list = vi.fn(async () => ({ docs: page, totalPages: 9, totalDocs: 900 }));
    const result: any = await createBlockLibraryTool(io(list), schema).execute!(
      { collection: "pages" },
      opts
    );

    expect(result.scanned).toBe(400);
    expect(result.incomplete).toContain("Only 400 of the 900 documents");
  });

  it("names the collections that have a blocks field", async () => {
    const result: any = await createBlockLibraryTool(io(vi.fn()), schema).execute!(
      { collection: "notes" },
      opts
    );

    expect(result.error).toContain("Collections with one: pages.");
  });
});

const context = (list: unknown) => ({
  io: io(list),
  schema,
  searchable: searchableCollections(schema),
});
const list = () => vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 }));

describe("findDocuments: a collection that cannot be searched by name", () => {
  it("says which of the named collections were not searched", async () => {
    const result: any = await findDocuments(context(list()), {
      query: "launch",
      collections: ["notes", "counters"],
    });

    expect(result.searched).toEqual(["notes"]);
    expect(result.notSearchable).toEqual(["counters"]);
    expect(result.notSearchableNote).toContain("listDocuments");
  });

  it("lists the collections it searches when none of the named ones can be", async () => {
    const result: any = await findDocuments(context(list()), {
      query: "launch",
      collections: ["counters"],
    });

    expect(result.error).toContain("Collections this tool searches: pages, notes.");
  });
});

describe("findReplaceContent: the request is checked before the run", () => {
  it("refuses an empty list of ids", () => {
    const parsed = findReplaceInputSchema.safeParse({
      collection: "notes",
      find: "a",
      replace: "b",
      ids: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("names the collections for an unknown collection", async () => {
    const { findReplaceContent } = createFindReplaceTool(io(vi.fn()), schema);
    const result: any = await findReplaceContent.execute!(
      { collection: "nope", find: "a", replace: "b", ids: [1] },
      opts
    );

    expect(result.error).toContain('Unknown collection "nope"');
    expect(result.error).toContain("pages, notes, counters");
  });
});

describe("listDocuments: an unknown collection", () => {
  it("names the collections and makes no read", async () => {
    const unused = vi.fn();
    const result: any = await listDocuments(io(unused), schema, { collection: "nope" } as any);

    expect(result.error).toContain('Unknown collection "nope"');
    expect(result.error).toContain("pages, notes, counters");
    expect(unused).not.toHaveBeenCalled();
  });
});

describe("copyBlock: one form of the request", () => {
  it("refuses a call with `blocks` and the single-block fields", async () => {
    const source = io(vi.fn());
    const result: any = await createCopyBlockTool(source, schema).execute!(
      {
        toCollection: "pages",
        toId: 1,
        blocks: [{ fromId: 2, blockId: "a" }],
        fromId: 3,
        blockId: "b",
      } as any,
      opts
    );

    expect(result.error).toContain("only one form runs");
    expect(source.read).not.toHaveBeenCalled();
  });
});
