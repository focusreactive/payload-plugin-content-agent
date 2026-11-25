import { describe, expect, it } from "vitest";

import { createBlockTools } from "../src/agent/content/blockTools.js";
import { createDocumentRewriteTools } from "../src/agent/content/documentRewrite.js";
import { createRichTextTools } from "../src/agent/content/richtextTools.js";
import type { SchemaContext } from "../src/types.js";

const opts = { toolCallId: "t", messages: [] } as any;

const richText = (paragraphs: string[]) => ({
  root: {
    type: "root",
    children: paragraphs.map((text) => ({
      type: "paragraph",
      children: [{ type: "text", text, format: 0, version: 1 }],
      version: 1,
    })),
    direction: null,
    format: "",
    indent: 0,
    version: 1,
  },
});

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text", localized: true },
        { name: "code", type: "text" },
        { name: "body", type: "richText", editor: "lexical", localized: true },
        { name: "legal", type: "richText", editor: "lexical" },
        {
          name: "rows",
          type: "array",
          fields: [
            { name: "label", type: "text", localized: true },
            { name: "icon", type: "text" },
          ],
        },
        {
          name: "sections",
          type: "array",
          localized: true,
          fields: [{ name: "note", type: "text" }],
        },
      ],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const makeDoc = () => ({
  id: 1,
  title: "Title",
  code: "A-1",
  body: richText(["First paragraph.", "Second paragraph."]),
  legal: richText(["Legal heading", "Legal text."]),
  rows: [{ id: "r1", label: "Label", icon: "star" }],
  sections: [{ id: "s1", note: "Note" }],
});

const workspace = (doc: any, locales: { read?: string; write?: string }) =>
  ({
    ref: { current: doc },
    collection: "pages",
    global: null,
    original: structuredClone(doc),
    readLocale: locales.read,
    locale: locales.write,
  }) as any;

const translation = (doc: any) => workspace(doc, { read: "aa", write: "bb" });

describe("a translation session refuses a write to a field that every locale shares", () => {
  it("setValues writes the localized field and refuses the shared one", async () => {
    const doc = makeDoc();
    const tools = createBlockTools(translation(doc), schema);
    const result: any = await tools.setValues.execute!(
      {
        edits: [
          { ref: "title", value: "Translated" },
          { ref: "code", value: "B-2" },
          { ref: "rows[r1].label", value: "Translated label" },
          { ref: "rows[r1].icon", value: "moon" },
          { ref: "sections[s1].note", value: "Translated note" },
        ],
      },
      opts
    );

    expect(doc.title).toBe("Translated");
    expect(doc.rows[0].label).toBe("Translated label");
    expect(doc.sections[0].note).toBe("Translated note");
    expect(doc.code).toBe("A-1");
    expect(doc.rows[0].icon).toBe("star");
    expect(result.errors.map((entry: any) => entry.ref)).toEqual(["code", "rows[r1].icon"]);
    expect(result.errors[0].error).toMatch(/"code" is not localized/u);
    expect(result.errors[0].error).toContain('translation into "bb"');
  });

  it("insertItem and removeItem refuse a shared container and work in a localized one", async () => {
    const doc = makeDoc();
    const tools = createBlockTools(translation(doc), schema);
    const shared: any = await tools.removeItem.execute!({ path: "rows", id: "r1" }, opts);
    const added: any = await tools.insertItem.execute!(
      { path: "rows", fields: { label: "New" } },
      opts
    );
    const localized: any = await tools.removeItem.execute!({ path: "sections", id: "s1" }, opts);

    expect(shared.error).toMatch(/"rows" is not localized/u);
    expect(added.error).toMatch(/"rows" is not localized/u);
    expect(doc.rows).toHaveLength(1);
    expect(localized.error).toBeUndefined();
    expect(doc.sections).toHaveLength(0);
  });

  it("applyRichText and trimRichText refuse a shared rich text field", async () => {
    const doc = makeDoc();
    const tools = createRichTextTools(translation(doc), schema);
    const before = JSON.stringify(doc.legal);
    const applied: any = await tools.applyRichText.execute!(
      { ref: "legal", mode: "transform", segments: { "1": "Changed" }, nodeCount: 2 },
      opts
    );
    const trimmed: any = await tools.trimRichText.execute!(
      { ref: "legal", headingText: "Legal heading" },
      opts
    );

    expect(applied.error).toMatch(/"legal" is not localized/u);
    expect(trimmed.error).toMatch(/"legal" is not localized/u);
    expect(JSON.stringify(doc.legal)).toBe(before);
  });

  it("applyDocumentText refuses the entries and the append of a shared field", async () => {
    const doc = makeDoc();
    const tools = createDocumentRewriteTools(translation(doc), schema);
    const read: any = await tools.readDocumentText.execute!({}, opts);
    const numberOf = (text: string) =>
      Object.entries(read.text).find(([, value]) => value === text)![0];
    const result: any = await tools.applyDocumentText.execute!(
      {
        token: read.token,
        text: {
          [numberOf("First paragraph.")]: "Translated first.",
          [numberOf("Legal text.")]: "Translated legal.",
          [numberOf("A-1")]: "B-2",
        },
        append: { legal: "One more sentence of law." },
      },
      opts
    );

    expect(result.changed).toBe(1);
    expect(result.failed).toBe(3);
    expect(result.appended).toBe(0);
    expect(result.errors.every((entry: any) => /is not localized/u.test(entry.error))).toBe(true);
    expect(doc.code).toBe("A-1");
    expect(doc.legal.root.children).toHaveLength(2);
    expect(doc.body.root.children[0].children[0].text).toBe("Translated first.");
  });

  it("the same writes pass when the session reads and writes one locale", async () => {
    const doc = makeDoc();
    const tools = createBlockTools(workspace(doc, { read: "bb", write: "bb" }), schema);
    const result: any = await tools.setValues.execute!(
      { edits: [{ ref: "code", value: "B-2" }] },
      opts
    );

    expect(result.error).toBeUndefined();
    expect(doc.code).toBe("B-2");
  });
});

