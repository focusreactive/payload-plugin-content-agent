import { describe, it, expect } from "vitest";
import { createRichTextTools } from "../src/agent/content/richtextTools.js";
import { getByPath, parsePath } from "../src/agent/content/discovery.js";
import { emptyRichText, ensureNonEmptyRichText } from "../src/agent/content/schemaValues.js";
import { isEmptyRichText } from "../src/agent/content/lexicalEngine.js";
import type { DocumentWorkspace } from "../src/agent/content/blockTools.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

function makeLexicalDoc(text: string) {
  return {
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [
        {
          type: "paragraph",
          version: 1,
          direction: "ltr",
          format: "",
          indent: 0,
          textFormat: 0,
          textStyle: "",
          children: [
            { type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" },
          ],
        },
      ],
    },
  };
}

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "body", type: "richText", editor: "lexical" },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const opts = { toolCallId: "t", messages: [] } as any;
const ws = (doc: any): DocumentWorkspace => ({ ref: { current: doc }, collection: "posts" });

describe("richtextTools", () => {
  it("viewRichText surgical returns the indexed node view", async () => {
    const t = createRichTextTools(ws({ id: "p", body: makeLexicalDoc("Hello world") }), schema);
    const r: any = await t.viewRichText.execute!({ ref: "body", mode: "surgical" }, opts);

    expect(r.content).toContain("Hello world");
  });

  it("viewRichText transform returns the field text as a numbered segment map", async () => {
    const t = createRichTextTools(ws({ id: "p", body: makeLexicalDoc("Hello world") }), schema);
    const r: any = await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);

    expect(r.segments[0]).toBe("Hello world");
  });

  it("applyRichText transform writes transformed text back (structure preserved)", async () => {
    const doc = { id: "p", body: makeLexicalDoc("Hello world") };
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 0: "Goodbye now" } },
      opts
    );

    expect(r.ok).toBe(true);
    const text = JSON.stringify(getByPath(doc, parsePath("body")));

    expect(text).toContain("Goodbye now");
    expect(text).not.toContain("Hello world");
  });

  it("answers a plain-text ref with its value instead of refusing", async () => {
    const t = createRichTextTools(ws({ id: "p", title: "x", body: makeLexicalDoc("y") }), schema);
    const r: any = await t.viewRichText.execute!({ ref: "title", mode: "transform" }, opts);

    expect(r.error).toBeUndefined();
    expect(r.value).toBe("x");
    expect(r.type).toBe("text");
    expect(r.note).toContain("setValues");
  });

  it("still refuses a ref that resolves to no field at all", async () => {
    const t = createRichTextTools(ws({ id: "p", title: "x", body: makeLexicalDoc("y") }), schema);
    const r: any = await t.viewRichText.execute!({ ref: "nope", mode: "transform" }, opts);

    expect(r.error).toContain("not a richText");
  });

  it("still refuses a non-text structured field", async () => {
    const t = createRichTextTools(ws({ id: "p", title: "x", body: makeLexicalDoc("y") }), schema);
    const r: any = await t.viewRichText.execute!({ ref: "body.root", mode: "transform" }, opts);

    expect(r.error).toBeDefined();
  });

  it("errors when no document is open", async () => {
    const t = createRichTextTools({ ref: { current: null }, collection: null }, schema);
    const r: any = await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);

    expect(r.error).toContain("No document is open");
  });
});

function makeRichDoc() {
  return {
    id: "p",
    body: {
      root: {
        type: "root",
        version: 1,
        direction: "ltr",
        format: "",
        indent: 0,
        children: [
          {
            type: "paragraph",
            version: 1,
            children: [{ type: "text", version: 1, text: "Intro" }],
          },
          { type: "block", version: 2, fields: { blockType: "cta", heading: "Sign up" } },
          { type: "upload", version: 2, relationTo: "media", value: "m1", fields: {} },
          { type: "paragraph", version: 1, children: [{ type: "text", version: 1, text: "Tail" }] },
        ],
      },
    },
  };
}

const prose = (n: number) => ({
  id: "p",
  body: {
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: Array.from({ length: n }, (_, i) => ({
        type: "paragraph",
        version: 1,
        children: [
          {
            type: "text",
            version: 1,
            text: `Paragraph number ${i} with some genuine content to measure.`,
          },
        ],
      })),
    },
  },
});

