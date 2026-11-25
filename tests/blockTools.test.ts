import { describe, it, expect } from "vitest";
import {
  parsePath,
  formatPath,
  getByPath,
  setByPath,
  findContentSlots,
  resolveFieldAtPath,
} from "../src/agent/content/discovery.js";
import {
  buildBlockSkeleton,
  stripTempIds,
  validateFieldValue,
  isTempId,
  emptyRichText,
} from "../src/agent/content/schemaValues.js";
import { createBlockTools } from "../src/agent/content/blockTools.js";
import type { DocumentWorkspace } from "../src/agent/content/blockTools.js";
import { createWorkspaceTools } from "../src/agent/content/workspaceTools.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

import { createDocumentIO } from "../src/agent/content/documentIo.js";

const heroBlock = {
  slug: "hero",
  fields: [
    { name: "heading", type: "text", required: true },
    { name: "subheading", type: "text" },
    { name: "image", type: "upload", relationTo: "media" },
  ] as SchemaField[],
};
const contentBlock = {
  slug: "content",
  fields: [
    { name: "body", type: "richText", editor: "lexical" },
    { name: "align", type: "select", options: ["left", "center", "right"] },
  ] as SchemaField[],
};
const textColBlock = { slug: "textCol", fields: [{ name: "text", type: "text" }] as SchemaField[] };
const columnsBlock = {
  slug: "columns",
  fields: [{ name: "cols", type: "blocks", blocks: [textColBlock] }] as SchemaField[],
};

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text" },
        { name: "content", type: "richText", editor: "lexical" },
        { name: "layout", type: "blocks", blocks: [heroBlock, contentBlock, columnsBlock] },
        {
          name: "meta",
          type: "group",
          fields: [{ name: "description", type: "richText", editor: "lexical" }],
        },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const asIo = (tools: any) => createDocumentIO({ mcpTools: tools, schema });

const emptyRT = () => ({
  root: { type: "root", children: [], version: 1, direction: "ltr", format: "", indent: 0 },
});

function makeDoc() {
  return {
    id: "doc1",
    title: "Home",
    content: emptyRT(),
    layout: [
      { id: "b1", blockType: "hero", heading: "Welcome", subheading: "sub", image: "m1" },
      { id: "b2", blockType: "content", body: emptyRT(), align: "left" },
      { id: "b3", blockType: "columns", cols: [{ id: "c1", blockType: "textCol", text: "hi" }] },
    ],
  };
}

const opts = { toolCallId: "t", messages: [] } as any;
const ws = (doc: any): DocumentWorkspace => ({ ref: { current: doc }, collection: "pages" });

describe("path parse/format", () => {
  it("round-trips keyed paths", () => {
    const p = parsePath("layout[b1].heading");

    expect(p).toEqual(["layout", { id: "b1" }, "heading"]);
    expect(formatPath(p)).toBe("layout[b1].heading");
  });
  it("handles nested array-in-block paths", () => {
    expect(parsePath("layout[b3].cols[c1].text")).toEqual([
      "layout",
      { id: "b3" },
      "cols",
      { id: "c1" },
      "text",
    ]);
  });
});

describe("getByPath / setByPath", () => {
  it("reads a block field by id", () => {
    expect(getByPath(makeDoc(), parsePath("layout[b1].heading"))).toBe("Welcome");
  });
  it("reads nested block by id", () => {
    expect(getByPath(makeDoc(), parsePath("layout[b3].cols[c1].text"))).toBe("hi");
  });
  it("returns undefined for missing id", () => {
    expect(getByPath(makeDoc(), parsePath("layout[nope].heading"))).toBeUndefined();
  });
  it("sets a block field by id", () => {
    const doc = makeDoc();

    expect(setByPath(doc, parsePath("layout[b1].heading"), "Changed")).toBe(true);
    expect(doc.layout[0].heading).toBe("Changed");
  });
});

describe("findContentSlots", () => {
  it("finds all richText and blocks slots recursively", () => {
    const paths = findContentSlots(schema.collections[0].fields).map(
      (s) => `${s.kind}:${s.schemaPath}`
    );

    expect(paths).toContain("richText:content");
    expect(paths).toContain("blocks:layout");
    expect(paths).toContain("richText:layout[].content.body");
    expect(paths).toContain("blocks:layout[].columns.cols");
    expect(paths).toContain("richText:meta.description");
  });
});

