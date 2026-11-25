import { describe, expect, it } from "vitest";
import { classifyChange } from "../src/agent/content/changeClass.js";
import { needsReviewer } from "../src/agent/content/editor/review.js";
import type { SchemaField } from "../src/types.js";

const text = (value: string, format = 0) => ({ type: "text", version: 1, format, text: value });
const link = (url: string, value: string) => ({
  type: "link",
  version: 1,
  fields: { url, linkType: "custom" },
  children: [text(value)],
});
const para = (...children: unknown[]) => ({ type: "paragraph", version: 1, children });
const rich = (...children: unknown[]) => ({ root: { type: "root", version: 1, children } });

const fields = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
  { name: "body", type: "richText", editor: "lexical" },
  { name: "writer", type: "relationship", relationTo: "people" },
  { name: "meta", type: "group", fields: [{ name: "note", type: "textarea" }] },
  { name: "rows", type: "array", fields: [{ name: "label", type: "text" }] },
  {
    name: "sections",
    type: "blocks",
    blocks: [{ slug: "quote", fields: [{ name: "words", type: "text" }] }],
  },
  { name: "raw", type: "json" },
] as SchemaField[];

const doc = () => ({
  heading: "Old",
  views: 1,
  body: rich(para(text("One sentence with "), link("/a", "a link"), text("."))),
  writer: 3,
  meta: { note: "n" },
  rows: [{ id: "r1", label: "first" }],
  sections: [{ id: "s1", blockType: "quote", words: "said" }],
  raw: { a: 1 },
});

const changed = (patch: Record<string, unknown>) =>
  classifyChange(fields, doc(), { ...doc(), ...patch });

describe("the class of a change, from the two versions of the document", () => {
  it("words inside existing fields are a text change", () => {
    expect(changed({})).toBe("text");
    expect(changed({ heading: "New", views: 2, meta: { note: "other" } })).toBe("text");
    expect(changed({ rows: [{ id: "r1", label: "renamed" }] })).toBe("text");
    expect(changed({ sections: [{ id: "s1", blockType: "quote", words: "wrote" }] })).toBe("text");
  });

  it("a reworded or reformatted rich text keeps its shape", () => {
    expect(
      changed({ body: rich(para(text("Another sentence with "), link("/a", "a link"), text("!"))) })
    ).toBe("text");
    expect(
      changed({
        body: rich(
          para(text("One "), text("sentence", 1), text(" with "), link("/a", "a link"), text("."))
        ),
      })
    ).toBe("text");
  });

  it("a new node, a new link target or a removed link is a change of structure", () => {
    const first = para(text("One sentence with "), link("/a", "a link"), text("."));

    expect(changed({ body: rich(first, para(text("A new paragraph."))) })).toBe("structure");
    expect(
      changed({ body: rich(para(text("One sentence with "), link("/b", "a link"), text("."))) })
    ).toBe("structure");
    expect(changed({ body: rich(para(text("One sentence with a link."))) })).toBe("structure");
  });

  it("a reference, a row set, a block set or a field of an unknown kind is a change of structure", () => {
    expect(changed({ writer: 4 })).toBe("structure");
    expect(changed({ rows: [] })).toBe("structure");
    expect(
      changed({
        rows: [
          { id: "r1", label: "first" },
          { id: "r2", label: "second" },
        ],
      })
    ).toBe("structure");
    expect(changed({ sections: [{ id: "s1", blockType: "other", words: "said" }] })).toBe(
      "structure"
    );
    expect(changed({ raw: { a: 2 } })).toBe("structure");
  });
});

const session = (criteriaResults: unknown[], isTranslation = false) =>
  ({ isTranslation, state: { criteriaResults } }) as never;

describe("which edit gets the reviewer", () => {
  const met = { ok: true, criterion: { check: { type: "contains" } } };
  const judgement = {
    ok: true,
    deferred: true,
    criterion: { check: { type: "judgement", description: "the tone is formal" } },
  };

  it("a text change with an outcome the code checked does not", () => {
    expect(needsReviewer(session([met]), "text")).toBe(false);
  });

  it("a change of structure does", () => {
    expect(needsReviewer(session([met]), "structure")).toBe(true);
  });

  it("a text change with no checked outcome does: nothing else says the edit is the task", () => {
    expect(needsReviewer(session([]), "text")).toBe(true);
    expect(
      needsReviewer(session([{ ok: true, criterion: { check: { type: "unchanged" } } }]), "text")
    ).toBe(true);
    expect(needsReviewer(session([{ ...met, ok: false }]), "text")).toBe(true);
  });

  it("a translation and a question left to a reader always do", () => {
    expect(needsReviewer(session([met], true), "text")).toBe(true);
    expect(needsReviewer(session([met, judgement]), "text")).toBe(true);
  });
});