describe("richtext lossless wiring + gates", () => {
  it("surgical edit on a sibling preserves block & upload nodes", async () => {
    const doc = makeRichDoc();
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "0", action: "replace", markdown: "New intro", expectedText: "Intro" }],
      },
      opts
    );

    expect(r.ok).toBe(true);
    const body: any = getByPath(doc, parsePath("body"));
    const types = body.root.children.map((c: any) => c.type);

    expect(types).toContain("block");
    expect(types).toContain("upload");
    expect(body.root.children.find((c: any) => c.type === "block").fields.heading).toBe("Sign up");
  });

  it("transform changes text while preserving structural nodes (block, upload)", async () => {
    const doc = makeRichDoc();
    const t = createRichTextTools(ws(doc), schema);
    const view: any = await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);
    const segments: Record<number, string> = {};

    for (const k of Object.keys(view.segments))
      segments[Number(k)] = String(view.segments[k]).toUpperCase();
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments },
      opts
    );

    expect(r.ok).toBe(true);
    const body: any = getByPath(doc, parsePath("body"));
    const types = body.root.children.map((c: any) => c.type);

    expect(types).toContain("block");
    expect(types).toContain("upload");
    expect(body.root.children.find((c: any) => c.type === "block").fields.heading).toBe("Sign up");
    expect(JSON.stringify(body)).toContain("INTRO");
  });

  it("transform works on a plain-prose field", async () => {
    const doc = { id: "p", body: makeLexicalDoc("Hello world") };
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 0: "Bonjour le monde" } },
      opts
    );

    expect(r.ok).toBe(true);
  });

  it("surgical REPLACE that would clobber a block is refused", async () => {
    const t = createRichTextTools(ws(makeRichDoc()), schema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "1", action: "replace", markdown: "just text", expectedType: "block" }],
      },
      opts
    );

    expect(r.error).toContain("would drop");
  });

  it("surgical REMOVE of a block is allowed (intentional)", async () => {
    const doc = makeRichDoc();
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "1", action: "remove", expectedType: "block" }],
      },
      opts
    );

    expect(r.ok).toBe(true);
    expect(
      (getByPath(doc, parsePath("body")) as any).root.children.map((c: any) => c.type)
    ).not.toContain("block");
  });

  it("transform refuses an empty segment (would blank a node)", async () => {
    const t = createRichTextTools(ws(prose(4)), schema);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 0: "" } },
      opts
    );

    expect(r.error).toMatch(/empty/iu);
  });

  it("transform refuses an out-of-range segment index", async () => {
    const t = createRichTextTools(ws(prose(4)), schema);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 99: "x" } },
      opts
    );

    expect(r.error).toMatch(/out of range/iu);
  });

  it("a surgical append (insertAfter on the last node) passes the guard", async () => {
    const doc = prose(4);
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "3", action: "insertAfter", markdown: "A brand new closing paragraph." }],
      },
      opts
    );

    expect(r.ok).toBe(true);
    expect((getByPath(doc, parsePath("body")) as any).root.children.length).toBe(5);
  });

  it("a PARTIAL transform apply reports how many segments remain uncovered (a large field silently under-translated otherwise)", async () => {
    const doc = prose(4);
    const t = createRichTextTools(ws(doc), schema);
    const view: any = await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "transform",
        segments: { 0: "First done.", 1: "Second done." },
        nodeCount: view.nodeCount,
      },
      opts
    );

    expect(r.ok).toBe(true);
    expect(r.covered).toBe(2);
    expect(r.remaining).toBe(2);
    expect(r.note).toMatch(/2 of 4/u);
  });

  it("covering the remaining segments in a follow-up apply call brings remaining to 0 (no note)", async () => {
    const doc = prose(4);
    const t = createRichTextTools(ws(doc), schema);
    const view: any = await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);

    await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "transform",
        segments: { 0: "First done.", 1: "Second done." },
        nodeCount: view.nodeCount,
      },
      opts
    );
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "transform",
        segments: { 2: "Third done.", 3: "Fourth done." },
        nodeCount: view.nodeCount,
      },
      opts
    );

    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.note).toBeUndefined();
  });

  it("a fresh viewRichText(transform) resets coverage tracking for that ref", async () => {
    const doc = prose(4);
    const t = createRichTextTools(ws(doc), schema);

    await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);
    await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 0: "a", 1: "b", 2: "c", 3: "d" } },
      opts
    );
    await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 0: "e" } },
      opts
    );

    expect(r.remaining).toBe(3);
  });

  it("viewRichText(transform) nudges batching for a large field (>40 segments) instead of implying one giant call", async () => {
    const t = createRichTextTools(ws(prose(45)), schema);
    const r: any = await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);

    expect(r.hint).toMatch(/batches/iu);
  });

  it("onApplied receives transform coverage info, so the calling agent can react to a partial apply", async () => {
    const doc = prose(3);
    const calls: any[] = [];
    const t = createRichTextTools(ws(doc), schema, { onApplied: (info) => calls.push(info) });

    await t.applyRichText.execute!({ ref: "body", mode: "transform", segments: { 0: "x" } }, opts);
    expect(calls[0]).toMatchObject({ ref: "body", mode: "transform", remaining: 2, nodeCount: 3 });
  });
});

const exec = (doc: any, edits: any[]) =>
  createRichTextTools(ws(doc), schema).applyRichText.execute!(
    { ref: "body", mode: "surgical", edits },
    opts
  ) as any;
