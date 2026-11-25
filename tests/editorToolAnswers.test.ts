import { describe, expect, it, vi } from "vitest";

import type { DocumentWorkspace } from "../src/agent/content/blockTools.js";
import { parsePath, resolveFieldAtPath } from "../src/agent/content/discovery.js";
import { createDocumentRewriteTools } from "../src/agent/content/documentRewrite.js";
import type { DocumentIO } from "../src/agent/content/documentIo.js";
import { createLookupTools } from "../src/agent/content/lookupTools.js";
import { createOutcomeTools } from "../src/agent/content/outcomeCriteria.js";
import type { OutcomeState } from "../src/agent/content/outcomeCriteria.js";
import { createRichTextTools } from "../src/agent/content/richtextTools.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const opts = { toolCallId: "t", messages: [] } as any;

const text = (value: string) => ({
  type: "text",
  version: 1,
  text: value,
  format: 0,
  detail: 0,
  mode: "normal",
  style: "",
});
const node = (type: string, ...children: unknown[]) => ({
  type,
  version: 1,
  direction: "ltr",
  format: "",
  indent: 0,
  ...(type === "heading" ? { tag: "h2" } : {}),
  children,
});
const body = (...children: unknown[]) => ({
  root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children },
});

const fields = [
  { name: "title", type: "text" },
  { name: "summary", type: "textarea" },
  { name: "body", type: "richText", editor: "lexical" },
  { name: "legal", type: "richText", editor: "lexical", readOnly: true },
  { name: "seo", type: "group", fields: [{ name: "description", type: "text" }] },
] as SchemaField[];

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields,
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const ws = (doc: unknown): DocumentWorkspace =>
  ({ ref: { current: doc }, collection: "posts" }) as DocumentWorkspace;

const twoParagraphs = () =>
  body(node("paragraph", text("First words.")), node("paragraph", text("Second words.")));

describe("applyRichText: a call says what it cannot run", () => {
  it("refuses a parameter of the other mode and names the mode that takes it", async () => {
    const doc = { id: 1, body: twoParagraphs() };
    const tools = createRichTextTools(ws(doc), schema);
    const surgical: any = await tools.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "1", action: "insertAfter", markdown: "A third paragraph." }],
        removeText: "First words.",
      },
      opts
    );
    const transform: any = await tools.applyRichText.execute!(
      {
        ref: "body",
        mode: "transform",
        segments: { 0: "First words, changed." },
        edits: [{ key: "1", action: "remove", expectedText: "Second" }],
      },
      opts
    );

    expect(surgical.error).toContain('`removeText` belongs to mode "transform"');
    expect(transform.error).toContain('`edits` belongs to mode "surgical"');
    expect(doc.body.root.children).toHaveLength(2);
  });

  it("refuses a segment of white space only and names removeText", async () => {
    const doc = { id: 1, body: twoParagraphs() };
    const tools = createRichTextTools(ws(doc), schema);
    const result: any = await tools.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 0: "First words, changed.", 1: "  " } },
      opts
    );

    expect(result.error).toContain("segment 1 would keep only white space");
    expect(result.error).toContain("removeText");
    expect(JSON.stringify(doc.body)).toContain("Second words.");
  });

  it("refuses a key that is not a whole number and takes a key sent as a number", async () => {
    const doc = { id: 1, body: twoParagraphs() };
    const tools = createRichTextTools(ws(doc), schema);
    const edit = { action: "insertAfter", markdown: "A third paragraph." };
    const bad: any = await tools.applyRichText.execute!(
      { ref: "body", mode: "surgical", edits: [{ ...edit, key: "1abc" }] } as any,
      opts
    );
    const good: any = await tools.applyRichText.execute!(
      { ref: "body", mode: "surgical", edits: [{ ...edit, key: 1 }] } as any,
      opts
    );

    expect(bad.error).toContain('Edit key "1abc" is not a node index');
    expect(good.ok).toBe(true);
    expect(doc.body.root.children).toHaveLength(3);
  });

  it("names the call that writes the first text of an empty field", async () => {
    const tools = createRichTextTools(ws({ id: 1, body: null }), schema);
    const view: any = await tools.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);

    expect(view.hint).toContain('applyRichText({ ref: "body", mode: "surgical"');
  });
});

const headingsDoc = () => ({
  id: 1,
  body: body(
    node("heading", text("Pricing")),
    node("paragraph", text("Some text.")),
    node("heading", text("Notes")),
    node("heading", text("Notes"))
  ),
});