describe("resolveFieldAtPath", () => {
  it("resolves a top-level blocks field", () => {
    const r = resolveFieldAtPath(schema.collections[0].fields, makeDoc(), parsePath("layout"));

    expect(r?.field?.type).toBe("blocks");
  });
  it("resolves block item fields via blockType", () => {
    const r = resolveFieldAtPath(schema.collections[0].fields, makeDoc(), parsePath("layout[b1]"));

    expect(r?.fields.map((f) => f.name)).toEqual(["heading", "subheading", "image"]);
  });
  it("does not resolve a sub-field of an array without the row id, so setValues refuses it", async () => {
    const fields = [
      { name: "items", type: "array", fields: [{ name: "label", type: "text" }] },
      { name: "faq", type: "array", fields: [{ name: "q", type: "text" }] },
    ] as SchemaField[];
    const doc: any = { id: "p1", items: [{ id: "r1", label: "One" }] };
    const arraySchema: SchemaContext = {
      globals: [],
      collections: [{ ...schema.collections[0], fields }],
    };

    expect(resolveFieldAtPath(fields, doc, parsePath("items.label"))).toBeNull();
    expect(resolveFieldAtPath(fields, doc, parsePath("items[r1].label"))?.value).toBe("One");
    const t = createBlockTools(ws(doc), arraySchema);
    const r: any = await t.setValues.execute!(
      {
        edits: [
          { ref: "items.label", value: "Two" },
          { ref: "faq.q", value: "Why?" },
        ],
      },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(doc).toEqual({ id: "p1", items: [{ id: "r1", label: "One" }] });
  });
  it("resolves nested blocks field inside a block", () => {
    const r = resolveFieldAtPath(
      schema.collections[0].fields,
      makeDoc(),
      parsePath("layout[b3].cols")
    );

    expect(r?.field?.type).toBe("blocks");
  });
});

describe("schemaValues", () => {
  it("buildBlockSkeleton sets blockType, temp id, required defaults", () => {
    const b = buildBlockSkeleton(heroBlock);

    expect(b.blockType).toBe("hero");
    expect(isTempId(b.id)).toBe(true);
    expect(b.heading).toBe("");
    expect("subheading" in b).toBe(false);
  });
  it("stripTempIds removes temp ids but keeps real ones", () => {
    const out: any = stripTempIds({
      id: "real1",
      layout: [{ id: "tmp_x", blockType: "hero" }, { id: "b2" }],
    });

    expect(out.id).toBe("real1");
    expect("id" in out.layout[0]).toBe(false);
    expect(out.layout[1].id).toBe("b2");
  });
  it("validates select options", () => {
    const f: SchemaField = { name: "align", type: "select", options: ["left", "right"] };

    expect(validateFieldValue(f, "left").ok).toBe(true);
    expect(validateFieldValue(f, "middle").ok).toBe(false);
  });
  it("validates types", () => {
    expect(validateFieldValue({ name: "h", type: "text" }, 123).ok).toBe(false);
    expect(validateFieldValue({ name: "n", type: "number" }, 5).ok).toBe(true);
  });
});

describe("block tools", () => {
  it("getEditableContent lists the container structure with ids and allowed blocks", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.getEditableContent.execute!({}, opts);
    const layout = r.structure.find((c: any) => c.path === "layout");

    expect(layout).toMatchObject({
      kind: "blocks",
      count: 3,
      allowedBlocks: ["hero", "content", "columns"],
    });
    expect(layout.items[0]).toBe("[b1] hero");
    expect(r.structure.find((c: any) => c.path === "layout[b3].cols")).toMatchObject({
      kind: "blocks",
      count: 1,
      items: ["[c1] textCol"],
    });
  });

  it("insertItem validates the block type and returns the new id", async () => {
    const doc = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const r: any = await t.insertItem.execute!(
      { path: "layout", blockType: "hero", fields: { heading: "New" } },
      opts
    );

    expect(r.ok).toBe(true);
    expect(isTempId(r.id)).toBe(true);
    expect(doc.layout.length).toBe(4);
    expect(doc.layout[3].heading).toBe("New");
  });

  it("insertItem rejects a disallowed block type, and a blocks path without a blockType", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.insertItem.execute!({ path: "layout", blockType: "nope" }, opts);

    expect(r.error).toContain("not allowed");
    const noType: any = await t.insertItem.execute!({ path: "layout" }, opts);

    expect(noType.error).toContain("blockType");
  });

  it("insertItem rejects an invalid field value", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.insertItem.execute!(
      { path: "layout", blockType: "hero", fields: { heading: 123 } },
      opts
    );

    expect(r.error).toContain("string");
  });

  it("insertItem honors afterId position", async () => {
    const doc = makeDoc();
    const t = createBlockTools(ws(doc), schema);

    await t.insertItem.execute!(
      { path: "layout", blockType: "hero", fields: { heading: "X" }, afterId: "b1" },
      opts
    );
    expect(doc.layout[1].heading).toBe("X");
  });

  it("setValues sets a block field by ref and validates it", async () => {
    const doc = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const ok: any = await t.setValues.execute!(
      { edits: [{ ref: "layout[b1].heading", value: "Hi" }] },
      opts
    );

    expect(ok.ok).toBe(true);
    expect(doc.layout[0].heading).toBe("Hi");
    const bad: any = await t.setValues.execute!(
      { edits: [{ ref: "layout[b2].align", value: "sideways" }] },
      opts
    );

    expect(bad.ok).toBe(false);
    expect(bad.errors[0].error).toContain("not an allowed option");
  });

  it("moveItem reorders a block by id", async () => {
    const doc = makeDoc();
    const t = createBlockTools(ws(doc), schema);

    await t.moveItem.execute!({ path: "layout", id: "b1", toIndex: 2 }, opts);
    expect(doc.layout.map((b: any) => b.id)).toEqual(["b2", "b3", "b1"]);
  });

  it("removeItem deletes a block by id", async () => {
    const doc = makeDoc();
    const t = createBlockTools(ws(doc), schema);

    await t.removeItem.execute!({ path: "layout", id: "b2" }, opts);
    expect(doc.layout.map((b: any) => b.id)).toEqual(["b1", "b3"]);
  });

  it("operates on nested blocks arrays", async () => {
    const doc: any = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const r: any = await t.insertItem.execute!(
      { path: "layout[b3].cols", blockType: "textCol", fields: { text: "x" } },
      opts
    );

    expect(r.ok).toBe(true);
    expect(doc.layout[2].cols.length).toBe(2);
  });

  it("errors when no document is open", async () => {
    const t = createBlockTools({ ref: { current: null }, collection: null }, schema);
    const r: any = await t.getEditableContent.execute!({}, opts);

    expect(r.error).toContain("No document is open");
    expect(r.error).not.toContain("openDocument");
    expect(r.error).toContain("end with a summary");
    const ins: any = await t.insertItem.execute!({ path: "layout", blockType: "hero" }, opts);

    expect(ins.error).toContain("No document is open");
  });
});

