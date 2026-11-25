import type { Block, Field } from "payload";
import {
  BlocksFeature,
  EXPERIMENTAL_TableFeature,
  lexicalEditor,
} from "@payloadcms/richtext-lexical";
import { image, link } from "./fields";

const heading: Field = { name: "heading", type: "text" };
const intro: Field = { name: "intro", type: "textarea" };

const Callout: Block = {
  slug: "callout",
  fields: [
    {
      name: "tone",
      type: "select",
      options: ["note", "tip", "warning"],
      defaultValue: "note",
    },
    { name: "title", type: "text" },
    { name: "text", type: "textarea", required: true },
  ],
};
const CodeSample: Block = {
  slug: "codeSample",
  fields: [
    {
      name: "language",
      type: "select",
      options: ["ts", "tsx", "js", "json", "bash", "graphql"],
    },
    { name: "filename", type: "text" },
    { name: "code", type: "code", required: true },
  ],
};
const Figure: Block = {
  slug: "figure",
  fields: [image(), { name: "caption", type: "text" }],
};
const Cta: Block = {
  slug: "cta",
  fields: [heading, { name: "text", type: "textarea" }, link("primary"), link("secondary")],
};
const TechnologyMention: Block = {
  slug: "technologyMention",
  fields: [
    {
      name: "technology",
      type: "relationship",
      relationTo: "technologies" as never,
    },
  ],
};
const GlossaryTerm: Block = {
  slug: "glossaryTerm",
  fields: [{ name: "term", type: "relationship", relationTo: "glossary" as never }],
};

export const richTextBlocks: Block[] = [
  Callout,
  CodeSample,
  Figure,
  Cta,
  TechnologyMention,
  GlossaryTerm,
];

// Rich text of an article: blocks and inline blocks inside the text, and tables.
export const articleEditor = lexicalEditor({
  features: ({ defaultFeatures }) => [
    ...defaultFeatures,
    EXPERIMENTAL_TableFeature(),
    BlocksFeature({
      blocks: [Callout, CodeSample, Figure, Cta],
      inlineBlocks: [TechnologyMention, GlossaryTerm],
    }),
  ],
});

