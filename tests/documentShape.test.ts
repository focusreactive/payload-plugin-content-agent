import { describe, it, expect, vi } from "vitest";

import { createBlockLibraryTool, createCopyBlockTool } from "../src/agent/tools/blockLibrary.js";
import { createSchemaInfoTool } from "../src/agent/tools/schemaInfo.js";
import { bodyHint } from "../src/agent/content/bodyHint.js";
import { computeDocDiff } from "../src/agent/content/diff.js";
import { schemaContextToString } from "../src/schema/introspector.js";
import { patchAtPath } from "../src/schema/fieldPaths.js";
import type { SchemaCollection, SchemaContext, SchemaField } from "../src/types.js";

const ctx = { toolCallId: "t", messages: [] } as any;

const banner = { slug: "banner", fields: [{ name: "line", type: "text" }] as SchemaField[] };
const quote = { slug: "quote", fields: [{ name: "words", type: "text" }] as SchemaField[] };

const collection = (slug: string, fields: SchemaField[]): SchemaCollection => ({
  slug,
  hasVersions: true,
  hasDrafts: true,
  hasAuth: false,
  timestamps: true,
  fields,
});

// No blocks field at the top level: one sits in a group, one in a group inside a group.
const landing = collection("landings", [
  { name: "name", type: "text" },
  {
    name: "main",
    type: "group",
    fields: [
      { name: "kicker", type: "text" },
      { name: "rows", type: "blocks", blocks: [banner, quote] },
      {
        name: "aside",
        type: "group",
        fields: [{ name: "extras", type: "blocks", blocks: [quote] }],
      },
    ],
  },
  {
    name: "locked",
    type: "group",
    readOnly: true,
    fields: [{ name: "frozen", type: "blocks", blocks: [banner] }],
  },
] as SchemaField[]);

const story = collection("stories", [{ name: "parts", type: "blocks", blocks: [banner, quote] }]);
const schema: SchemaContext = { globals: [], collections: [landing, story] };

const docs = () => ({
  landings: [
    {
      id: 1,
      name: "One",
      main: {
        kicker: "Keep me",
        rows: [{ id: "r1", blockType: "banner", line: "Hello" }],
        aside: { extras: [{ id: "e1", blockType: "quote", words: "Said" }] },
      },
    },
    { id: 2, name: "Two", main: { kicker: "Stay", rows: [], aside: { extras: [] } } },
  ],
  stories: [{ id: 7, parts: [{ id: "p1", blockType: "quote", words: "From a story" }] }],
});

function fakeIo() {
  const all: Record<string, any[]> = docs();
  const writes: any[] = [];
  const find = (target: any, id: unknown) =>
    all[target.collection]?.find((doc) => String(doc.id) === String(id)) ?? null;
  const io = {
    list: vi.fn(async (slug: string, opts: any) => ({
      docs: opts?.page === 1 ? all[slug] : [],
      totalPages: 1,
      totalDocs: all[slug].length,
    })),
    read: vi.fn(async (target: any, opts: any) => ({ doc: find(target, opts.id) })),
    write: vi.fn(async (target: any, opts: any) => {
      writes.push(opts);

      return { doc: { ...find(target, opts.id), ...opts.patch } };
    }),
  } as any;

  return { io, writes };
}