const faqBlock = {
  slug: "postFaq",
  fields: [
    { name: "title", type: "text", required: true },
    {
      name: "items",
      type: "array",
      required: true,
      minRows: 1,
      fields: [
        { name: "question", type: "text", required: true },
        { name: "answer", type: "richText", required: true, editor: "lexical" },
      ] as SchemaField[],
    },
  ] as SchemaField[],
};
const arraySchema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "faq", type: "blocks", blocks: [faqBlock] },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

function makeFaqDoc() {
  return {
    id: "post1",
    title: "Post",
    faq: [
      {
        id: "fb1",
        blockType: "postFaq",
        title: "FAQ",
        items: [{ id: "i1", question: "Q1?", answer: emptyRT() }],
      },
    ],
  };
}

const faqWs = (doc: any): DocumentWorkspace => ({ ref: { current: doc }, collection: "posts" });

describe("array rows (plain array fields, e.g. FAQ items) go through the same item tools", () => {
  it("insertItem builds a valid richText default for a row - never a raw string", async () => {
    const doc = makeFaqDoc();
    const t = createBlockTools(faqWs(doc), arraySchema);
    const r: any = await t.insertItem.execute!(
      { path: "faq[fb1].items", fields: { question: "Q2?" } },
      opts
    );

    expect(r.ok).toBe(true);
    expect(r.blockType).toBeUndefined();
    const row: any = doc.faq[0].items.find((i: any) => i.id === r.id);

    expect(row.question).toBe("Q2?");
    expect(typeof row.answer).not.toBe("string");
    expect(row.answer).toEqual(emptyRichText());
  });

  it("insertItem rejects a richText value passed directly", async () => {
    const t = createBlockTools(faqWs(makeFaqDoc()), arraySchema);
    const r: any = await t.insertItem.execute!(
      { path: "faq[fb1].items", fields: { question: "Q", answer: "plain string, not Lexical" } },
      opts
    );

    expect(r.error).toContain("applyRichText");
  });

  it("insertItem rejects an unknown row field", async () => {
    const t = createBlockTools(faqWs(makeFaqDoc()), arraySchema);
    const r: any = await t.insertItem.execute!(
      { path: "faq[fb1].items", fields: { bogus: 1 } },
      opts
    );

    expect(r.error).toContain("no field");
  });

  it("insertItem tells a blockType passed for a plain array from a missing one for a blocks array", async () => {
    const t = createBlockTools(faqWs(makeFaqDoc()), arraySchema);
    const r: any = await t.insertItem.execute!(
      { path: "faq[fb1].items", blockType: "postFaq" },
      opts
    );

    expect(r.error).toContain("plain array");
    const r2: any = await t.insertItem.execute!({ path: "faq" }, opts);

    expect(r2.error).toContain("blockType");
  });

  it("setValues sets a scalar row field by ref", async () => {
    const doc = makeFaqDoc();
    const t = createBlockTools(faqWs(doc), arraySchema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "faq[fb1].items[i1].question", value: "Updated?" }] },
      opts
    );

    expect(r.ok).toBe(true);
    expect(doc.faq[0].items[0].question).toBe("Updated?");
  });

  it("setValues rejects setting a row richText directly", async () => {
    const t = createBlockTools(faqWs(makeFaqDoc()), arraySchema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "faq[fb1].items[i1].answer", value: "plain string" }] },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toContain("applyRichText");
  });

  it("moveItem reorders rows by id", async () => {
    const doc = makeFaqDoc();
    const t = createBlockTools(faqWs(doc), arraySchema);

    await t.insertItem.execute!({ path: "faq[fb1].items", fields: { question: "Q2?" } }, opts);
    const secondId = doc.faq[0].items[1].id;

    await t.moveItem.execute!({ path: "faq[fb1].items", id: secondId, toIndex: 0 }, opts);
    expect(doc.faq[0].items[0].id).toBe(secondId);
  });

  it("removeItem deletes a row by id", async () => {
    const doc = makeFaqDoc();
    const t = createBlockTools(faqWs(doc), arraySchema);

    await t.insertItem.execute!({ path: "faq[fb1].items", fields: { question: "Q2?" } }, opts);
    await t.removeItem.execute!({ path: "faq[fb1].items", id: "i1" }, opts);
    expect(doc.faq[0].items.length).toBe(1);
  });

  it("removeItem refuses to go below the minimum number of rows and names the next call", async () => {
    const doc = makeFaqDoc();
    const t = createBlockTools(faqWs(doc), arraySchema);
    const res: any = await t.removeItem.execute!({ path: "faq[fb1].items", id: "i1" }, opts);

    expect(res.error).toMatch(/needs at least 1/u);
    expect(res.error).toMatch(/insertItem/u);
    expect(doc.faq[0].items.length).toBe(1);
  });

  it("insertItem gives ids to nested rows and reports the placeholder of a required field", async () => {
    const doc = makeFaqDoc();
    const t = createBlockTools(faqWs(doc), arraySchema);
    const res: any = await t.insertItem.execute!(
      { path: "faq", blockType: "postFaq", fields: { items: [{ question: "Q?" }] } },
      opts
    );

    expect(res.ok).toBe(true);
    expect(res.defaults).toEqual({ title: "" });
    expect(res.note).toMatch(/setValues/u);
    expect(String(doc.faq[1].items[0].id)).toMatch(/^tmp_/u);
  });
});

