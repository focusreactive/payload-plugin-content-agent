import { describe, it, expect } from "vitest";

import { keepSpacesOutOfLinks } from "../src/agent/content/linkEdges.js";
import { collectTextNodes } from "../src/agent/content/lexicalEngine.js";
import { applyTransform } from "../src/agent/content/richtext/surgical.js";
import { createRichTextTools } from "../src/agent/content/richtextTools.js";
import type { SchemaContext } from "../src/types.js";

const text = (value: string) => ({
  type: "text",
  version: 1,
  text: value,
  format: 0,
  detail: 0,
  mode: "normal",
  style: "",
});
const link = (value: string, url: string) => ({
  type: "link",
  version: 1,
  fields: { linkType: "custom", url },
  children: [text(value)],
});
const paragraph = (...children: unknown[]) => ({ type: "paragraph", version: 1, children });
const body = (...children: unknown[]) => ({ root: { type: "root", version: 1, children } });

const para = {};
const units = [
  { text: "starts with a", link: false, group: para },
  { text: "style guide", link: true, group: para },
  { text: "that every one follows.", link: false, group: para },
];

describe("a space added at the edge of a link text moves outside the link", () => {
  it("moves both edge spaces to the neighbouring text", () => {
    expect(keepSpacesOutOfLinks({ "1": " style guide " }, units)).toEqual({
      "0": "starts with a ",
      "1": "style guide",
      "2": " that every one follows.",
    });
  });

  it("does not double a space the neighbour already gets in the same call", () => {
    const result = keepSpacesOutOfLinks({ "0": "starts with a ", "1": " style guide" }, units);

    expect(result).toEqual({ "0": "starts with a ", "1": "style guide" });
  });

  it("keeps a space the link text already had", () => {
    const spaced = [units[0], { ...units[1], text: " style guide" }, units[2]];

    expect(keepSpacesOutOfLinks({ "1": " style manual" }, spaced)).toEqual({
      "1": " style manual",
    });
  });

  it("leaves the value alone when no text of the same paragraph is next to the link", () => {
    const alone = [{ ...units[0], group: {} }, units[1]];

    expect(keepSpacesOutOfLinks({ "1": " style guide" }, alone)).toEqual({ "1": " style guide" });
  });

  it("reads keys that start at one", () => {
    expect(keepSpacesOutOfLinks({ "2": "style guide " }, units, 1)).toEqual({
      "2": "style guide",
      "3": " that every one follows.",
    });
  });

  it("the transform write stores the spaces outside the link", () => {
    const content = body(
      paragraph(
        text("starts with a"),
        link("style guide", "https://example.org/a"),
        text("that every one follows.")
      )
    );
    const result = applyTransform(content, { "1": " style guide " }, 3);

    expect("error" in result ? result.error : undefined).toBeUndefined();
    if ("error" in result) return;
    expect(collectTextNodes(result.updated).map((ref) => ref.node.text)).toEqual([
      "starts with a ",
      "style guide",
      " that every one follows.",
    ]);
  });
});

describe("the transform view gives the fix for every glued boundary", () => {
  const schema: SchemaContext = {
    globals: [],
    collections: [
      {
        slug: "records",
        fields: [{ name: "note", type: "richText", editor: "lexical" }],
        hasVersions: true,
        hasDrafts: true,
        hasAuth: false,
        timestamps: true,
      },
    ],
  };
  const call = { toolCallId: "t", messages: [] } as any;

  it("the fix puts one space at each boundary, outside the links", async () => {
    const current = {
      id: 1,
      note: body(
        paragraph(
          text("starts with a"),
          link("style guide", "https://example.org/a"),
          text("that every one follows.")
        ),
        paragraph(text("A line with no link."))
      ),
    };
    const tools = createRichTextTools({ ref: { current }, collection: "records" }, schema);
    const view: any = await tools.viewRichText.execute!({ ref: "note", mode: "transform" }, call);

    expect(view.glued).toEqual([
      { between: "0|1", shows: "tarts with a|style guidet" },
      { between: "1|2", shows: "style guide|that every o" },
    ]);

    const applied: any = await tools.applyRichText.execute!(
      { ref: "note", mode: "transform", fixGlued: true, nodeCount: view.nodeCount },
      call
    );

    expect(applied.error).toBeUndefined();
    expect(applied.gluedLeft).toBeUndefined();
    expect((current.note.root.children[0] as any).children[0].text).toBe("starts with a ");
    expect((current.note.root.children[0] as any).children[2].text).toBe(
      " that every one follows."
    );
    const after: any = await tools.viewRichText.execute!({ ref: "note", mode: "transform" }, call);

    expect(after.glued).toBeUndefined();
    expect(after.segments[1]).toBe("style guide");
  });

  it("one text between two links gets both of its spaces, and a second call has nothing to add", async () => {
    const current = {
      id: 1,
      note: body(
        paragraph(
          link("First", "https://example.org/a"),
          text("and"),
          link("second", "https://example.org/b"),
          text("differ.")
        )
      ),
    };
    const tools = createRichTextTools({ ref: { current }, collection: "records" }, schema);
    const applied: any = await tools.applyRichText.execute!(
      { ref: "note", mode: "transform", fixGlued: true },
      call
    );
    const texts = (current.note.root.children[0] as any).children.map(
      (child: any) => child.text ?? child.children[0].text
    );

    expect(applied.error).toBeUndefined();
    expect(texts).toEqual(["First", " and ", "second", " differ."]);
    const again: any = await tools.applyRichText.execute!(
      { ref: "note", mode: "transform", fixGlued: true },
      call
    );

    expect(again.error).toMatch(/no two words run together/u);
  });

  it("a write that fixes one boundary of two names the one that is left and the call that fixes it", async () => {
    const current = {
      id: 1,
      note: body(
        paragraph(
          text("starts with a"),
          link("style guide", "https://example.org/a"),
          text("that every one follows.")
        )
      ),
    };
    const tools = createRichTextTools({ ref: { current }, collection: "records" }, schema);
    const applied: any = await tools.applyRichText.execute!(
      { ref: "note", mode: "transform", segments: { 0: "starts with a " } },
      call
    );

    expect(applied.gluedLeft).toEqual([{ between: "1|2", shows: "style guide|that every o" }]);
    expect(applied.gluedNote).toMatch(/fixGlued: true/u);
  });
});
