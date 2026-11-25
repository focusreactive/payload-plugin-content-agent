import { describe, it, expect, vi } from "vitest";

import { createBlockLibraryTool, createCopyBlockTool } from "../src/agent/tools/blockLibrary.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const ctx = { toolCallId: "t", messages: [] } as any;

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
      fields: [
        { name: "title", type: "text" },
        { name: "slug", type: "text" },
        { name: "isNewDesign", type: "checkbox" },
        { name: "theme", type: "select", options: ["light", "dark"] },
        {
          name: "sections",
          type: "blocks",
          blocks: [
            {
              slug: "hero",
              label: "Hero",
              description: "Opens the page: headline, one paragraph, one call to action.",
              fields: [
                { name: "heading", type: "text" },
                { name: "body", type: "richText", editor: "lexical" },
                { name: "image", type: "upload", relationTo: "media" },
              ] as SchemaField[],
            },
            {
              slug: "proof",
              label: "Proof",
              description: "Case studies and testimonials, by reference.",
              fields: [
                { name: "heading", type: "text" },
                { name: "cases", type: "relationship", relationTo: "projects", hasMany: true },
                {
                  name: "quotes",
                  type: "array",
                  fields: [{ name: "text", type: "text" }] as SchemaField[],
                },
              ] as SchemaField[],
            },
            {
              slug: "unused",
              label: "Never used",
              fields: [{ name: "note", type: "text" }] as SchemaField[],
            },
          ],
        },
      ] as SchemaField[],
    },
  ],
};

const rt = (text: string) => ({
  root: {
    type: "root",
    version: 1,
    direction: "ltr",
    format: "",
    indent: 0,
    children: [{ type: "paragraph", version: 1, children: [{ type: "text", version: 1, text }] }],
  },
});

const pages = () => [
  {
    id: 1,
    title: "Thin page",
    slug: "thin",
    sections: [{ id: "b1", blockType: "hero", heading: "Hi", body: null, image: null }],
  },
  {
    id: 2,
    title: "Full page",
    slug: "full",
    isNewDesign: true,
    theme: "dark",
    sections: [
      {
        id: "b2",
        blockType: "hero",
        heading: "Migrate with confidence",
        body: rt("Two paragraphs of real copy."),
        image: 42,
      },
      {
        id: "b3",
        blockType: "proof",
        heading: "Trusted by",
        cases: [3, 2, 5],
        quotes: [
          { id: "q1", text: "Great" },
          { id: "q2", text: "Solid" },
        ],
      },
    ],
  },
  { id: 3, title: "New page", slug: "new", isNewDesign: false, sections: [] },
];

function fakeIo(docs = pages()) {
  const state: { writes: any[] } = { writes: [] };
  const io = {
    list: vi.fn(async (_c: string, opts: any) => ({
      docs: opts?.page === 1 ? docs : [],
      totalPages: 1,
      totalDocs: docs.length,
    })),
    read: vi.fn(async (_t: any, opts: any) => ({
      doc: docs.find((d) => String(d.id) === String(opts.id)) ?? null,
    })),
    write: vi.fn(async (_t: any, opts: any) => {
      state.writes.push(opts);
      const doc = docs.find((d) => String(d.id) === String(opts.id))!;
      const patched = { ...doc, ...opts.patch };

      patched.sections = patched.sections.map((b: any, i: number) => ({
        ...b,
        id: b.id ?? `new-${i}`,
      }));

      return { doc: patched };
    }),
  } as any;

  return { io, state };
}

