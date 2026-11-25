import type { Field } from "payload";

export const drafts = { versions: { drafts: true } };

export const LINK_TARGETS = ["pages", "posts", "case-studies"];

// One link shape for the whole schema: a reference to a document or a typed address, with a label.
export const link = (name = "link", extra: Field[] = []): Field => ({
  name,
  type: "group",
  fields: [
    {
      type: "row",
      fields: [
        {
          name: "type",
          type: "radio",
          options: ["internal", "custom"],
          defaultValue: "internal",
        },
        { name: "newTab", type: "checkbox" },
      ],
    },
    {
      name: "reference",
      type: "relationship",
      relationTo: LINK_TARGETS as never,
    },
    { name: "url", type: "text" },
    { name: "label", type: "text", localized: true },
    ...extra,
  ],
});

export const seoTab = {
  name: "seo",
  fields: [
    { name: "title", type: "text", localized: true },
    { name: "description", type: "textarea", localized: true },
    { name: "canonical", type: "text" },
    { name: "noindex", type: "checkbox" },
    { name: "keywords", type: "text", hasMany: true },
    { name: "ogImage", type: "upload", relationTo: "media" },
  ] as Field[],
};

export const image = (name = "image"): Field => ({
  name,
  type: "upload",
  relationTo: "media",
});