describe("setValues: structural field guard", () => {
  it("writes a genuine scalar field", async () => {
    const doc = makeDoc();
    const t = createBlockTools(ws(doc), schema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "layout[b2].align", value: "right" }] },
      opts
    );

    expect(r.ok).toBe(true);
    expect(doc.layout[1].align).toBe("right");
  });

  it("rejects a richText field", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "content", value: emptyRT() }] },
      opts
    );

    expect(r.errors[0].error).toContain("applyRichText");
  });

  it("rejects writing a whole blocks field wholesale", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.setValues.execute!({ edits: [{ ref: "layout", value: [] }] }, opts);

    expect(r.errors[0].error).toContain("insertItem");
  });

  it("rejects writing a whole group field wholesale", async () => {
    const t = createBlockTools(ws(makeDoc()), schema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "meta", value: { description: emptyRT() } }] },
      opts
    );

    expect(r.errors[0].error).toContain("subfield");
  });

  it("rejects writing a nested array field wholesale", async () => {
    const doc = makeFaqDoc();
    const t = createBlockTools(faqWs(doc), arraySchema);
    const r: any = await t.setValues.execute!(
      {
        edits: [
          {
            ref: "faq[fb1].items",
            value: [{ question: "Q", answer: "plain string, not Lexical" }],
          },
        ],
      },
      opts
    );

    expect(r.errors[0].error).toContain("insertItem");
    expect(doc.faq[0].items[0].answer).toEqual(emptyRT());
  });
});