describe("blocks fields inside groups", () => {
  it("getBlockLibrary lists the paths when the collection has several", async () => {
    const { io } = fakeIo();
    const result: any = await createBlockLibraryTool(io, schema).execute!(
      { collection: "landings" },
      ctx
    );

    expect(result.error).toContain("main.rows, main.aside.extras");
    expect(result.error).not.toContain("frozen");
  });

  it("getBlockLibrary reads a blocks field by its dotted path", async () => {
    const { io } = fakeIo();
    const result: any = await createBlockLibraryTool(io, schema).execute!(
      { collection: "landings", path: "main.aside.extras" },
      ctx
    );

    expect(result.path).toBe("main.aside.extras");
    expect(result.library).toHaveLength(1);
    expect(result.library[0].exemplars[0].blockId).toBe("e1");
    expect(result.next).toContain('fromPath: "main.aside.extras"');
  });

  it("copyBlock writes into a nested blocks field and keeps the rest of the group", async () => {
    const { io, writes } = fakeIo();
    const result: any = await createCopyBlockTool(io, schema).execute!(
      {
        toCollection: "landings",
        toId: 2,
        path: "main.rows",
        blocks: [{ fromId: 1, blockId: "r1" }],
      },
      ctx
    );

    expect(result.error).toBeUndefined();
    expect(result.copied).toHaveLength(1);
    expect(writes[0].patch.main.kicker).toBe("Stay");
    expect(writes[0].patch.main.aside).toEqual({ extras: [] });
    expect(writes[0].patch.main.rows[0]).toMatchObject({ blockType: "banner", line: "Hello" });
  });

  it("copyBlock takes the source field and the target field under different paths", async () => {
    const { io, writes } = fakeIo();
    const result: any = await createCopyBlockTool(io, schema).execute!(
      {
        toCollection: "landings",
        toId: 2,
        path: "main.aside.extras",
        blocks: [{ fromCollection: "stories", fromId: 7, blockId: "p1" }],
      },
      ctx
    );

    expect(result.error).toBeUndefined();
    expect(writes[0].patch.main.aside.extras[0]).toMatchObject({ words: "From a story" });
    expect(writes[0].patch.main.rows).toEqual([]);
  });

  it("copyBlock names the valid source paths when the source has several", async () => {
    const { io, writes } = fakeIo();
    const result: any = await createCopyBlockTool(io, schema).execute!(
      {
        toCollection: "stories",
        toId: 7,
        blocks: [{ fromCollection: "landings", fromId: 1, blockId: "r1" }],
      },
      ctx
    );

    expect(result.error).toContain("`fromPath`");
    expect(result.error).toContain("main.rows, main.aside.extras");
    expect(writes).toHaveLength(0);
  });

  it("patchAtPath builds the missing groups", () => {
    expect(patchAtPath({}, "a.b.c", 1)).toEqual({ a: { b: { c: 1 } } });
    expect(patchAtPath({ a: { keep: true } }, "a.b", 2)).toEqual({ a: { keep: true, b: 2 } });
  });
});

describe("fields inside groups in the reports", () => {
  const fields = [
    { name: "summary", type: "textarea" },
    {
      name: "copy",
      type: "group",
      label: "Copy",
      fields: [
        { name: "text", type: "textarea", label: "Text" },
        { name: "note", type: "text" },
      ],
    },
  ] as SchemaField[];

  it("bodyHint finds the prose in a group", () => {
    const hint = bodyHint(fields, { summary: "short", copy: { text: "x".repeat(600) } });

    expect(hint?.ref).toBe("copy.text");
    expect(hint?.others.map((other) => other.ref)).toEqual(["summary"]);
  });

  it("the review diff reports a changed group field by field", () => {
    const diff = computeDocDiff({
      fields,
      collection: "landings",
      published: { id: 1, summary: "same", copy: { text: "old", note: "n" } },
      draft: { id: 1, summary: "same", copy: { text: "new", note: "n" } },
    });

    expect(diff.fields).toEqual([
      { name: "copy.text", type: "textarea", label: "Copy / Text", before: "old", after: "new" },
    ]);
  });

  it("an added block is summarized by its first text field, not by a field name", () => {
    const blocksField = {
      name: "rows",
      type: "blocks",
      blocks: [
        {
          slug: "note",
          fields: [
            { name: "tone", type: "select", options: ["calm", "loud"] },
            { name: "saying", type: "text" },
          ],
        },
      ],
    } as SchemaField;
    const diff = computeDocDiff({
      fields: [blocksField],
      collection: "landings",
      published: { id: 1, rows: [] },
      draft: { id: 1, rows: [{ id: "n1", blockType: "note", tone: "calm", saying: "Said so" }] },
    });

    expect(diff.fields[0].blocks?.added[0].summary).toBe("Said so");
  });
});

const card = (name: string) => ({ slug: "card", fields: [{ name, type: "text" }] });

describe("two blocks with one slug", () => {
  const twoCards: SchemaContext = {
    globals: [],
    collections: [
      collection("left", [{ name: "items", type: "blocks", blocks: [card("front")] }] as any),
      collection("right", [{ name: "items", type: "blocks", blocks: [card("back")] }] as any),
      collection("again", [{ name: "items", type: "blocks", blocks: [card("front")] }] as any),
    ],
  };

  it("the schema text shows the fields of each", () => {
    const text = schemaContextToString(twoCards);

    expect(text).toContain("front (text)");
    expect(text).toContain("back (text)");
    expect(text.match(/first occurrence above/gu)).toHaveLength(1);
  });

  it("getSchemaInfo returns each variant with the fields that hold it", async () => {
    const result: any = await createSchemaInfoTool(twoCards).execute!({ target: "card" }, ctx);

    expect(result.variants.map((variant: any) => variant.usedIn)).toEqual([
      ["left.items", "again.items"],
      ["right.items"],
    ]);
  });
});