const formattedText = (value: string, format = 0) => ({
  type: "text",
  version: 1,
  format,
  text: value,
});

const formattedDoc = () => {
  const doc = makeRichDoc();

  doc.body.root.children[0] = {
    type: "paragraph",
    version: 1,
    children: [
      formattedText("Read the "),
      {
        type: "link",
        version: 1,
        fields: { url: "https://example.com/guide", linkType: "custom" },
        children: [formattedText("style guide")],
      },
      formattedText(" before the "),
      formattedText("first", 1),
      formattedText(" edit."),
    ],
  } as any;

  return doc;
};

describe("surgical anchor (fail-closed wrong-node protection)", () => {
  it("refuses replace/remove without an anchor", async () => {
    const r = await exec(makeRichDoc(), [{ key: "0", action: "replace", markdown: "x" }]);

    expect(r.error).toContain("requires an anchor");
  });

  it("refuses when expectedText is not found (drift)", async () => {
    const r = await exec(makeRichDoc(), [
      { key: "0", action: "replace", markdown: "x", expectedText: "Nonexistent" },
    ]);

    expect(r.error).toContain("not found");
  });

  it("accepts an anchor copied from the Markdown view with link syntax", async () => {
    const r = await exec(formattedDoc(), [
      {
        key: "0",
        action: "remove",
        expectedText: "Read the [style guide](https://example.com/guide) before",
      },
    ]);

    expect(r.error).toBeUndefined();
  });

  it("accepts an anchor copied from the Markdown view with bold syntax", async () => {
    const r = await exec(formattedDoc(), [
      { key: "0", action: "remove", expectedText: "before the **first** edit." },
    ]);

    expect(r.error).toBeUndefined();
  });

  it("still refuses a Markdown anchor on the wrong index", async () => {
    const r = await exec(formattedDoc(), [
      { key: "3", action: "remove", expectedText: "before the **first** edit." },
    ]);

    expect(r.error).toContain("index is wrong");
  });

  it("on a miss, gives the plain text of the indexed node as the value to send", async () => {
    const r = await exec(formattedDoc(), [
      { key: "0", action: "remove", expectedText: "Read the style-guide" },
    ]);

    expect(r.error).toContain("not found");
    expect(r.error).toContain('"Read the style guide before the first edit."');
    expect(r.error).toContain("plain text as expectedText");
  });

  it("refuses when the index points to a different node than the anchor (miscount)", async () => {
    const r = await exec(makeRichDoc(), [
      { key: "3", action: "replace", markdown: "x", expectedText: "Intro" },
    ]);

    expect(r.error).toContain("index is wrong");
  });

  it("refuses on ambiguous (duplicate) text", async () => {
    const dup = {
      id: "p",
      body: {
        root: {
          type: "root",
          version: 1,
          direction: "ltr",
          format: "",
          indent: 0,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [{ type: "text", version: 1, text: "Same line" }],
            },
            {
              type: "paragraph",
              version: 1,
              children: [{ type: "text", version: 1, text: "Same line" }],
            },
          ],
        },
      },
    };
    const r = await exec(dup, [
      { key: "0", action: "replace", markdown: "x", expectedText: "Same line" },
    ]);

    expect(r.error).toContain("ambiguous");
  });

  it("refuses when expectedType does not match the node at the index", async () => {
    const r = await exec(makeRichDoc(), [{ key: "0", action: "remove", expectedType: "upload" }]);

    expect(r.error).toContain('expected "upload"');
  });

  it("refuses a remove of a node the view shows as text when only its type is given", async () => {
    const doc = makeRichDoc();
    const r = await exec(doc, [{ key: "3", action: "remove", expectedType: "paragraph" }]);

    expect(r.error).toContain("expectedText");
    expect(r.error).toContain('"Tail"');
    expect(doc.body.root.children).toHaveLength(4);
  });

  it("takes the type alone for an empty paragraph and for one the view hides behind its link", async () => {
    const internal = {
      type: "paragraph",
      version: 1,
      children: [
        {
          type: "link",
          version: 3,
          fields: { linkType: "internal", doc: { relationTo: "posts", value: "x" } },
          children: [{ type: "text", version: 1, text: "Read the guide" }],
        },
      ],
    };
    const doc = makeRichDoc();

    doc.body.root.children.push(internal as any, { type: "paragraph", version: 1, children: [] });
    const r = await exec(doc, [
      { key: "4", action: "remove", expectedType: "paragraph" },
      { key: "5", action: "replace", markdown: "New text", expectedType: "paragraph" },
    ]);

    expect(r.error).toBeUndefined();
    expect(JSON.stringify(doc.body)).not.toContain("Read the guide");
    expect(JSON.stringify(doc.body)).toContain("New text");
  });

  it("refuses two edits targeting the same node index (overlap clobber)", async () => {
    const r = await exec(makeRichDoc(), [
      { key: "1", action: "remove", expectedType: "block" },
      { key: "1", action: "remove", expectedType: "block" },
    ]);

    expect(r.error).toContain("same node index");
  });

  it("refuses an empty replace (would silently delete the node)", async () => {
    const r = await exec(makeRichDoc(), [
      { key: "0", action: "replace", markdown: "", expectedText: "Intro" },
    ]);

    expect(r.error).toContain("non-empty");
  });

  it("removing one structural type does not license dropping another", async () => {
    const r = await exec(makeRichDoc(), [
      { key: "1", action: "remove", expectedType: "block" },
      { key: "2", action: "replace", markdown: "plain text", expectedType: "upload" },
    ]);

    expect(r.error).toContain("would drop");
  });
});

