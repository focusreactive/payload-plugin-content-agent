import { describe, it, expect } from "vitest";
import { collectContentFields } from "../src/agent/content/discovery.js";
import { validateFieldValue } from "../src/agent/content/schemaValues.js";
import { createBlockTools } from "../src/agent/content/blockTools.js";
import type { DocumentWorkspace } from "../src/agent/content/blockTools.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const heroBlock = {
  slug: "hero",
  fields: [
    { name: "heading", type: "text" },
    { name: "subheading", type: "textarea" },
    { name: "items", type: "array", fields: [{ name: "label", type: "text" }] as SchemaField[] },
  ] as SchemaField[],
};
const contentBlock = {
  slug: "content",
  fields: [
    { name: "body", type: "richText", editor: "lexical" },
    { name: "align", type: "select", options: ["left", "center"] },
  ] as SchemaField[],
};
const textColBlock = {
  slug: "textCol",
  fields: [{ name: "body", type: "richText" }] as SchemaField[],
};
const columnsBlock = {
  slug: "columns",
  fields: [{ name: "cols", type: "blocks", blocks: [textColBlock] }] as SchemaField[],
};

// The `id` text field is the one Payload injects into a block: it must not surface as editable content.
const calloutBlock = {
  slug: "callout",
  fields: [
    { name: "id", type: "text" },
    { name: "heading", type: "text" },
    { name: "body", type: "richText", editor: "lexical" },
  ] as SchemaField[],
};
const mentionInline = {
  slug: "mention",
  fields: [
    { name: "id", type: "text" },
    { name: "label", type: "text" },
  ] as SchemaField[],
};

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text" },
        { name: "layout", type: "blocks", blocks: [heroBlock, contentBlock, columnsBlock] },
        {
          name: "content",
          type: "richText",
          editor: "lexical",
          blocks: [calloutBlock],
          inlineBlocks: [mentionInline],
        },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const rt = () => ({
  root: { type: "root", children: [], version: 1, direction: "ltr", format: "", indent: 0 },
});
const para = (text: string) => ({
  type: "paragraph",
  version: 1,
  children: [{ type: "text", version: 1, text }],
});

const contentWithEmbeddedBlocks = () => ({
  root: {
    type: "root",
    version: 1,
    direction: "ltr",
    format: "",
    indent: 0,
    children: [
      para("Intro"),
      {
        type: "block",
        version: 2,
        fields: {
          id: "cb1",
          blockType: "callout",
          heading: "Note",
          body: { root: { type: "root", version: 1, children: [para("Inside callout")] } },
        },
      },
      {
        type: "paragraph",
        version: 1,
        children: [
          { type: "text", version: 1, text: "See " },
          {
            type: "inlineBlock",
            version: 1,
            fields: { id: "mb1", blockType: "mention", label: "@joe" },
          },
        ],
      },
    ],
  },
});

function makeDoc() {
  return {
    id: "d",
    title: "Главная",
    layout: [
      {
        id: "h1",
        blockType: "hero",
        heading: "Привет",
        subheading: "Подзаголовок",
        items: [
          { id: "i1", label: "Один" },
          { id: "i2", label: "Два" },
        ],
      },
      { id: "c1", blockType: "content", body: rt(), align: "left" },
      { id: "col1", blockType: "columns", cols: [{ id: "tc1", blockType: "textCol", body: rt() }] },
    ],
    content: contentWithEmbeddedBlocks(),
  };
}

const opts = { toolCallId: "t", messages: [] } as any;
const ws = (doc: any): DocumentWorkspace => ({ ref: { current: doc }, collection: "pages" });

describe("collectContentFields", () => {
  const leaves = collectContentFields(schema.collections[0].fields, makeDoc());
  const refs = leaves.map((l) => l.ref);

  it("collects top-level + every nested block text field", () => {
    expect(refs).toContain("title");
    expect(refs).toContain("layout[h1].heading");
    expect(refs).toContain("layout[h1].subheading");
  });
  it("descends into ARRAY ROWS (by id)", () => {
    expect(refs).toContain("layout[h1].items[i1].label");
    expect(refs).toContain("layout[h1].items[i2].label");
  });
  it("flags richText (incl. nested-block richText) without dumping raw JSON", () => {
    const c1 = leaves.find((l) => l.ref === "layout[c1].body")!;

    expect(c1.richText).toBe(true);
    expect(c1.value).toBeUndefined();
    expect(refs).toContain("layout[col1].cols[tc1].body");
  });
  it("captures full untruncated values", () => {
    expect(leaves.find((l) => l.ref === "layout[h1].heading")!.value).toBe("Привет");
  });
});