describe("trimRichText: a miss lists what the field has", () => {
  it("lists the headings when none reads as asked", async () => {
    const tools = createRichTextTools(ws(headingsDoc()), schema);
    const result: any = await tools.trimRichText.execute!(
      { ref: "body", headingText: "Price" },
      opts
    );

    expect(result.ok).toBe(false);
    expect(result.headings).toEqual(["Pricing", "Notes", "Notes"]);
    expect(result.message).toContain("`headings`");
  });

  it("names the removal by index when two headings read the same", async () => {
    const tools = createRichTextTools(ws(headingsDoc()), schema);
    const result: any = await tools.trimRichText.execute!(
      { ref: "body", headingText: "notes" },
      opts
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("2 headings");
    expect(result.message).toContain('viewRichText({ ref: "body", mode: "surgical" })');
  });
});

const appendDoc = () => ({
  id: 1,
  title: "A title",
  summary: null,
  body: twoParagraphs(),
  legal: body(node("paragraph", text("Fixed legal text."))),
});

describe("applyDocumentText: append", () => {
  it("appends with no token, and asks for the token of a read for a text entry", async () => {
    const current = appendDoc();
    const tools = createDocumentRewriteTools(ws(current), schema);
    const appended: any = await tools.applyDocumentText.execute!(
      { append: { body: "A closing paragraph." } },
      opts
    );

    await tools.readDocumentText.execute!({}, opts);
    const noToken: any = await tools.applyDocumentText.execute!({ text: { "1": "Other" } }, opts);

    expect(appended.appended).toBe(1);
    expect(current.body.root.children).toHaveLength(3);
    expect(noToken.error).toContain("`token` is missing");
    expect(current.title).toBe("A title");
  });

  it("names setValues for a text field with no text yet", async () => {
    const tools = createDocumentRewriteTools(ws(appendDoc()), schema);
    const result: any = await tools.applyDocumentText.execute!(
      { append: { summary: "A first line." } },
      opts
    );

    expect(result.errors[0].error).toContain('setValues({ edits: [{ ref: "summary"');
  });

  it("refuses a read-only rich text field", async () => {
    const current = appendDoc();
    const tools = createDocumentRewriteTools(ws(current), schema);
    const result: any = await tools.applyDocumentText.execute!(
      { append: { legal: "One more sentence." } },
      opts
    );

    expect(result.errors[0].error).toContain("read-only");
    expect(current.legal.root.children).toHaveLength(1);
  });
});

describe("declareOutcome: a path is checked when it is declared", () => {
  const document = { id: 1, title: "A title", body: twoParagraphs() };

  const declare = (criteria: object[]) => {
    const state: OutcomeState = { criteria: [] };
    const { declareOutcome } = createOutcomeTools(
      state,
      () => document,
      (path) => resolveFieldAtPath(fields, document, parsePath(path)) !== null
    );

    return (declareOutcome.execute as any)({ criteria }, opts).then((result: any) => ({
      result,
      state,
    }));
  };

  it("refuses a path that is no field of the document and names where a ref comes from", async () => {
    const { result, state } = await declare([{ type: "present", path: "heading", text: "A" }]);

    expect(result.error).toContain('present at "heading"');
    expect(result.error).toContain("getEditableContent");
    expect(state.criteria).toEqual([]);
  });

  it("takes a field of the schema that has no value yet", async () => {
    const { result } = await declare([{ type: "nonEmpty", path: "seo.description" }]);

    expect(result.ok).toBe(true);
  });

  it("says at once that a text with a space at its edge is not checked", async () => {
    const { result } = await declare([{ type: "absent", path: "title", text: "A title " }]);

    expect(result.ok).toBe(true);
    expect(result.notChecked).toHaveLength(1);
    expect(result.note).toContain("notChecked");
  });
});

const io = (list: DocumentIO["list"]) => ({ list }) as unknown as DocumentIO;
const listed = () => vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 })) as any;

describe("lookupDocuments: the locale of the session", () => {
  it("reads in the locale of the open document when the call names none", async () => {
    const list = listed();
    const tools = createLookupTools(io(list), schema, () => "second");

    await tools.lookupDocuments.execute!({ collection: "posts" }, opts);
    await tools.lookupDocuments.execute!({ collection: "posts", locale: "first" }, opts);

    expect(list.mock.calls[0][1].locale).toBe("second");
    expect(list.mock.calls[1][1].locale).toBe("first");
  });
});