const Hero: Block = {
  slug: "hero",
  fields: [
    { name: "eyebrow", type: "text" },
    { name: "heading", type: "text", required: true },
    { name: "subheading", type: "textarea" },
    image("background"),
    { name: "actions", type: "array", maxRows: 3, fields: [link()] },
  ],
};
const RichTextSection: Block = {
  slug: "richTextSection",
  fields: [heading, { name: "body", type: "richText", editor: articleEditor }],
};
const TwoColumnText: Block = {
  slug: "twoColumnText",
  fields: [heading, { name: "left", type: "richText" }, { name: "right", type: "richText" }],
};
const Quote: Block = {
  slug: "quote",
  fields: [
    { name: "quote", type: "textarea", required: true },
    { name: "person", type: "text" },
    { name: "role", type: "text" },
  ],
};
const ImageWithText: Block = {
  slug: "imageWithText",
  fields: [
    heading,
    { name: "body", type: "richText" },
    image(),
    {
      name: "imageSide",
      type: "radio",
      options: ["left", "right"],
      defaultValue: "right",
    },
  ],
};
const Gallery: Block = {
  slug: "gallery",
  fields: [
    heading,
    {
      name: "images",
      type: "array",
      fields: [image(), { name: "caption", type: "text" }],
    },
  ],
};
const Video: Block = {
  slug: "video",
  fields: [heading, { name: "url", type: "text", required: true }, image("poster")],
};
const FeatureGrid: Block = {
  slug: "featureGrid",
  fields: [
    heading,
    intro,
    {
      name: "items",
      type: "array",
      fields: [
        {
          name: "icon",
          type: "select",
          options: ["speed", "shield", "layers", "globe", "code"],
        },
        { name: "title", type: "text", required: true },
        { name: "text", type: "textarea" },
        link(),
      ],
    },
  ],
};
const Steps: Block = {
  slug: "steps",
  fields: [
    heading,
    intro,
    {
      name: "steps",
      type: "array",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "duration", type: "text" },
        { name: "body", type: "richText" },
        {
          name: "deliverables",
          type: "array",
          fields: [{ name: "item", type: "text" }],
        },
      ],
    },
  ],
};
const Stats: Block = {
  slug: "stats",
  fields: [
    heading,
    {
      name: "items",
      type: "array",
      fields: [
        { name: "value", type: "number", required: true },
        {
          name: "unit",
          type: "select",
          options: ["%", "x", "+", "ms", "months", "pages"],
        },
        { name: "label", type: "text", required: true },
      ],
    },
  ],
};
const LogoCloud: Block = {
  slug: "logoCloud",
  fields: [
    heading,
    {
      name: "partners",
      type: "relationship",
      relationTo: "partners" as never,
      hasMany: true,
    },
  ],
};
const Timeline: Block = {
  slug: "timeline",
  fields: [
    heading,
    {
      name: "entries",
      type: "array",
      fields: [
        { name: "date", type: "date", required: true },
        { name: "title", type: "text", required: true },
        { name: "text", type: "textarea" },
      ],
    },
  ],
};
const CaseStudyCards: Block = {
  slug: "caseStudyCards",
  fields: [
    heading,
    intro,
    {
      name: "highlighted",
      type: "relationship",
      relationTo: "case-studies" as never,
    },
    {
      name: "cases",
      type: "relationship",
      relationTo: "case-studies" as never,
      hasMany: true,
    },
  ],
};
const ReviewSlider: Block = {
  slug: "reviewSlider",
  fields: [
    heading,
    {
      name: "reviews",
      type: "relationship",
      relationTo: "reviews" as never,
      hasMany: true,
    },
  ],
};
const RelatedArticles: Block = {
  slug: "relatedArticles",
  fields: [
    heading,
    {
      name: "articles",
      type: "array",
      fields: [
        {
          name: "post",
          type: "relationship",
          relationTo: "posts" as never,
          required: true,
        },
        { name: "title", type: "text" },
        { name: "description", type: "textarea" },
        image("cover"),
      ],
    },
  ],
};
const FaqList: Block = {
  slug: "faqList",
  fields: [
    heading,
    {
      name: "library",
      type: "relationship",
      relationTo: "faqs" as never,
      hasMany: true,
    },
    {
      name: "items",
      type: "array",
      fields: [
        { name: "question", type: "text", required: true },
        { name: "answer", type: "richText" },
      ],
    },
  ],
};
const ComparisonTable: Block = {
  slug: "comparisonTable",
  fields: [
    heading,
    {
      name: "columns",
      type: "array",
      fields: [{ name: "label", type: "text", required: true }],
    },
    {
      name: "rows",
      type: "array",
      fields: [
        { name: "label", type: "text", required: true },
        {
          name: "cells",
          type: "array",
          fields: [{ name: "value", type: "text" }],
        },
      ],
    },
  ],
};
const TechnologyGrid: Block = {
  slug: "technologyGrid",
  fields: [
    heading,
    {
      name: "items",
      type: "array",
      fields: [
        {
          name: "technology",
          type: "relationship",
          relationTo: "technologies" as never,
          required: true,
        },
        { name: "summary", type: "textarea" },
        link(),
      ],
    },
  ],
};
const AwardsStrip: Block = {
  slug: "awardsStrip",
  fields: [
    heading,
    {
      name: "awards",
      type: "relationship",
      relationTo: "awards" as never,
      hasMany: true,
    },
  ],
};
const LinkList: Block = {
  slug: "linkList",
  fields: [heading, { name: "links", type: "array", fields: [link()] }],
};
const TagLinks: Block = {
  slug: "tagLinks",
  fields: [
    heading,
    {
      name: "tags",
      type: "array",
      fields: [
        { name: "label", type: "text", required: true },
        {
          name: "page",
          type: "relationship",
          relationTo: "pages" as never,
          required: true,
        },
      ],
    },
  ],
};
const PricingTable: Block = {
  slug: "pricingTable",
  fields: [
    heading,
    {
      name: "plans",
      type: "array",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "price", type: "number" },
        {
          name: "period",
          type: "select",
          options: ["month", "year", "project"],
        },
        { name: "highlighted", type: "checkbox" },
        {
          name: "features",
          type: "array",
          fields: [
            { name: "text", type: "text", required: true },
            { name: "included", type: "checkbox", defaultValue: true },
          ],
        },
        link(),
      ],
    },
  ],
};
const ContactForm: Block = {
  slug: "contactForm",
  fields: [
    heading,
    intro,
    {
      name: "form",
      type: "select",
      options: ["contact", "audit", "newsletter", "estimate"],
    },
  ],
};
const MarkdownBlock: Block = {
  slug: "markdownBlock",
  fields: [heading, { name: "markdown", type: "textarea" }],
};
const SharedSection: Block = {
  slug: "sharedSection",
  fields: [
    {
      name: "section",
      type: "relationship",
      relationTo: "sections" as never,
      required: true,
    },
  ],
};

export const sectionBlocks: Block[] = [
  Hero,
  RichTextSection,
  TwoColumnText,
  Quote,
  Callout,
  ImageWithText,
  Gallery,
  Video,
  FeatureGrid,
  Steps,
  Stats,
  LogoCloud,
  Timeline,
  CaseStudyCards,
  ReviewSlider,
  RelatedArticles,
  FaqList,
  ComparisonTable,
  TechnologyGrid,
  AwardsStrip,
  Cta,
  LinkList,
  TagLinks,
  PricingTable,
  ContactForm,
  CodeSample,
  MarkdownBlock,
];

const TabsBlock: Block = {
  slug: "tabsBlock",
  fields: [
    heading,
    {
      name: "tabs",
      type: "array",
      fields: [
        { name: "label", type: "text", required: true },
        { name: "content", type: "blocks", blocks: sectionBlocks },
      ],
    },
  ],
};
const Columns: Block = {
  slug: "columns",
  fields: [
    {
      name: "columns",
      type: "array",
      maxRows: 4,
      fields: [
        {
          name: "width",
          type: "select",
          options: ["third", "half", "twoThirds", "full"],
        },
        { name: "content", type: "blocks", blocks: sectionBlocks },
      ],
    },
  ],
};
const Section: Block = {
  slug: "section",
  fields: [
    heading,
    {
      name: "theme",
      type: "radio",
      options: ["light", "dark"],
      defaultValue: "light",
    },
    {
      name: "content",
      type: "blocks",
      blocks: [...sectionBlocks, TabsBlock, Columns],
    },
  ],
};

export const pageBlocks: Block[] = [...sectionBlocks, SharedSection, TabsBlock, Columns, Section];