describe("collectContentFields: hasMany text/number (Payload allows arrays here)", () => {
  const fields: SchemaField[] = [
    { name: "keywords", type: "text", hasMany: true },
    { name: "scores", type: "number", hasMany: true },
    { name: "title", type: "text" },
  ];

  it("surfaces hasMany text/number as scalar leaves (array value), not silently skipped", () => {
    const leaves = collectContentFields(fields, {
      keywords: ["a", "b"],
      scores: [1, 2],
      title: "hi",
    });
    const kw = leaves.find((l) => l.ref === "keywords");

    expect(kw?.value).toEqual(["a", "b"]);
    const sc = leaves.find((l) => l.ref === "scores");

    expect(sc?.value).toEqual([1, 2]);
  });
  it("validateFieldValue accepts an array of strings/numbers for hasMany, rejects a bare string", () => {
    expect(validateFieldValue(fields[0], ["a", "b"]).ok).toBe(true);
    expect(validateFieldValue(fields[0], "a").ok).toBe(false);
    expect(validateFieldValue(fields[1], [1, 2]).ok).toBe(true);
    expect(validateFieldValue(fields[1], 1).ok).toBe(false);
  });
});

describe("getEditableContent tool", () => {
  it("names the editing tool for every field, so nothing has to be inferred", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.getEditableContent.execute!({}, opts);
    const by = (ref: string) => r.fields.find((f: any) => f.ref === ref);

    expect(by("layout[h1].items[i1].label")).toMatchObject({ type: "text", editWith: "setValues" });
    expect(by("layout[c1].body")).toMatchObject({ type: "richText", editWith: "applyRichText" });
    expect(by("layout[c1].align")).toMatchObject({ type: "select", editWith: "setValues" });
  });
});

describe("setValues tool", () => {
  it("applies every edit in one call", async () => {
    const doc: any = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const r: any = await t.setValues.execute!(
      {
        edits: [
          { ref: "layout[h1].items[i1].label", value: "One" },
          { ref: "layout[h1].heading", value: "Two" },
        ],
      },
      opts
    );

    expect(r.ok).toBe(true);
    expect(r.applied).toBe(2);
    expect(doc.layout[0].items[0].label).toBe("One");
    expect(doc.layout[0].heading).toBe("Two");
  });

  it("reports a bad ref without losing the good edits", async () => {
    const doc: any = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const r: any = await t.setValues.execute!(
      {
        edits: [
          { ref: "layout[h1].heading", value: "Kept" },
          { ref: "layout[c1].body", value: "prose" },
          { ref: "layout[nope].heading", value: "x" },
        ],
      },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.applied).toBe(1);
    expect(r.failed).toBe(2);
    expect(doc.layout[0].heading).toBe("Kept");
    expect(r.errors.find((e: any) => e.ref === "layout[c1].body").error).toContain("applyRichText");
  });

  it("writes structured values (a select) with the same call, validated against the options", async () => {
    const doc: any = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const ok: any = await t.setValues.execute!(
      { edits: [{ ref: "layout[c1].align", value: "center" }] },
      opts
    );

    expect(ok.ok).toBe(true);
    expect(doc.layout[1].align).toBe("center");
    const bad: any = await t.setValues.execute!(
      { edits: [{ ref: "layout[c1].align", value: "sideways" }] },
      opts
    );

    expect(bad.ok).toBe(false);
    expect(bad.errors[0].error).toContain("not an allowed option");
  });

  it("lists the container structure with item ids alongside the fields", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.getEditableContent.execute!({}, opts);
    const layout = r.structure.find((c: any) => c.path === "layout");

    expect(layout).toMatchObject({ kind: "blocks", count: 3 });
    expect(layout.items).toEqual(["[h1] hero", "[c1] content", "[col1] columns"]);
    expect(r.structure.find((c: any) => c.path === "layout[h1].items")).toMatchObject({
      kind: "array",
      count: 2,
      items: ["[i1]", "[i2]"],
    });
    expect(r.structure.find((c: any) => c.path === "layout[col1].cols")).toMatchObject({
      kind: "blocks",
      items: ["[tc1] textCol"],
    });
  });
});

describe("setValues with one edit", () => {
  it("writes plain text at a nested array-row ref", async () => {
    const doc: any = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "layout[h1].items[i1].label", value: "One" }] },
      opts
    );

    expect(r.ok).toBe(true);
    expect(doc.layout[0].items[0].label).toBe("One");
  });
  it("refuses richText (points to applyRichText)", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "layout[c1].body", value: "x" }] },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toContain("applyRichText");
  });
  it("refuses a value of the wrong type for a text field", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "layout[h1].heading", value: 123 }] },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toMatch(/string/u);
  });
});

