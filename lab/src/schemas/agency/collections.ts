import path from "node:path";
import type { CollectionConfig, Field } from "payload";
import { articleEditor, pageBlocks, sectionBlocks } from "./blocks";
import { drafts, image, LINK_TARGETS, seoTab } from "./fields";

const slug: Field = {
  name: "slug",
  type: "text",
  required: true,
  unique: true,
  index: true,
};
const rel = (name: string, relationTo: string, hasMany = false): Field =>
  ({ name, type: "relationship", relationTo, hasMany }) as Field;
const dateTime = (name: string): Field => ({
  name,
  type: "date",
  admin: { date: { pickerAppearance: "dayAndTime" } },
});

const COUNTRIES = ["us", "ca", "uk", "de", "at", "ch", "nl", "se", "no", "dk", "es", "au"];
const INDUSTRIES = ["saas", "ecommerce", "fintech", "media", "education", "healthcare", "travel"];
const SERVICES = ["migration", "development", "design", "audit", "localization", "support"];

const Media: CollectionConfig = {
  slug: "media",
  admin: { useAsTitle: "filename" },
  upload: {
    staticDir: path.resolve(process.cwd(), ".state", "agency", "media"),
    mimeTypes: ["image/*"],
  },
  fields: [
    { name: "alt", type: "text", localized: true },
    { name: "caption", type: "text", localized: true },
    { name: "credit", type: "text" },
  ],
};

const Authors: CollectionConfig = {
  slug: "authors",
  admin: { useAsTitle: "name" },
  ...drafts,
  fields: [
    { name: "name", type: "text", required: true },
    slug,
    { name: "role", type: "text", localized: true },
    { name: "bio", type: "textarea", localized: true },
    { name: "email", type: "email" },
    image("photo"),
    {
      name: "socials",
      type: "array",
      fields: [
        {
          name: "network",
          type: "select",
          options: ["linkedin", "github", "x"],
          required: true,
        },
        { name: "url", type: "text", required: true },
      ],
    },
    { name: "posts", type: "join", collection: "posts", on: "author" },
  ],
};

const Categories: CollectionConfig = {
  slug: "categories",
  admin: { useAsTitle: "name" },
  ...drafts,
  fields: [
    { name: "name", type: "text", required: true, localized: true },
    slug,
    { name: "description", type: "textarea", localized: true },
    rel("parent", "categories"),
    { name: "posts", type: "join", collection: "posts", on: "category" },
  ],
};

const Tags: CollectionConfig = {
  slug: "tags",
  admin: { useAsTitle: "name" },
  fields: [{ name: "name", type: "text", required: true, localized: true }, slug],
};

const Technologies: CollectionConfig = {
  slug: "technologies",
  admin: { useAsTitle: "name" },
  ...drafts,
  fields: [
    { name: "name", type: "text", required: true },
    slug,
    {
      name: "kind",
      type: "select",
      options: ["cms", "framework", "commerce", "hosting", "search"],
      required: true,
    },
    { name: "vendor", type: "text" },
    { name: "website", type: "text" },
    { name: "license", type: "radio", options: ["open-source", "proprietary"] },
    { name: "selfHosted", type: "checkbox" },
    { name: "summary", type: "textarea", localized: true },
    { name: "pricing", type: "json" },
    image("logo"),
  ],
};

const Posts: CollectionConfig = {
  slug: "posts",
  admin: { useAsTitle: "title" },
  ...drafts,
  fields: [
    {
      type: "tabs",
      tabs: [
        {
          label: "Content",
          fields: [
            { name: "title", type: "text", required: true, localized: true },
            slug,
            { name: "excerpt", type: "textarea", localized: true },
            image("cover"),
            {
              name: "content",
              type: "richText",
              localized: true,
              editor: articleEditor,
            },
            {
              name: "contentMarkdown",
              type: "code",
              admin: { language: "markdown" },
            },
            {
              name: "faq",
              type: "array",
              fields: [
                { name: "question", type: "text", required: true, localized: true },
                { name: "answer", type: "textarea", required: true, localized: true },
              ],
            },
          ],
        },
        {
          label: "Meta",
          fields: [
            rel("author", "authors"),
            rel("coAuthors", "authors", true),
            rel("category", "categories"),
            rel("tags", "tags", true),
            rel("technologies", "technologies", true),
            rel("relatedPosts", "posts", true),
            {
              type: "row",
              fields: [
                { name: "publishedOn", type: "date" },
                { name: "readingMinutes", type: "number", min: 1 },
              ],
            },
            {
              name: "format",
              type: "radio",
              options: ["guide", "listicle", "comparison", "news", "report"],
              defaultValue: "guide",
            },
            { name: "featured", type: "checkbox" },
          ],
        },
        seoTab,
      ],
    },
  ],
};