const listItem = (value: number, ...children: any[]) => ({
  type: "listitem",
  version: 1,
  value,
  children,
});
const plain = (value: string) => ({ type: "text", version: 1, text: value });

const listDoc = (...items: any[]) => ({
  id: "p",
  body: {
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [
        { type: "paragraph", version: 1, children: [plain("Intro")] },
        { type: "list", version: 1, listType: "number", start: 1, tag: "ol", children: items },
      ],
    },
  },
});

const threeItems = () =>
  listDoc(
    listItem(1, plain("[CHECK: marked note]")),
    listItem(2, plain("Second point")),
    listItem(3, plain("Third point"))
  );

const itemTexts = (doc: any) =>
  doc.body.root.children[1].children.map((item: any) => item.children[0].text);

const removeTextIn = (doc: any, removeText: string) =>
  createRichTextTools(ws(doc), schema).applyRichText.execute!(
    { ref: "body", mode: "transform", removeText },
    opts
  ) as any;

describe("a list item", () => {
  it("a remove anchored in one item of a list is refused with the calls for the item and for the list", async () => {
    const doc = threeItems();
    const r = await exec(doc, [
      { key: "1", action: "remove", expectedText: "[CHECK: marked note]" },
    ]);

    expect(r.error).toContain("removeText");
    expect(r.error).toContain('expectedType: "list"');
    expect(itemTexts(doc)).toEqual(["[CHECK: marked note]", "Second point", "Third point"]);
  });

  it("a remove of the whole list goes through with its type next to the text", async () => {
    const doc = threeItems();
    const r = await exec(doc, [
      { key: "1", action: "remove", expectedText: "Second point", expectedType: "list" },
    ]);

    expect(r.error).toBeUndefined();
    expect(doc.body.root.children).toHaveLength(1);
  });

  it("a remove anchored in the only item of a list removes the list", async () => {
    const doc = listDoc(listItem(1, plain("Only point")));
    const r = await exec(doc, [{ key: "1", action: "remove", expectedText: "Only point" }]);

    expect(r.error).toBeUndefined();
    expect(doc.body.root.children).toHaveLength(1);
  });

  it("removeText that empties an item removes the item and numbers the rest again", async () => {
    const doc = threeItems();
    const r = await removeTextIn(doc, "[CHECK: marked note]");

    expect(r.error).toBeUndefined();
    expect(r.removedOccurrences).toBe(1);
    expect(itemTexts(doc)).toEqual(["Second point", "Third point"]);
    expect(doc.body.root.children[1].children.map((item: any) => item.value)).toEqual([1, 2]);
  });

  it("removeText does not empty the only item of a list, nor an item that a nested list follows", async () => {
    const only = listDoc(listItem(1, plain("Only point")));
    const alone = await removeTextIn(only, "Only point");

    expect(alone.error).toMatch(/surgical remove/u);
    expect(itemTexts(only)).toEqual(["Only point"]);
    const nested = listDoc(
      listItem(1, plain("Parent point")),
      listItem(2, { type: "list", version: 1, children: [listItem(1, plain("Child point"))] }),
      listItem(2, plain("Second point"))
    );
    const parent = await removeTextIn(nested, "Parent point");

    expect(parent.error).toBeDefined();
    expect(JSON.stringify(nested.body)).toContain("Child point");
  });
});

describe("empty-root safety (admin editor never receives an empty state)", () => {
  it("emptyRichText() is a VALID empty state - one paragraph, not children:[]", () => {
    const v = emptyRichText();

    expect(v.root.children).toHaveLength(1);
    expect(v.root.children[0].type).toBe("paragraph");
    expect(isEmptyRichText(v)).toBe(true);
  });

  it("ensureNonEmptyRichText injects a paragraph into an empty root, leaves content alone", () => {
    const empty = {
      root: { type: "root", children: [], version: 1, direction: "ltr", format: "", indent: 0 },
    };

    ensureNonEmptyRichText(empty);
    expect(empty.root.children).toHaveLength(1);
    const full = makeLexicalDoc("keep me");

    ensureNonEmptyRichText(full);
    expect(JSON.stringify(full)).toContain("keep me");
    expect(full.root.children).toHaveLength(1);
  });

  it("surgical remove of the ONLY node never persists an empty root", async () => {
    const doc = { id: "p", body: makeLexicalDoc("the only paragraph") };
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "0", action: "remove", expectedText: "the only paragraph" }],
      },
      opts
    );

    expect(r.ok).toBe(true);
    const body: any = getByPath(doc, parsePath("body"));

    expect(body.root.children.length).toBeGreaterThanOrEqual(1);
  });

  it("viewing an empty field leaves the open document as it is", async () => {
    const doc = {
      id: "p",
      body: {
        root: { type: "root", children: [], version: 1, direction: "ltr", format: "", indent: 0 },
      },
    };
    const before = JSON.stringify(doc);
    const t = createRichTextTools(ws(doc), schema);

    await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);
    await t.viewRichText.execute!({ ref: "body", mode: "surgical" }, opts);

    expect(JSON.stringify(doc)).toBe(before);
  });
});