describe("getBlockLibrary", () => {
  it("lists every block type with its purpose, usage, and the best-filled exemplar", async () => {
    const { io } = fakeIo();
    const r: any = await createBlockLibraryTool(io, schema).execute!({ collection: "pages" }, ctx);

    expect(r.error).toBeUndefined();
    expect(r.scanned).toBe(3);

    const hero = r.library.find((b: any) => b.blockType === "hero");

    expect(hero.purpose).toMatch(/Opens the page/u);
    expect(hero.usedOn).toBe(2);
    expect(hero.exemplars[0].docId).toBe(2);
    expect(hero.exemplars[0].blockId).toBe("b2");
    expect(hero.exemplars[0].filled).toBe("3/3 fields");
    expect(hero.exemplars[0].preview.image).toMatch(/media 42/u);

    const proof = r.library.find((b: any) => b.blockType === "proof");

    expect(proof.exemplars[0].preview.cases).toMatch(/projects \[3, 2, 5\]/u);
  });

  it("keeps a never-used block type in the list, with no exemplar, at the bottom", async () => {
    const { io } = fakeIo();
    const r: any = await createBlockLibraryTool(io, schema).execute!({ collection: "pages" }, ctx);
    const last = r.library[r.library.length - 1];

    expect(last.blockType).toBe("unused");
    expect(last.usedOn).toBe(0);
    expect(last.exemplars).toEqual([]);
  });

  it("refuses an unknown collection and names the real ones", async () => {
    const { io } = fakeIo();
    const r: any = await createBlockLibraryTool(io, schema).execute!({ collection: "nope" }, ctx);

    expect(r.error).toMatch(/Unknown collection/u);
    expect(r.error).toMatch(/pages/u);
  });
});

