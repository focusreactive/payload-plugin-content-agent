import { describe, it, expect } from "vitest";
import { changedDocumentsNote, titleFieldsOf } from "../src/agent/changedDocuments.js";
import type { ChangedDocumentRow } from "../src/memory/storage/changesets.js";
import type { SchemaContext } from "../src/types.js";

const row = (over: Partial<ChangedDocumentRow>): ChangedDocumentRow => ({
  collection: "notes",
  id: "1",
  created: false,
  ...over,
});

describe("changedDocumentsNote", () => {
  it("is empty when the conversation changed nothing", () => {
    expect(changedDocumentsNote([])).toBe("");
  });

  it("lists one line per document with its title, its locales and what happened", () => {
    const note = changedDocumentsNote([
      row({ id: "7", title: "Spring\n plan", locale: "de" }),
      row({ id: "7", title: "Spring plan", locale: "en" }),
      row({ id: "8", title: "Made here", created: true }),
      row({ collection: "global:footer", id: "footer" }),
    ]);

    expect(note).toContain('- notes 7 "Spring plan" (changed by you; locales: de, en)');
    expect(note).toContain('- notes 8 "Made here" (created by you)');
    expect(note).toContain("- global:footer (changed by you)");
    expect(note.match(/^- /gmu)).toHaveLength(3);
  });

  it("says that a person discarded the changes only when every locale was discarded", () => {
    const all = changedDocumentsNote([
      row({ op: "discarded", locale: "en" }),
      row({ op: "discarded", locale: "de" }),
    ]);
    const part = changedDocumentsNote([
      row({ op: "discarded", locale: "en" }),
      row({ op: "editContent", locale: "de" }),
    ]);

    expect(all).toContain("the person discarded your changes");
    expect(part).toContain("changed by you");
    expect(part).not.toContain("discarded");
  });

  it("caps the list and counts the rest", () => {
    const rows = Array.from({ length: 45 }, (_, index) => row({ id: String(index) }));
    const note = changedDocumentsNote(rows);

    expect(note.match(/^- notes /gmu)).toHaveLength(40);
    expect(note).toContain("and 5 more document(s), not listed");
  });
});

describe("titleFieldsOf", () => {
  it("takes the declared title field, else the first text field, and skips a collection with none", () => {
    const schema = {
      globals: [],
      collections: [
        { slug: "a", useAsTitle: "heading", fields: [{ name: "heading", type: "text" }] },
        {
          slug: "b",
          fields: [
            { name: "count", type: "number" },
            { name: "label", type: "text" },
          ],
        },
        { slug: "c", fields: [{ name: "count", type: "number" }] },
      ],
    } as unknown as SchemaContext;

    expect(titleFieldsOf(schema)).toEqual({ a: "heading", b: "label" });
  });
});