describe("the name a block carries in the admin", () => {
  it("is written at <block>.blockName, on a block, a nested block and an embedded block", async () => {
    const doc: any = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const r: any = await t.setValues.execute!(
      {
        edits: [
          { ref: "layout[h1].blockName", value: "Hero (main)" },
          { ref: "layout[col1].cols[tc1].blockName", value: "Left column" },
          { ref: "content[cb1].blockName", value: "Warning" },
        ],
      },
      opts
    );

    expect(r).toMatchObject({ ok: true, applied: 3 });
    expect(doc.layout[0].blockName).toBe("Hero (main)");
    expect(doc.layout[2].cols[0].blockName).toBe("Left column");
    expect(doc.content.root.children[1].fields.blockName).toBe("Warning");
  });

  it("is not a field of an array row, a group or the document", async () => {
    const doc: any = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const r: any = await t.setValues.execute!(
      {
        edits: [
          { ref: "layout[h1].items[i1].blockName", value: "Row" },
          { ref: "blockName", value: "Page" },
        ],
      },
      opts
    );

    expect(r).toMatchObject({ ok: false, failed: 2 });
    expect(r.errors[0].error).toContain("getEditableContent");
    expect(doc.layout[0].items[0].blockName).toBeUndefined();
    expect(doc.blockName).toBeUndefined();
  });

  it("refuses a value that is not text", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "layout[h1].blockName", value: 7 }] },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toMatch(/string/u);
  });

  it("shows in the structure line of the block and stays out of the content fields", async () => {
    const doc: any = makeDoc();

    doc.layout[0].blockName = "Hero (main)";
    const t = createBlockTools(ws(doc), schema);
    const r: any = await t.getEditableContent.execute!({}, opts);

    expect(r.structure.find((c: any) => c.path === "layout").items).toEqual([
      '[h1] hero blockName "Hero (main)"',
      "[c1] content",
      "[col1] columns",
    ]);
    expect(r.fields.map((f: any) => f.ref)).not.toContain("layout[h1].blockName");
    expect(
      collectContentFields(schema.collections[0].fields, doc).map((leaf) => leaf.ref)
    ).not.toContain("layout[h1].blockName");
  });
});

describe("embedded Lexical blocks (BlocksFeature): addressable at any depth", () => {
  const leaves = collectContentFields(schema.collections[0].fields, makeDoc());
  const refs = leaves.map((l) => l.ref);

  it("collects text fields INSIDE an embedded block, addressed by node id", () => {
    expect(refs).toContain("content");
    expect(refs).toContain("content[cb1].heading");
  });
  it("collects an inline-block field", () => {
    expect(refs).toContain("content[mb1].label");
    expect(leaves.find((l) => l.ref === "content[mb1].label")!.value).toBe("@joe");
  });
  it("exposes a nested richText INSIDE an embedded block as its own richText leaf", () => {
    const body = leaves.find((l) => l.ref === "content[cb1].body");

    expect(body?.richText).toBe(true);
  });
  it("does NOT expose the system block id as editable content", () => {
    expect(refs).not.toContain("content[cb1].id");
    expect(refs.some((r) => r.endsWith(".id"))).toBe(false);
  });

  it("setValues writes into a field inside an embedded block (live tree mutation)", async () => {
    const doc: any = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "content[cb1].heading", value: "Updated" }] },
      opts
    );

    expect(r.ok).toBe(true);
    expect(doc.content.root.children[1].fields.heading).toBe("Updated");
    expect(doc.content.root.children[0].children[0].text).toBe("Intro");
  });
  it("setValues writes into an inline-block field", async () => {
    const doc: any = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "content[mb1].label", value: "@jane" }] },
      opts
    );

    expect(r.ok).toBe(true);
    expect(doc.content.root.children[2].children[1].fields.label).toBe("@jane");
  });
  it("routes a nested-block richText to applyRichText, not setValues", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "content[cb1].body", value: "x" }] },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toContain("applyRichText");
  });
  it("getEditableContent surfaces embedded-block fields in the right buckets", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.getEditableContent.execute!({}, opts);
    const fieldRefs = r.fields.map((f: any) => f.ref);

    expect(fieldRefs).toContain("content[cb1].heading");
    expect(fieldRefs).not.toContain("content[cb1].body");
    expect(r.fields.find((f: any) => f.ref === "content")).toMatchObject({
      editWith: "applyRichText",
    });
  });
});
