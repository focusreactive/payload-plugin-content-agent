import type { GlobalConfig } from "payload";
import { drafts, image, link } from "./fields";

const Header: GlobalConfig = {
  slug: "header",
  ...drafts,
  fields: [
    image("logo"),
    {
      name: "navigation",
      type: "array",
      fields: [
        link(),
        {
          name: "children",
          type: "array",
          fields: [link(), { name: "description", type: "text", localized: true }],
        },
      ],
    },
    link("action"),
  ],
};

const Footer: GlobalConfig = {
  slug: "footer",
  ...drafts,
  fields: [
    {
      name: "columns",
      type: "array",
      fields: [
        { name: "title", type: "text", required: true, localized: true },
        { name: "links", type: "array", fields: [link()] },
      ],
    },
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
    { name: "legal", type: "richText", localized: true },
  ],
};

const SiteSettings: GlobalConfig = {
  slug: "site-settings",
  fields: [
    {
      type: "tabs",
      tabs: [
        {
          label: "General",
          fields: [
            { name: "siteName", type: "text" },
            { name: "tagline", type: "text", localized: true },
            { name: "contactEmail", type: "email" },
            image("defaultOgImage"),
          ],
        },
        {
          label: "Blog",
          fields: [
            { name: "postsPerPage", type: "number", min: 1 },
            { name: "showReadingTime", type: "checkbox" },
          ],
        },
        { label: "Scripts", fields: [{ name: "scripts", type: "json" }] },
      ],
    },
  ],
};

const Announcement: GlobalConfig = {
  slug: "announcement",
  ...drafts,
  fields: [
    { name: "enabled", type: "checkbox" },
    { name: "text", type: "text", localized: true },
    link(),
    {
      type: "row",
      fields: [
        { name: "startsOn", type: "date" },
        { name: "endsOn", type: "date" },
      ],
    },
  ],
};

export const globals: GlobalConfig[] = [Header, Footer, SiteSettings, Announcement];
