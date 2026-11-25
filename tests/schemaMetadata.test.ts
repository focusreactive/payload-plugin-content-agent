import { describe, it, expect } from "vitest";
import { introspectSchema } from "../src/schema/introspector.js";
import { titleFieldOf } from "../src/schema/titleField.js";

const collectionOf = (fields: unknown[], extra: Record<string, unknown> = {}) =>
  introspectSchema({
    collections: [{ slug: "records", timestamps: true, fields, ...extra }],
    globals: [],
    blocks: [],
    i18n: { fallbackLanguage: "de" },
  } as any).collections[0];

describe("introspectSchema: what the logic needs comes from the schema", () => {
  it("marks a unique field", () => {
    const [code, note] = collectionOf([
      { name: "code", type: "text", unique: true },
      { name: "note", type: "text" },
    ]).fields;

    expect(code.unique).toBe(true);
    expect(note.unique).toBeUndefined();
  });

  it("lists the features the editor of a rich text field has on", () => {
    const featureMap = new Map<string, unknown>([
      ["paragraph", {}],
      ["italic", {}],
    ]);
    const [text] = collectionOf([
      {
        name: "text",
        type: "richText",
        editor: { editorConfig: { resolvedFeatureMap: featureMap } },
      },
    ]).fields;

    expect(text.editor).toBe("lexical");
    expect(text.features).toEqual(["paragraph", "italic"]);
  });

  it("leaves out a field the API never returns", () => {
    const { fields } = collectionOf([
      { name: "secret", type: "text", hidden: true },
      { name: "shown", type: "text" },
    ]);

    expect(fields.map((field) => field.name)).toEqual(["shown"]);
  });

  it("treats a field hidden in the admin and a virtual field as read-only", () => {
    const [managed, computed, linked, plain] = collectionOf([
      { name: "managed", type: "text", admin: { hidden: true } },
      { name: "computed", type: "text", virtual: true },
      { name: "linked", type: "text", virtual: "owner.name" },
      { name: "plain", type: "text" },
    ]).fields;

    expect(managed.readOnly).toBe(true);
    expect(computed.readOnly).toBe(true);
    expect(linked.readOnly).toBe(true);
    expect(plain.readOnly).toBeUndefined();
  });

  it("reads a label, a description and an option label given per language", () => {
    const collection = collectionOf(
      [
        {
          name: "kind",
          type: "select",
          label: { de: "Art", fr: "Genre" },
          admin: { description: { fr: "Le genre" } },
          options: [{ value: "a", label: { de: "Erste" } }],
        },
        { name: "byFunction", type: "text", label: () => "x" },
      ],
      { labels: { singular: { de: "Eintrag" }, plural: { de: "Einträge" } } }
    );
    const [kind, byFunction] = collection.fields;

    expect(collection.labels).toEqual({ singular: "Eintrag", plural: "Einträge" });
    expect(kind.label).toBe("Art");
    expect(kind.description).toBe("Le genre");
    expect(kind.options).toEqual([{ value: "a", label: "Erste" }]);
    expect(byFunction.label).toBeUndefined();
  });

  it("takes the title field from useAsTitle, else the first text field, else none", () => {
    const fields = [
      { name: "count", type: "number" },
      { name: "keywords", type: "text", hasMany: true },
      { name: "caption", type: "text" },
      { name: "contact", type: "email" },
    ];

    expect(titleFieldOf(collectionOf(fields, { admin: { useAsTitle: "contact" } }))).toBe(
      "contact"
    );
    expect(titleFieldOf(collectionOf(fields, { admin: { useAsTitle: "id" } }))).toBe("caption");
    expect(titleFieldOf(collectionOf(fields))).toBe("caption");
    expect(titleFieldOf(collectionOf([{ name: "count", type: "number" }]))).toBeUndefined();
  });

  it("leaves out a global hidden in the admin", () => {
    const schema = introspectSchema({
      collections: [],
      globals: [
        { slug: "internal", fields: [], admin: { hidden: true } },
        { slug: "settings", fields: [], label: { de: "Einstellungen" } },
      ],
      blocks: [],
      i18n: { fallbackLanguage: "de" },
    } as any);

    expect(schema.globals.map((global) => global.slug)).toEqual(["settings"]);
    expect(schema.globals[0].label).toBe("Einstellungen");
  });
});
