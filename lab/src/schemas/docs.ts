// Differs from the blog on purpose: two locales, no `slug` field, a group, an array, no drafts in places.
import type { CollectionConfig, GlobalConfig } from "payload";
import { creator, h2, link, p, richText } from "../seedHelpers";
import type { LabSchema } from "./types";

const drafts = { versions: { drafts: true } };

const Categories: CollectionConfig = {
  slug: "categories",
  admin: { useAsTitle: "name" },
  fields: [
    { name: "name", type: "text", required: true, localized: true },
    { name: "parent", type: "relationship", relationTo: "categories" },
  ],
};
const Articles: CollectionConfig = {
  slug: "articles",
  admin: { useAsTitle: "title" },
  ...drafts,
  fields: [
    { name: "title", type: "text", required: true, localized: true },
    { name: "path", type: "text", required: true, unique: true },
    { name: "summary", type: "textarea", localized: true },
    { name: "category", type: "relationship", relationTo: "categories" },
    { name: "body", type: "richText", localized: true },
    {
      name: "steps",
      type: "array",
      fields: [
        { name: "heading", type: "text", required: true, localized: true },
        { name: "detail", type: "textarea", localized: true },
      ],
    },
    {
      name: "seo",
      type: "group",
      fields: [
        { name: "metaTitle", type: "text", localized: true },
        { name: "metaDescription", type: "textarea", localized: true },
      ],
    },
  ],
};
const GlossaryTerms: CollectionConfig = {
  slug: "glossary-terms",
  admin: { useAsTitle: "term" },
  ...drafts,
  fields: [
    { name: "term", type: "text", required: true },
    { name: "definition", type: "textarea", localized: true },
  ],
};
const Navigation: GlobalConfig = {
  slug: "navigation",
  ...drafts,
  fields: [
    {
      name: "links",
      type: "array",
      fields: [
        { name: "label", type: "text", required: true, localized: true },
        { name: "path", type: "text", required: true },
      ],
    },
  ],
};
const Footer: GlobalConfig = {
  slug: "footer",
  fields: [{ name: "note", type: "text", localized: true }],
};

export const docs: LabSchema = {
  name: "docs",
  collections: [Categories, Articles, GlossaryTerms],
  globals: [Navigation, Footer],
  localization: { locales: ["en", "de"], defaultLocale: "en" },
  async seed(payload) {
    const create = creator(payload);
    const setup = await create("categories", { name: "Setup" });
    const billing = await create("categories", { name: "Billing" });

    const install = await create("articles", {
      title: "Install the desktop app",
      path: "/setup/install",
      summary: "Download the installer, run it and sign in with your work account.",
      category: setup.id,
      body: richText(
        p(
          "The desktop app runs on Windows and macOS. You need an active workspace before you start."
        ),
        h2("Before you begin"),
        p(
          "Check the ",
          link("https://help.example/requirements", "system requirements"),
          " and close older versions of the app."
        ),
        p(
          "Ask a workspace admin for an invite if you do not have one. The invite expires after seven days."
        )
      ),
      steps: [
        {
          heading: "Download the installer",
          detail: "Open the downloads page and choose your system.",
        },
        { heading: "Run the installer", detail: "Accept the license and keep the default folder." },
        {
          heading: "Sign in",
          detail: "Use your work account. A workspace admin can reset the password.",
        },
      ],
      seo: {
        metaTitle: "Install the desktop app",
        metaDescription: "Three steps to install the desktop app.",
      },
    });
    const invoices = await create("articles", {
      title: "Download an invoice",
      path: "/billing/invoices",
      summary: "Find past invoices and download them as PDF.",
      category: billing.id,
      body: richText(
        p("Every paid workspace gets one invoice per month."),
        p("A workspace admin can download each invoice as a PDF file.")
      ),
      steps: [
        {
          heading: "Open billing",
          detail: "Go to the workspace settings and open the billing tab.",
        },
      ],
      seo: { metaTitle: "Download an invoice", metaDescription: "Where to find your invoices." },
    });
    const term = await create("glossary-terms", {
      term: "Workspace",
      definition: "The shared space of one company. It holds members, projects and billing.",
    });

    await payload.updateGlobal({
      slug: "navigation" as never,
      data: {
        links: [
          { label: "Setup", path: "/setup" },
          { label: "Billing", path: "/billing" },
        ],
        _status: "published",
      } as never,
    });
    await payload.updateGlobal({ slug: "footer" as never, data: { note: "Help center" } as never });

    return {
      documents: {
        install: { collection: "articles", id: install.id },
        invoices: { collection: "articles", id: invoices.id },
        workspace: { collection: "glossary-terms", id: term.id },
      },
    };
  },
};