const sameLocale = (doc: any) => workspace(doc, {});

describe("applyDocumentText keeps HTML and block markdown out of the stored text", () => {
  it("refuses an HTML tag in a rich text entry and in a rich text append", async () => {
    const doc = makeDoc();
    const tools = createDocumentRewriteTools(sameLocale(doc), schema);
    const read: any = await tools.readDocumentText.execute!({}, opts);
    const first = Object.entries(read.text).find(([, value]) => value === "First paragraph.")![0];
    const result: any = await tools.applyDocumentText.execute!(
      {
        token: read.token,
        text: { [first]: "First <strong>paragraph</strong>." },
        append: { body: "<p>One more paragraph.</p>" },
      },
      opts
    );

    expect(result.failed).toBe(2);
    expect(result.errors.every((entry: any) => /HTML markup/u.test(entry.error))).toBe(true);
    expect(JSON.stringify(doc.body)).not.toContain("<");
  });

  it("refuses a tag in a plain field that holds none, and keeps a field that holds HTML", async () => {
    const doc = { ...makeDoc(), title: "Plain title", code: "<span>A-1</span>" };
    const tools = createDocumentRewriteTools(sameLocale(doc), schema);
    const read: any = await tools.readDocumentText.execute!({}, opts);
    const numberOf = (text: string) =>
      Object.entries(read.text).find(([, value]) => value === text)![0];
    const result: any = await tools.applyDocumentText.execute!(
      {
        token: read.token,
        text: {
          [numberOf("Plain title")]: "<b>Plain</b> title",
          [numberOf("<span>A-1</span>")]: "<span>B-2</span>",
        },
      },
      opts
    );

    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toMatch(/plain text field that holds none/u);
    expect(doc.title).toBe("Plain title");
    expect(doc.code).toBe("<span>B-2</span>");
  });

  it("an append with blank lines becomes one paragraph node for each paragraph", async () => {
    const doc = makeDoc();
    const tools = createDocumentRewriteTools(sameLocale(doc), schema);
    const result: any = await tools.applyDocumentText.execute!(
      { token: "", append: { body: "Third paragraph.\n\nFourth paragraph." } },
      opts
    );
    const texts = doc.body.root.children.map((node: any) => node.children[0].text);

    expect(result.appended).toBe(1);
    expect(texts).toEqual([
      "First paragraph.",
      "Second paragraph.",
      "Third paragraph.",
      "Fourth paragraph.",
    ]);
  });

  it("refuses block markdown in a rich text append and names the tool that adds it", async () => {
    const doc = makeDoc();
    const tools = createDocumentRewriteTools(sameLocale(doc), schema);
    const result: any = await tools.applyDocumentText.execute!(
      { token: "", append: { body: "Closing words.\n\n## A new section" } },
      opts
    );

    expect(result.appended).toBe(0);
    expect(result.errors[0].error).toMatch(/block markdown/u);
    expect(result.errors[0].error).toContain('applyRichText({ ref: "body", mode: "surgical" })');
    expect(doc.body.root.children).toHaveLength(2);
  });
});