const mcpFind = (doc: any) => ({
  findpages: {
    execute: async () => ({ content: [{ text: `Resource:\n${JSON.stringify(doc)}` }] }),
  },
});

describe("workspace tools", () => {
  it("openDocument loads doc and returns content overview", async () => {
    const workspace: DocumentWorkspace = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(workspace, asIo(mcpFind(makeDoc())), schema);
    const r: any = await t.openDocument.execute!({ collection: "pages", id: "doc1" }, opts);

    expect(r.ok).toBe(true);
    expect(workspace.collection).toBe("pages");
    expect(r.content.find((c: any) => c.path === "layout").count).toBe(3);
  });

  it("saveDocument strips temp ids and calls update", async () => {
    let saved: any = null;
    const mcp = {
      updatepages: {
        execute: async (args: any) => {
          saved = args;

          return { content: [{ text: "{}" }] };
        },
      },
    };
    const doc = makeDoc();

    doc.layout.push({ id: "tmp_new", blockType: "hero", heading: "T" } as any);
    const workspace: DocumentWorkspace = { ref: { current: doc }, collection: "pages" };
    const t = createWorkspaceTools(workspace, asIo(mcp), schema);
    const r: any = await t.saveDocument.execute!({}, opts);

    expect(r.ok).toBe(true);
    expect(saved._status).toBe("draft");
    expect("id" in saved.layout[3]).toBe(false);
    expect(saved.layout[0].id).toBe("b1");
  });
});

const listSchema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
        { name: "related", type: "relationship", relationTo: ["posts", "pages"], hasMany: true },
        { name: "category", type: "relationship", relationTo: "categories" },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const post = () => ({
  id: 1,
  title: "T",
  tags: [7, 26, 41, 24, 49],
  related: [{ relationTo: "posts", value: 3 }],
  category: 2,
});

const setValues = (doc: any, edits: any[]) =>
  createBlockTools({ ref: { current: doc }, collection: "posts" }, listSchema).setValues.execute!(
    { edits },
    opts
  ) as Promise<any>;

describe("setValues add and remove on a hasMany list", () => {
  it("takes an edit with `add` or `remove` and no `value` as valid input", () => {
    const inputSchema = createBlockTools(
      { ref: { current: post() }, collection: "posts" },
      listSchema
    ).setValues.inputSchema as any;

    expect(inputSchema.safeParse({ edits: [{ ref: "tags", add: [64] }] }).success).toBe(true);
    expect(inputSchema.safeParse({ edits: [{ ref: "tags", remove: [49] }] }).success).toBe(true);
  });

  it("adds an id at the end and keeps every entry the list holds", async () => {
    const doc = post();
    const result = await setValues(doc, [{ ref: "tags", add: [64, 26] }]);

    expect(result.ok).toBe(true);
    expect(doc.tags).toEqual([7, 26, 41, 24, 49, 64]);
  });

  it("takes entries out and keeps the rest, also on a list of several collections", async () => {
    const doc = post();
    const result = await setValues(doc, [
      { ref: "tags", remove: [49] },
      {
        ref: "related",
        remove: [{ relationTo: "posts", value: 3 }],
        add: [{ relationTo: "pages", value: 5 }],
      },
    ]);

    expect(result.ok).toBe(true);
    expect(doc.tags).toEqual([7, 26, 41, 24]);
    expect(doc.related).toEqual([{ relationTo: "pages", value: 5 }]);
  });

  it("refuses an entry to remove that the list does not hold, and names what it holds", async () => {
    const doc = post();
    const result = await setValues(doc, [{ ref: "tags", remove: [99] }]);

    expect(result.ok).toBe(false);
    expect(result.errors[0].error).toContain("holds no [99] to remove");
    expect(result.errors[0].error).toContain("[7,26,41,24,49]");
    expect(doc.tags).toEqual([7, 26, 41, 24, 49]);
  });

  it("refuses add on a field of one value, and add together with value", async () => {
    const doc = post();
    const result = await setValues(doc, [
      { ref: "category", add: [3] },
      { ref: "tags", value: [1], add: [2] },
    ]);

    expect(result.failed).toBe(2);
    expect(result.errors[0].error).toContain("holds one value, not a list");
    expect(result.errors[1].error).toContain("not both");
    expect(doc.category).toBe(2);
    expect(doc.tags).toEqual([7, 26, 41, 24, 49]);
  });
});