describe("copyBlock", () => {
  it("carries the block over with references and rows intact, and drops the row ids", async () => {
    const { io, state } = fakeIo();
    const r: any = await createCopyBlockTool(io, schema).execute!(
      { fromCollection: "pages", fromId: 2, blockId: "b3", toCollection: "pages", toId: 3 },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(r.copied[0].blockType).toBe("proof");
    const written = state.writes[0].patch.sections;

    expect(written).toHaveLength(1);
    expect(written[0].cases).toEqual([3, 2, 5]);
    expect(written[0].quotes.map((q: any) => q.text)).toEqual(["Great", "Solid"]);
    expect(written[0].id).toBeUndefined();
    expect(written[0].quotes.every((q: any) => q.id === undefined)).toBe(true);
  });

  it("places the copy after a named block when asked", async () => {
    const docs = pages();

    docs[2].sections = [
      { id: "x1", blockType: "hero", heading: "Existing", body: null, image: null },
    ];
    const { io, state } = fakeIo(docs);
    const r: any = await createCopyBlockTool(io, schema).execute!(
      {
        fromCollection: "pages",
        fromId: 2,
        blockId: "b3",
        toCollection: "pages",
        toId: 3,
        afterBlockId: "x1",
      },
      ctx
    );

    expect(r.copied[0].position).toBe(1);
    expect(state.writes[0].patch.sections.map((b: any) => b.blockType)).toEqual(["hero", "proof"]);
  });

  it("copies a whole list of blocks in one write, in the given order, from several sources", async () => {
    const { io, state } = fakeIo();
    const r: any = await createCopyBlockTool(io, schema).execute!(
      {
        toCollection: "pages",
        toId: 3,
        blocks: [
          { fromId: 2, blockId: "b3" },
          { fromId: 1, blockId: "b1" },
          { fromId: 2, blockId: "b2", blockName: "Hero (migration)" },
        ],
      },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].patch.sections.map((b: any) => `${b.blockType}:${b.heading}`)).toEqual([
      "proof:Trusted by",
      "hero:Hi",
      "hero:Migrate with confidence",
    ]);
    expect(state.writes[0].patch.sections[2].blockName).toBe("Hero (migration)");
    expect(r.copied.map((c: any) => c.position)).toEqual([0, 1, 2]);
    expect(r.targetBlocks).toBe(3);
    expect(
      io.read.mock.calls.filter(([, o]: any) => o.callId === "copy-block-source")
    ).toHaveLength(2);
  });

  it("copies what it can and reports the picks it could not honour, instead of failing the whole call", async () => {
    const { io, state } = fakeIo();
    const realRead = io.read.getMockImplementation()!;

    io.read.mockImplementation(async (t: any, o: any) =>
      String(o.id) === "1" ? { error: "Failed query: connection dropped" } : realRead(t, o)
    );
    const r: any = await createCopyBlockTool(io, schema).execute!(
      {
        toCollection: "pages",
        toId: 3,
        blocks: [
          { fromId: 2, blockId: "b3" },
          { fromId: 1, blockId: "b1" },
          { fromId: 2, blockId: "nope" },
        ],
      },
      ctx
    );

    expect(r.ok).toBe(true);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].patch.sections.map((b: any) => b.blockType)).toEqual(["proof"]);
    expect(r.skipped.map((k: any) => k.blockId)).toEqual(["b1", "nope"]);
    expect(r.skipped[0].reason).toMatch(/could not read the source document/u);
    expect(r.next).toMatch(/never ask editContent to build the block from nothing/u);
    expect(io.read.mock.calls.filter(([, o]: any) => String(o.id) === "1")).toHaveLength(2);
  });

  it("fails the call only when nothing at all could be copied", async () => {
    const { io, state } = fakeIo();
    const r: any = await createCopyBlockTool(io, schema).execute!(
      { toCollection: "pages", toId: 3, blocks: [{ fromId: 2, blockId: "nope" }] },
      ctx
    );

    expect(r.error).toMatch(/None of the 1 pick/u);
    expect(state.writes).toHaveLength(0);
  });

  it("serialises parallel calls onto the same target so none of them overwrites another", async () => {
    const docs = pages();
    const state: { writes: any[] } = { writes: [] };
    const io = {
      list: vi.fn(),
      read: vi.fn(async (_t: any, opts: any) => {
        // The slow read makes every call read the target before any of them writes.
        await new Promise((r) => setTimeout(r, 5));

        return { doc: docs.find((d) => String(d.id) === String(opts.id)) ?? null };
      }),
      write: vi.fn(async (_t: any, opts: any) => {
        state.writes.push(opts);
        const i = docs.findIndex((d) => String(d.id) === String(opts.id));

        docs[i] = { ...docs[i], ...opts.patch };
        docs[i].sections = docs[i].sections.map((b: any, n: number) => ({
          ...b,
          id: b.id ?? `new-${n}`,
        }));

        return { doc: docs[i] };
      }),
    } as any;
    const t = createCopyBlockTool(io, schema);

    await Promise.all([
      t.execute!({ toCollection: "pages", toId: 3, fromId: 2, blockId: "b2" }, ctx),
      t.execute!({ toCollection: "pages", toId: 3, fromId: 2, blockId: "b3" }, ctx),
      t.execute!({ toCollection: "pages", toId: 3, fromId: 1, blockId: "b1" }, ctx),
    ]);
    expect(state.writes).toHaveLength(3);
    expect(docs[2].sections).toHaveLength(3);
  });

  it("refuses a block the target field does not allow, and a block id that does not exist", async () => {
    const strict: SchemaContext = JSON.parse(JSON.stringify(schema));
    const sections = strict.collections[0].fields.find((f) => f.name === "sections")!;

    sections.blocks = sections.blocks!.filter((b) => b.slug !== "proof");
    const { io } = fakeIo();
    const notAllowed: any = await createCopyBlockTool(io, strict).execute!(
      { fromCollection: "pages", fromId: 2, blockId: "b3", toCollection: "pages", toId: 3 },
      ctx
    );

    expect(notAllowed.error).toMatch(/not allowed/u);

    const missing: any = await createCopyBlockTool(io, schema).execute!(
      { fromCollection: "pages", fromId: 2, blockId: "nope", toCollection: "pages", toId: 3 },
      ctx
    );

    expect(missing.error).toMatch(/no such block there/u);
    expect(missing.error).toMatch(/b2:hero/u);
  });

  it("gives a fresh shell the source page's presentation settings, and says so", async () => {
    const { io, state } = fakeIo();
    const r: any = await createCopyBlockTool(io, schema).execute!(
      { toCollection: "pages", toId: 3, blocks: [{ fromId: 2, blockId: "b2" }] },
      ctx
    );

    expect(state.writes[0].patch.isNewDesign).toBe(true);
    expect(state.writes[0].patch.theme).toBe("dark");
    expect(r.inheritedSettings).toEqual({ isNewDesign: true, theme: "dark" });
    expect(r.inheritedFrom).toBe("pages#2");
  });

  it("leaves the settings of a page that already has blocks alone unless asked", async () => {
    const docs = pages();

    docs[2].sections = [
      { id: "x1", blockType: "hero", heading: "Existing", body: null, image: null },
    ];
    const { io, state } = fakeIo(docs);
    const r: any = await createCopyBlockTool(io, schema).execute!(
      { toCollection: "pages", toId: 3, blocks: [{ fromId: 2, blockId: "b3" }] },
      ctx
    );

    expect(state.writes[0].patch.isNewDesign).toBeUndefined();
    expect(r.inheritedSettings).toBeUndefined();
    const forced: any = await createCopyBlockTool(io, schema).execute!(
      {
        toCollection: "pages",
        toId: 3,
        blocks: [{ fromId: 2, blockId: "b3" }],
        inheritSettings: true,
      },
      ctx
    );

    expect(forced.inheritedSettings).toEqual({ isNewDesign: true, theme: "dark" });
  });

  it("records the edit so the review panel can diff it", async () => {
    const { io } = fakeIo();
    const recordEdits = vi.fn();

    await createCopyBlockTool(io, schema, recordEdits).execute!(
      { fromCollection: "pages", fromId: 2, blockId: "b2", toCollection: "pages", toId: 3 },
      ctx
    );
    expect(recordEdits).toHaveBeenCalledTimes(1);
    const [[[edit]]] = recordEdits.mock.calls;

    expect(edit.collection).toBe("pages");
    expect(edit.id).toBe(3);
    expect(edit.before.sections).toHaveLength(0);
    expect(edit.after.sections).toHaveLength(1);
  });
});