const Pages: CollectionConfig = {
  slug: "pages",
  admin: { useAsTitle: "title" },
  ...drafts,
  fields: [
    {
      type: "tabs",
      tabs: [
        {
          label: "Content",
          fields: [
            { name: "title", type: "text", required: true, localized: true },
            slug,
            rel("parent", "pages"),
            {
              name: "family",
              type: "select",
              options: ["service", "technology", "migration", "region", "solution", "company"],
            },
            {
              name: "design",
              type: "radio",
              options: ["v1", "v2"],
              defaultValue: "v2",
            },
            {
              name: "layout",
              type: "blocks",
              localized: true,
              blocks: pageBlocks,
            },
          ],
        },
        seoTab,
      ],
    },
  ],
};

const ReusableSections: CollectionConfig = {
  slug: "sections",
  admin: { useAsTitle: "title" },
  ...drafts,
  fields: [
    { name: "title", type: "text", required: true },
    { name: "content", type: "blocks", localized: true, blocks: sectionBlocks },
  ],
};

const CaseStudies: CollectionConfig = {
  slug: "case-studies",
  admin: { useAsTitle: "title" },
  ...drafts,
  fields: [
    { name: "title", type: "text", required: true, localized: true },
    slug,
    { name: "client", type: "text", required: true },
    {
      type: "row",
      fields: [
        { name: "industry", type: "select", options: INDUSTRIES },
        { name: "country", type: "select", options: COUNTRIES },
        { name: "year", type: "number" },
      ],
    },
    { name: "services", type: "select", options: SERVICES, hasMany: true },
    rel("technologies", "technologies", true),
    { name: "summary", type: "textarea", localized: true },
    { name: "story", type: "richText", localized: true, editor: articleEditor },
    {
      name: "results",
      type: "array",
      fields: [
        { name: "label", type: "text", required: true, localized: true },
        { name: "value", type: "number", required: true },
        {
          name: "unit",
          type: "select",
          options: ["%", "x", "+", "ms", "months", "pages"],
        },
      ],
    },
    image("logo"),
    { name: "videoUrl", type: "text" },
    {
      name: "gallery",
      type: "array",
      fields: [image(), { name: "caption", type: "text", localized: true }],
    },
    rel("review", "reviews"),
    { name: "liveUrl", type: "text" },
    {
      name: "location",
      type: "group",
      fields: [
        { name: "lat", type: "number" },
        { name: "lng", type: "number" },
      ],
    },
  ],
};

const Reviews: CollectionConfig = {
  slug: "reviews",
  admin: { useAsTitle: "person" },
  ...drafts,
  fields: [
    { name: "person", type: "text", required: true },
    { name: "role", type: "text", localized: true },
    { name: "company", type: "text" },
    { name: "quote", type: "textarea", required: true, localized: true },
    { name: "rating", type: "number", min: 1, max: 5 },
    {
      name: "source",
      type: "select",
      options: ["clutch", "g2", "linkedin", "direct"],
    },
    { name: "receivedOn", type: "date" },
    rel("caseStudy", "case-studies"),
    image("photo"),
  ],
};

const Awards: CollectionConfig = {
  slug: "awards",
  admin: { useAsTitle: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "issuer", type: "text" },
    { name: "year", type: "number" },
    { name: "url", type: "text" },
    image("badge"),
  ],
};

const Partners: CollectionConfig = {
  slug: "partners",
  admin: { useAsTitle: "name" },
  ...drafts,
  fields: [
    { name: "name", type: "text", required: true },
    {
      name: "tier",
      type: "select",
      options: ["official", "certified", "community"],
    },
    { name: "since", type: "date" },
    { name: "url", type: "text" },
    rel("technology", "technologies"),
    image("logo"),
  ],
};

const Faqs: CollectionConfig = {
  slug: "faqs",
  admin: { useAsTitle: "question" },
  ...drafts,
  fields: [
    { name: "question", type: "text", required: true, localized: true },
    { name: "answer", type: "richText", localized: true },
    {
      name: "topic",
      type: "select",
      options: ["pricing", "process", "migration", "support"],
    },
    rel("technology", "technologies"),
  ],
};