const gluedDoc = () => ({
  id: "p",
  body: {
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [
        {
          type: "paragraph",
          version: 1,
          children: [
            { type: "text", version: 1, text: "Lokalise", format: 1 },
            { type: "text", version: 1, text: " explains how" },
            {
              type: "link",
              version: 3,
              fields: { url: "https://x.com/cl", linkType: "custom" },
              children: [{ type: "text", version: 1, text: "continuous localization" }],
            },
            { type: "text", version: 1, text: "removes the bottleneck." },
          ],
        },
      ],
    },
  },
});

describe("transform mode: inline neighbours", () => {
  it("the transform view shows the characters either side of a segment that shares its paragraph", async () => {
    const t = createRichTextTools(ws(gluedDoc()), schema);
    const r: any = await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);

    expect(r.segments[2]).toBe("continuous localization");
    expect(r.context[2]).toEqual({
      before: "Lokalise explains how",
      after: "removes the bottleneck.",
    });
    expect(r.hint).toMatch(/glued/u);
    expect(r.glued.map((g: any) => g.between)).toEqual(["1|2", "2|3"]);
  });

  it("a segment that lost its words and kept only marks is named, with the call that removes it", async () => {
    const doc = gluedDoc();
    const t = createRichTextTools(ws(doc), schema);
    const left: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 3: ". " } },
      opts
    );

    expect(left.residue).toEqual([{ segment: "3", now: ". " }]);
    expect(left.residueNote).toMatch(/removeText/u);
    const clean: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 1: " explains how " } },
      opts
    );

    expect(clean.residue).toBeUndefined();
  });

  it("removeText removes the named text, case and spacing aside, and nothing else", async () => {
    const doc = gluedDoc();
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", removeText: "EXPLAINS  how" },
      opts
    );

    expect(r.error).toBeUndefined();
    expect(r.removedOccurrences).toBe(1);
    expect(doc.body.root.children[0].children.map((child: any) => child.text ?? "link")).toEqual([
      "Lokalise",
      "link",
      "removes the bottleneck.",
    ]);
  });

  it("removeText keeps the rest of a segment and refuses a text the field does not hold", async () => {
    const doc = gluedDoc();
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", removeText: "the bottleneck" },
      opts
    );

    expect(r.removedOccurrences).toBe(1);
    expect(doc.body.root.children[0].children[3].text).toBe("removes.");
    const none: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", removeText: "Editor note of 16 March" },
      opts
    );

    expect(none.error).toMatch(/Nothing was removed/u);
  });

  it("an empty segment is refused with the call that names the text", async () => {
    const doc = gluedDoc();
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 1: "" } },
      opts
    );

    expect(r.error).toMatch(/removeText/u);
    expect(doc.body.root.children[0].children[1].text).toBe(" explains how");
  });

  it("a single-segment paragraph gets no context entry", async () => {
    const t = createRichTextTools(ws({ id: "p", body: makeLexicalDoc("Hello world") }), schema);
    const r: any = await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);

    expect(r.context).toBeUndefined();
  });

  it("transform apply refuses a segment that copies its neighbour in, and accepts a space added inside the segment", async () => {
    const doc = gluedDoc();
    const t = createRichTextTools(ws(doc), schema);
    const bad: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 1: "Lokalise explains how " } },
      opts
    );

    expect(bad.error).toMatch(/segment before it/u);
    expect(doc.body.root.children[0].children[1].text).toBe(" explains how");
    const good: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "transform",
        segments: { 1: " explains how ", 3: " removes the bottleneck." },
      },
      opts
    );

    expect(good.ok).toBe(true);
    expect(doc.body.root.children[0].children[1].text).toBe(" explains how ");
    expect(doc.body.root.children[0].children[3].text).toBe(" removes the bottleneck.");
  });
});