describe("validateFieldValue: rows of an array field are objects shaped by its subfields", () => {
  it("rejects a string where a row object is expected, naming the row fields", async () => {
    const { validateFieldValue } = await import("../src/agent/content/schemaValues.js");
    const rows = {
      name: "rows",
      type: "array",
      fields: [
        { name: "text", type: "text" },
        { name: "highlighted", type: "checkbox" },
      ],
    } as any;
    const bad = validateFieldValue(rows, ["Traditional all-in-one platform", "Composable"]);

    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(
      /"rows"\[0\] must be an object with the row's fields \{ text: text, highlighted: checkbox \}/u
    );
    expect(bad.error).toMatch(/not string \("Traditional all-in-one platform"\)/u);
    expect(
      validateFieldValue(rows, [
        { text: "Traditional", highlighted: false },
        { id: "r2", text: "Composable" },
      ]).ok
    ).toBe(true);
    expect(validateFieldValue(rows, [{ label: "x" }]).error).toMatch(/has no field "label"/u);
    expect(validateFieldValue(rows, [{ text: 5 }]).error).toMatch(
      /"rows"\[0\]\.text" expects a string/u
    );
    const tableData = {
      name: "tableData",
      type: "array",
      fields: [{ name: "title", type: "text" }, rows],
    } as any;
    const nested = validateFieldValue(tableData, [{ title: "Traditional CMS", rows: ["a", "b"] }]);

    expect(nested.ok).toBe(false);
    expect(nested.error).toMatch(/tableData"\[0\]\.rows"\[0\] must be an object/u);
  });
});