const Docs: CollectionConfig = {
  slug: "docs",
  admin: { useAsTitle: "title" },
  ...drafts,
  fields: [
    { name: "title", type: "text", required: true, localized: true },
    { name: "path", type: "text", required: true, unique: true },
    {
      type: "row",
      fields: [
        {
          name: "section",
          type: "select",
          options: ["getting-started", "guides", "reference", "recipes"],
        },
        { name: "order", type: "number" },
      ],
    },
    {
      name: "versions",
      type: "select",
      options: ["1.x", "2.x", "3.x"],
      hasMany: true,
    },
    { name: "body", type: "code", localized: true, admin: { language: "markdown" } },
    {
      type: "collapsible",
      label: "Navigation",
      fields: [rel("previous", "docs"), rel("next", "docs")],
    },
  ],
};

const Changelog: CollectionConfig = {
  slug: "changelog",
  admin: { useAsTitle: "version" },
  fields: [
    { name: "version", type: "text", required: true, unique: true },
    { name: "releasedOn", type: "date", required: true },
    {
      name: "kind",
      type: "radio",
      options: ["major", "minor", "patch"],
      required: true,
    },
    { name: "breaking", type: "checkbox" },
    { name: "notes", type: "textarea" },
  ],
};

const Events: CollectionConfig = {
  slug: "events",
  admin: { useAsTitle: "title" },
  ...drafts,
  fields: [
    { name: "title", type: "text", required: true, localized: true },
    slug,
    { type: "row", fields: [dateTime("startsAt"), dateTime("endsAt")] },
    {
      name: "format",
      type: "radio",
      options: ["online", "in-person", "hybrid"],
    },
    {
      name: "venue",
      type: "group",
      fields: [
        { name: "name", type: "text" },
        { name: "city", type: "text" },
        { name: "country", type: "select", options: COUNTRIES },
        {
          name: "geo",
          type: "group",
          fields: [
            { name: "lat", type: "number" },
            { name: "lng", type: "number" },
          ],
        },
      ],
    },
    {
      name: "agenda",
      type: "array",
      fields: [
        { name: "time", type: "text", required: true },
        { name: "title", type: "text", required: true, localized: true },
        rel("speaker", "authors"),
      ],
    },
    { name: "registrationUrl", type: "text" },
    { name: "description", type: "richText", localized: true },
  ],
};

const Glossary: CollectionConfig = {
  slug: "glossary",
  admin: { useAsTitle: "term" },
  ...drafts,
  fields: [
    { name: "term", type: "text", required: true, localized: true },
    { name: "definition", type: "textarea", localized: true },
    rel("seeAlso", "glossary", true),
    rel("technology", "technologies"),
  ],
};

const Redirects: CollectionConfig = {
  slug: "redirects",
  admin: { useAsTitle: "from" },
  fields: [
    { name: "from", type: "text", required: true, unique: true },
    {
      name: "to",
      type: "group",
      fields: [
        {
          name: "type",
          type: "radio",
          options: ["internal", "custom"],
          defaultValue: "internal",
        },
        {
          name: "reference",
          type: "relationship",
          relationTo: LINK_TARGETS as never,
        },
        { name: "url", type: "text" },
      ],
    },
    { name: "permanent", type: "checkbox", defaultValue: true },
    { name: "note", type: "text" },
  ],
};

const FormSubmissions: CollectionConfig = {
  slug: "form-submissions",
  admin: { useAsTitle: "email" },
  fields: [
    {
      name: "form",
      type: "select",
      options: ["contact", "audit", "newsletter", "estimate"],
      required: true,
    },
    { ...dateTime("submittedAt"), required: true } as Field,
    { name: "name", type: "text" },
    { name: "email", type: "email" },
    { name: "company", type: "text" },
    { name: "country", type: "select", options: COUNTRIES },
    { name: "message", type: "textarea" },
    { name: "spam", type: "checkbox" },
    { name: "sourcePage", type: "text" },
  ],
};

export const collections: CollectionConfig[] = [
  Posts,
  Pages,
  CaseStudies,
  Reviews,
  ReusableSections,
  Authors,
  Categories,
  Tags,
  Technologies,
  Partners,
  Awards,
  Faqs,
  Docs,
  Changelog,
  Events,
  Glossary,
  Redirects,
  FormSubmissions,
  Media,
];
