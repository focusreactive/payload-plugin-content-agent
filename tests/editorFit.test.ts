import { describe, it, expect } from "vitest";
import { sanitizeConfig } from "payload";
import {
  BlocksFeature,
  ItalicFeature,
  LinkFeature,
  ParagraphFeature,
  lexicalEditor,
} from "@payloadcms/richtext-lexical";
import { introspectSchema } from "../src/schema/introspector.js";
import { editorFitError, simplifyForEditor } from "../src/agent/content/editorFit.js";
import { validateLexical, writeTextNode } from "../src/agent/content/lexicalEngine.js";
import { validateFieldValue } from "../src/agent/content/schemaValues.js";
import { createRichTextTools } from "../src/agent/content/richtextTools.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const text = (value: string, format = 0) => ({
  type: "text",
  version: 1,
  text: value,
  format,
  detail: 0,
  mode: "normal",
  style: "",
});
const element = (type: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  type,
  version: 1,
  direction: null,
  format: "",
  indent: 0,
  children,
  ...extra,
});
const doc = (...children: unknown[]) => ({ root: element("root", children) });
const link = (url: string, label: string) =>
  element("link", [text(label)], { version: 3, fields: { url, linkType: "custom", newTab: true } });

const narrow: SchemaField = {
  name: "note",
  type: "richText",
  editor: "lexical",
  features: ["paragraph", "italic"],
  nodeTypes: [],
};
const unknownEditor: SchemaField = { name: "note", type: "richText", editor: "lexical" };

async function hostSchema(): Promise<SchemaContext> {
  const config = await sanitizeConfig({
    secret: "x",
    db: { defaultIDType: "number", init: () => ({}) },
    editor: lexicalEditor({}),
    collections: [
      {
        slug: "records",
        fields: [
          {
            name: "note",
            type: "richText",
            editor: lexicalEditor({
              features: [
                ParagraphFeature(),
                ItalicFeature(),
                LinkFeature(),
                BlocksFeature({
                  blocks: [{ slug: "callout", fields: [{ name: "tip", type: "text" }] }],
                }),
              ],
            }),
          },
        ],
      },
    ],
  } as any);

  return introspectSchema(config);
}

describe("rich text follows the editor of its own field", () => {
  it("reads the node types of a field's editor from the host config", async () => {
    const [note] = (await hostSchema()).collections[0].fields;

    expect(note.nodeTypes).toEqual(expect.arrayContaining(["link", "autolink", "block"]));
    expect(note.nodeTypes).not.toContain("heading");
    expect(note.features).toEqual(expect.arrayContaining(["italic", "link"]));
  });

  it("parses with the nodes of the field's editor, not of the site default", async () => {
    const [note] = (await hostSchema()).collections[0].fields;
    const content = doc(element("paragraph", [text("Hi "), link("https://example.org", "there")]), {
      type: "block",
      version: 2,
      format: "",
      fields: { id: "b1", blockType: "callout", tip: "x" },
    });

    expect(await validateLexical(content, undefined, note)).toEqual({ ok: true, validated: true });
  });

  it("refuses a node type and a text format the editor does not have, and lists what it has", () => {
    const before = doc(element("paragraph", [text("One")]));
    const after = doc(
      element("heading", [text("One")], { tag: "h2" }),
      element("paragraph", [text("Two", 1)])
    );
    const error = editorFitError(narrow, before, after);

    expect(error).toContain('no "heading" node');
    expect(error).toContain('no "bold" text format');
    expect(error).toContain("Node types it has: paragraph, text, linebreak, tab.");
    expect(error).toContain("Text formats it has: italic.");
  });

  it("leaves alone what the document already held and what the editor has", () => {
    const legacy = doc(element("heading", [text("Old", 1)], { tag: "h2" }));
    const after = doc(
      element("heading", [text("Old", 1)], { tag: "h2" }),
      element("paragraph", [text("New", 2)])
    );

    expect(editorFitError(narrow, legacy, after)).toBeNull();
  });

  it("does not count rich text nested in the fields of a block", () => {
    const block = {
      type: "block",
      version: 2,
      fields: { blockType: "callout", body: doc(element("heading", [text("In")], { tag: "h2" })) },
    };

    expect(editorFitError({ ...narrow, nodeTypes: ["block"] }, doc(), doc(block))).toBeNull();
  });

  it("checks nothing when the editor of the field is not known", () => {
    const after = doc(element("heading", [text("One", 1)], { tag: "h2" }));

    expect(editorFitError(unknownEditor, doc(), after)).toBeNull();
  });

  it("refuses a raw value with a node the editor does not have", () => {
    const result = validateFieldValue(narrow, doc(element("quote", [text("Said")])));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('no "quote" node');
  });

  it("refuses inline markup in a text segment before it changes the document", () => {
    const node = text("See the guide") as any;
    const block = element("paragraph", [node]);
    const written = writeTextNode(block, node, "See [the guide](https://example.org)", {
      label: "Entry 1",
      field: narrow,
    });

    expect("error" in written && written.error).toContain('no "link" node');
    expect(block.children).toEqual([node]);
    expect(node.text).toBe("See the guide");
  });

  it("refuses a surgical edit that adds a heading to an editor without one", async () => {
    const schema: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "records",
          fields: [narrow],
          hasVersions: true,
          hasDrafts: true,
          hasAuth: false,
          timestamps: true,
        },
      ],
    };
    const current = { id: 1, note: doc(element("paragraph", [text("One")])) };
    const tools = createRichTextTools({ ref: { current }, collection: "records" }, schema);
    const call = { toolCallId: "t", messages: [] } as any;
    const view: any = await tools.viewRichText.execute!({ ref: "note", mode: "surgical" }, call);
    const result: any = await tools.applyRichText.execute!(
      {
        ref: "note",
        mode: "surgical",
        edits: [{ key: "0", action: "insertAfter", markdown: "## Two" }],
      },
      call
    );

    expect(view.editor).toContain("Node types it has: paragraph");
    expect(result.error).toContain('no "heading" node');
    expect(current.note.root.children).toHaveLength(1);
  });

  it("simplifies imported content to what the editor has and keeps the text", () => {
    const imported = doc(
      element("heading", [text("Title", 1)], { tag: "h1" }),
      element("list", [element("listitem", [text("a")]), element("listitem", [text("b", 2)])]),
      element("paragraph", [link("https://example.org", "only a link")]),
      { type: "horizontalrule", version: 1 }
    );
    const { content, simplified } = simplifyForEditor(narrow, imported) as any;
    const shape = content.root.children.map((node: any) => [
      node.type,
      node.children.map((child: any) => [child.type, child.text, child.format]),
    ]);

    expect(shape).toEqual([
      ["paragraph", [["text", "Title", 0]]],
      ["paragraph", [["text", "a", 0]]],
      ["paragraph", [["text", "b", 2]]],
      ["paragraph", [["text", "only a link", 0]]],
    ]);
    expect(simplified.sort()).toEqual([
      "bold",
      "heading",
      "horizontalrule",
      "link",
      "list",
      "listitem",
    ]);
  });

  it("leaves imported content whole when the editor has every node in it", () => {
    const imported = doc(element("heading", [text("Title", 1)], { tag: "h1" }));
    const full = { ...narrow, features: ["bold"], nodeTypes: ["heading"] };

    expect(simplifyForEditor(full, imported)).toEqual({ content: imported, simplified: [] });
  });
});