describe("transform mode: inline markdown in a segment", () => {
  it("keeps the moved-indices note next to the coverage note, and refuses old indices without a nodeCount", async () => {
    const body = makeLexicalDoc("Intro text");

    body.root.children.push(
      structuredClone(makeLexicalDoc("Second paragraph of the body is here.").root.children[0])
    );
    const doc = { id: "p", body };
    const t = createRichTextTools(ws(doc), schema);
    const view: any = await t.viewRichText.execute!({ ref: "body", mode: "transform" }, opts);

    expect(view.nodeCount).toBe(2);
    const first: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "transform",
        segments: { 0: "Intro [text](https://x.io)" },
        nodeCount: 2,
      },
      opts
    );

    expect(first.linksNote).toMatch(/indices have moved/u);
    expect(first.note).toMatch(/1 of 2 text segment/u);
    const second: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 1: "The second paragraph, rewritten." } },
      opts
    );

    expect(second.error).toMatch(/changed since the transform view/u);
    expect(doc.body.root.children[1].children[0].text).toBe(
      "Second paragraph of the body is here."
    );
  });

  it("turns [text](url) in a segment into a real link node instead of literal brackets", async () => {
    const doc = { id: "p", body: makeLexicalDoc("See the docs for details.") };
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "transform",
        segments: { 0: "See the [Payload docs](https://payloadcms.com/docs) for details." },
      },
      opts
    );

    expect(r.ok).toBe(true);
    expect(r.linksCreated).toBe(1);
    expect(r.linksNote).toMatch(/view/iu);
    const children: any[] = doc.body.root.children[0].children;

    expect(children.map((c: any) => c.type)).toEqual(["text", "link", "text"]);
    expect(children[1].fields).toEqual({
      url: "https://payloadcms.com/docs",
      newTab: true,
      linkType: "custom",
    });
    expect(children[1].children[0].text).toBe("Payload docs");
    expect(children[0].text).toBe("See the ");
    expect(children[2].text).toBe(" for details.");
    expect(JSON.stringify(doc.body)).not.toContain("](");
  });

  it("refuses a link target that is not a web address, a path, an anchor, mail or phone", async () => {
    const doc = { id: "p", body: makeLexicalDoc("Hello world") };
    const before = JSON.stringify(doc);
    const t = createRichTextTools(ws(doc), schema);
    const segment: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "transform",
        segments: { 0: "See [details](javascript:alert(1)) here." },
      },
      opts
    );
    const surgical: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "0", action: "insertAfter", markdown: "Read [this](data:text/html,x)." }],
      },
      opts
    );

    expect(segment.error).toContain('"javascript:alert(1"');
    expect(surgical.error).toContain('"data:text/html,x"');
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("opens only a full web address in a new tab", async () => {
    const doc = { id: "p", body: makeLexicalDoc("Hello world") };
    const t = createRichTextTools(ws(doc), schema);

    await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 0: "See [pricing](/pricing) here." } },
      opts
    );
    await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "0", action: "insertAfter", markdown: "Mail [us](mailto:a@b.co)." }],
      },
      opts
    );
    const links = JSON.stringify(doc.body);

    expect(links).toContain('"url":"/pricing","newTab":false');
    expect(links).toMatch(
      /"url":"mailto:a@b.co"[^}]*"newTab":false|"newTab":false[^}]*"url":"mailto:a@b.co"/u
    );
  });

  it("turns **text** into a bold text node", async () => {
    const doc = { id: "p", body: makeLexicalDoc("Hello world") };
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 0: "Hello **brave** world" } },
      opts
    );

    expect(r.ok).toBe(true);
    const children = doc.body.root.children[0].children;

    expect(children.map((c: any) => [c.text, c.format])).toEqual([
      ["Hello ", 0],
      ["brave", 1],
      [" world", 0],
    ]);
  });

  it("refuses block markdown inside a segment and points at surgical mode", async () => {
    const doc = { id: "p", body: makeLexicalDoc("Hello world") };
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 0: "## Hello world" } },
      opts
    );

    expect(r.error).toMatch(/surgical/u);
    expect(doc.body.root.children[0].children[0].text).toBe("Hello world");
  });

  it("refuses a markdown link written into the text of an existing link", async () => {
    const doc = {
      id: "p",
      body: {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [
                {
                  type: "link",
                  version: 3,
                  fields: { url: "https://x.com", linkType: "custom" },
                  children: [{ type: "text", version: 1, text: "anchor" }],
                },
              ],
            },
          ],
        },
      },
    };
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 0: "[anchor](https://y.com)" } },
      opts
    );

    expect(r.error).toMatch(/itself the text of a link/u);
  });
});

const link = (url: string, t: string) => ({
  type: "link",
  version: 1,
  fields: { url, linkType: "custom" },
  children: [{ type: "text", version: 1, format: 0, text: t }],
});

describe("surgical replace: shrink guard (a paragraph replaced by the two words around a new link)", () => {
  const long =
    "A couple of months ago I built an MVP of a content agent for Payload and wrote about it in a separate article. There I put it next to Sanity’s agent on simple tasks: finding links, verifying a list of articles, and running a bulk replacement.";

  it("refuses a replace that carries a fragment of a long paragraph and points at transform mode", async () => {
    const doc = { id: "p", body: makeLexicalDoc(long) };
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [
          {
            key: "0",
            action: "replace",
            markdown: "[Sanity](https://www.sanity.io)’s agent",
            expectedText: "A couple of months ago",
          },
        ],
      },
      opts
    );

    expect(r.error).toMatch(/shrink/u);
    expect(r.error).toMatch(/transform mode/u);
    expect(doc.body.root.children[0].children[0].text).toBe(long);
  });
  it("accepts a replace that carries the whole paragraph with the change in it", async () => {
    const doc = { id: "p", body: makeLexicalDoc(long) };
    const t = createRichTextTools(ws(doc), schema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [
          {
            key: "0",
            action: "replace",
            markdown: long.replace("Sanity’s", "[Sanity](https://www.sanity.io)’s"),
            expectedText: "A couple of months ago",
          },
        ],
      },
      opts
    );

    expect(r.ok).toBe(true);
    expect(JSON.stringify(doc.body)).toContain('"url":"https://www.sanity.io"');
  });
  it("lets a shortening task replace with a fragment (shrinkRatio null) and leaves short nodes alone", async () => {
    const doc = { id: "p", body: makeLexicalDoc(long) };
    const t = createRichTextTools(ws(doc), schema, { guards: { shrinkRatio: () => null } });
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [
          {
            key: "0",
            action: "replace",
            markdown: "Short version.",
            expectedText: "A couple of months ago",
          },
        ],
      },
      opts
    );

    expect(r.ok).toBe(true);
    const doc2 = { id: "p", body: makeLexicalDoc("A short heading-like line of text.") };
    const t2 = createRichTextTools(ws(doc2), schema);
    const r2: any = await t2.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [
          { key: "0", action: "replace", markdown: "Shorter.", expectedText: "A short heading" },
        ],
      },
      opts
    );

    expect(r2.ok).toBe(true);
  });

  it("a surgical replace that drops the links the node has is refused, unless fewer links are declared", async () => {
    const body = {
      root: {
        type: "root",
        version: 1,
        direction: "ltr",
        format: "",
        indent: 0,
        children: [
          {
            type: "paragraph",
            version: 1,
            children: [
              { type: "text", version: 1, format: 0, text: "A couple of months ago I " },
              link("https://my-agency.example/blog/payload-content-agent/", "built an MVP"),
              {
                type: "text",
                version: 1,
                format: 0,
                text: " and wrote about it. There I put it next to ",
              },
              link("https://www.sanity.io", "Sanity’s agent"),
              {
                type: "text",
                version: 1,
                format: 0,
                text: " on simple tasks: finding links, verifying a list of articles, and running a bulk replacement. The results were very close.",
              },
            ],
          },
        ],
      },
    };
    const fragment =
      "There I put it next to [Sanity](https://my-agency.example/blog/)’s agent on simple tasks: finding links, verifying a list of articles, and running a bulk replacement. The results were very close.";
    const doc = { id: "p", body: structuredClone(body) };
    const t = createRichTextTools(ws(doc), schema, {
      guards: { linkIntent: () => "more" },
    });
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [
          {
            key: "0",
            action: "replace",
            markdown: fragment,
            expectedText: "There I put it next to",
          },
        ],
      },
      opts
    );

    expect(r.error).toMatch(/would drop 2 link\(s\)/u);
    expect(r.error).toContain("https://www.sanity.io");
    expect(JSON.stringify(doc.body)).toContain("payload-content-agent");
    const whole =
      "A couple of months ago I [built an MVP](https://my-agency.example/blog/payload-content-agent/) and wrote about it. There I put it next to [Sanity’s agent](https://www.sanity.io) on simple tasks: finding links, verifying a list of articles, and running a bulk replacement. The results were very close.";
    const r2: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [
          { key: "0", action: "replace", markdown: whole, expectedText: "There I put it next to" },
        ],
      },
      opts
    );

    expect(r2.ok).toBe(true);
    const doc2 = { id: "p", body: structuredClone(body) };
    const t2 = createRichTextTools(ws(doc2), schema, {
      guards: { linkIntent: () => "fewer" },
    });
    const r3: any = await t2.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [
          {
            key: "0",
            action: "replace",
            markdown:
              "A couple of months ago I built an MVP and wrote about it. There I put it next to Sanity’s agent on simple tasks: finding links, verifying a list of articles, and running a bulk replacement. The results were very close.",
            expectedText: "There I put it next to",
          },
        ],
      },
      opts
    );

    expect(r3.ok).toBe(true);
  });
});

const bodySchema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [{ name: "body", type: "richText", editor: "lexical" }] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

describe("richtextTools: onApplied fires even for a legitimately idempotent transform", () => {
  it("applyRichText transform calls onApplied even when the resulting text is unchanged", async () => {
    const lexical = {
      root: {
        type: "root",
        version: 1,
        children: [
          {
            type: "paragraph",
            version: 1,
            children: [{ type: "text", version: 1, text: "Bonjour" }],
          },
        ],
      },
    };
    const doc = { id: "p", body: lexical };
    const workspace: DocumentWorkspace = { ref: { current: doc }, collection: "posts" };
    let applied = false;
    const t = createRichTextTools(workspace, bodySchema, {
      onApplied: () => {
        applied = true;
      },
    });
    const res: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { "0": "Bonjour" } },
      opts
    );

    expect(res.ok).toBe(true);
    expect(applied).toBe(true);
  });
});

const bareParagraph = (t: string) => ({
  type: "paragraph",
  version: 1,
  children: [{ type: "text", version: 1, text: t }],
});
const block = (id: string) => ({
  type: "block",
  version: 2,
  fields: { id, blockType: "cta", heading: id },
});
const bareRoot = (...c: any[]) => ({ root: { type: "root", version: 1, children: c } });

describe("richtext surgical guard: count-aware structural drop", () => {
  it("refuses a batch that removes ONE block but a same-type replace clobbers a SECOND", async () => {
    const doc = {
      id: "p",
      body: bareRoot(bareParagraph("intro"), block("a"), bareParagraph("mid"), block("b")),
    };
    const workspace: DocumentWorkspace = { ref: { current: doc }, collection: "posts" };
    const t = createRichTextTools(workspace, bodySchema);
    const res: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [
          { key: "1", action: "remove", expectedType: "block" },
          { key: "3", action: "replace", expectedType: "block", markdown: "Thanks for reading." },
        ],
      },
      opts
    );

    expect(res.ok).toBeUndefined();
    expect(res.error).toMatch(/drop a "block"/u);
    expect((doc.body.root.children as any[]).length).toBe(4);
  });

  it("still allows removing exactly the blocks that were anchored", async () => {
    const doc = {
      id: "p",
      body: bareRoot(bareParagraph("intro"), block("a"), bareParagraph("outro")),
    };
    const workspace: DocumentWorkspace = { ref: { current: doc }, collection: "posts" };
    const t = createRichTextTools(workspace, bodySchema);
    const res: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "1", action: "remove", expectedType: "block" }],
      },
      opts
    );

    expect(res.ok).toBe(true);
    expect((doc.body.root.children as any[]).length).toBe(2);
  });
});

const para = (text: string) => ({
  type: "paragraph",
  version: 1,
  direction: "ltr",
  format: "",
  indent: 0,
  textFormat: 0,
  textStyle: "",
  children: [{ type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" }],
});
const lexicalRoot = (...children: any[]) => ({
  root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children },
});

describe("rich-text tools on an open GLOBAL", () => {
  const globalSchema: SchemaContext = {
    collections: [],
    globals: [
      {
        slug: "site-settings",
        fields: [{ name: "aboutText", type: "richText", editor: "lexical" }] as SchemaField[],
        hasVersions: true,
        hasDrafts: true,
      },
    ],
  };

  it("viewRichText and applyRichText work when the workspace holds a global", async () => {
    const doc = { aboutText: lexicalRoot(para("We build websites")) };
    const workspace: DocumentWorkspace = {
      ref: { current: doc },
      collection: null,
      global: "site-settings",
    };
    const t = createRichTextTools(workspace, globalSchema);

    const view: any = await t.viewRichText.execute!({ ref: "aboutText", mode: "transform" }, opts);

    expect(view.error).toBeUndefined();
    expect(view.segments[0]).toBe("We build websites");

    const applied: any = await t.applyRichText.execute!(
      { ref: "aboutText", mode: "transform", segments: { 0: "Construimos sitios web" } },
      opts
    );

    expect(applied.ok).toBe(true);
    expect(JSON.stringify(getByPath(doc, parsePath("aboutText")))).toContain(
      "Construimos sitios web"
    );
  });
});

describe("surgical edit index bounds", () => {
  it("refuses an out-of-range insertAfter instead of silently dropping it", async () => {
    const doc = { id: "p", body: lexicalRoot(para("one"), para("two")) };
    const workspace: DocumentWorkspace = { ref: { current: doc }, collection: "posts" };
    const t = createRichTextTools(workspace, bodySchema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "2", action: "insertAfter", markdown: "three" }],
      },
      opts
    );

    expect(r.ok).toBeUndefined();
    expect(r.error).toContain("valid: 0..1");
    expect((doc.body.root.children as any[]).length).toBe(2);
  });

  it("appending via the LAST index still works", async () => {
    const doc = { id: "p", body: lexicalRoot(para("one"), para("two")) };
    const workspace: DocumentWorkspace = { ref: { current: doc }, collection: "posts" };
    const t = createRichTextTools(workspace, bodySchema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "1", action: "insertAfter", markdown: "three" }],
      },
      opts
    );

    expect(r.ok).toBe(true);
    expect((doc.body.root.children as any[]).length).toBe(3);
  });
});
