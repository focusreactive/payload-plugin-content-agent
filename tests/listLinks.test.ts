import { describe, it, expect, vi } from "vitest";

import {
  collectLinksInText,
  collectDocumentLinks,
  linksIn,
  findUnresolvedNewLinks,
} from "../src/agent/content/links.js";
import { createReadDocumentTool } from "../src/agent/tools/documents/readDocument.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const ctx = { toolCallId: "t", messages: [] } as any;

const postFields: SchemaField[] = [
  { name: "title", type: "text" },
  { name: "content", type: "richText", editor: "lexical" },
  { name: "contentMarkdown", type: "textarea" },
  { name: "excerpt", type: "textarea" },
  { name: "scheduleLink", type: "text" },
  {
    name: "faq",
    type: "group",
    fields: [
      {
        name: "items",
        type: "array",
        fields: [
          { name: "q", type: "text" },
          { name: "a", type: "richText", editor: "lexical" },
        ] as SchemaField[],
      },
    ] as SchemaField[],
  },
] as SchemaField[];

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: postFields,
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const link = (text: string, url: string) => ({
  type: "link",
  fields: { url, linkType: "custom" },
  children: [{ type: "text", text }],
});
const rt = (...children: any[]) => ({
  root: { type: "root", children: [{ type: "paragraph", children }] },
});

const post = () => ({
  id: 151,
  title: "Storyblok CMS: Content Control, Unlocked",
  content: rt({ type: "text", text: "Storyblok CMS: Content Control, Unlocked" }),
  contentMarkdown:
    "## TL;DR\n\nA [Next.js CMS](https://my-agency.example/nextjs-cms/) that fits. " +
    'Storyblok [has invested heavily in AI tooling](https://www.storyblok.com/mp/ai-features "AI").\n\n' +
    "See our [migration checklists](/blog/seo-migration-checklist/) and https://my-agency.example/blog/storyblok-cms-migration-companies for more.",
  excerpt: "No links here.",
  scheduleLink: "https://calendly.com/sample-agency/intro",
  faq: {
    items: [
      {
        id: "f1",
        q: "Pitfalls?",
        a: rt(
          { type: "text", text: "Ask our " },
          link(
            "headless cms experts",
            "https://my-agency.example/services/headless-cms-expert-agency/"
          )
        ),
      },
    ],
  },
});

describe("collectLinksInText", () => {
  it("finds Markdown links, with or without a title, and bare URLs that are not already a link target", () => {
    const links = collectLinksInText(post().contentMarkdown, "contentMarkdown");

    expect(links.map((l) => [l.source, l.text, l.url])).toEqual([
      ["markdown", "Next.js CMS", "https://my-agency.example/nextjs-cms/"],
      [
        "markdown",
        "has invested heavily in AI tooling",
        "https://www.storyblok.com/mp/ai-features",
      ],
      ["markdown", "migration checklists", "/blog/seo-migration-checklist/"],
      [
        "bareUrl",
        "https://my-agency.example/blog/storyblok-cms-migration-companies",
        "https://my-agency.example/blog/storyblok-cms-migration-companies",
      ],
    ]);
  });

  it("treats a field whose whole value is a URL as one link of its own kind", () => {
    expect(collectLinksInText("https://calendly.com/sample-agency/intro", "scheduleLink")).toEqual([
      {
        fieldRef: "scheduleLink",
        linkType: "custom",
        url: "https://calendly.com/sample-agency/intro",
        text: "",
        source: "urlField",
      },
    ]);
    expect(collectLinksInText("No links here.", "excerpt")).toEqual([]);
  });
});

describe("collectDocumentLinks across field types", () => {
  it("walks rich text, Markdown, URL fields and nested rows in one pass", () => {
    const links = collectDocumentLinks(postFields, post());

    expect(links.map((l) => `${l.source}:${l.fieldRef}`)).toEqual([
      "markdown:contentMarkdown",
      "markdown:contentMarkdown",
      "markdown:contentMarkdown",
      "bareUrl:contentMarkdown",
      "urlField:scheduleLink",
      "richText:faq.items[f1].a",
    ]);
  });

  it("does not count a URL-valued field as a link of the text", () => {
    const after = {
      ...post(),
      contentMarkdown: "Plain prose now.",
      faq: {
        items: [{ id: "f1", q: "Pitfalls?", a: rt({ type: "text", text: "Ask our experts" }) }],
      },
    };

    expect(collectDocumentLinks(postFields, after).map((found) => found.source)).toEqual([
      "urlField",
    ]);
    expect(linksIn(after)).toEqual([]);
  });
});

const links = (source: any, input: Record<string, unknown>) =>
  createReadDocumentTool(source, schema).execute!({ ...input, view: "links" }, ctx) as Promise<any>;

describe('readDocument({ view: "links" })', () => {
  const io = {
    read: vi.fn(async (_t: any, o: any) => ({ doc: String(o.id) === "151" ? post() : null })),
  } as any;

  it("returns the complete inventory with kinds, per-field counts and the field each link is in", async () => {
    const r = await links(io, { collection: "posts", id: 151 });

    expect(r.error).toBeUndefined();
    expect(r.total).toBe(6);
    expect(r.byKind).toEqual({ absolute: 5, relative: 1 });
    expect(r.byField).toEqual({ contentMarkdown: 4, scheduleLink: 1, "faq.items[f1].a": 1 });
    expect(r.links[0]).toEqual({
      text: "Next.js CMS",
      url: "https://my-agency.example/nextjs-cms/",
      kind: "absolute",
      source: "markdown",
      field: "contentMarkdown",
    });
    expect(r.note).toMatch(/complete list/u);
  });

  it("says plainly when there are none, and refuses a bad target", async () => {
    const empty = {
      read: vi.fn(async () => ({
        doc: { id: 9, title: "x", content: rt({ type: "text", text: "no links" }) },
      })),
    } as any;
    const r = await links(empty, { collection: "posts", id: 9 });

    expect(r.total).toBe(0);
    expect(r.note).toMatch(/No links in any field/u);
    const missing = await links(io, { collection: "posts", id: 404 });

    expect(missing.error).toMatch(/not found/u);
    const both = await links(io, { collection: "posts", global: "x", id: 1 });

    expect(both.error).toMatch(/exactly ONE/u);
  });

  it("lists the links of a global and names the read for what it is", async () => {
    const withGlobal: SchemaContext = {
      ...schema,
      globals: [{ slug: "footer", fields: postFields, hasVersions: true, hasDrafts: true }],
    };
    const globalLinks = (source: any, input: Record<string, unknown>) =>
      createReadDocumentTool(source, withGlobal).execute!(
        { ...input, view: "links" },
        ctx
      ) as Promise<any>;
    const read = vi.fn(async () => ({ doc: post() }));
    const r = await globalLinks({ read }, { global: "footer" });

    expect(r.document).toBe("footer");
    expect(r.total).toBe(6);
    expect(read).toHaveBeenCalledWith(
      { global: "footer" },
      expect.objectContaining({ callId: "list-links" })
    );
  });

  it("refuses a locale the project does not have before it reads", async () => {
    const read = vi.fn(async () => ({ doc: post() }));
    const r = await links({ read }, { collection: "posts", id: 151, locale: "zz" });

    expect(r.error).toMatch(/not localized/u);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("findUnresolvedNewLinks: links added by an edit must point at pages the site has", () => {
  const fields: SchemaField[] = [
    { name: "body", type: "textarea" },
    { name: "more", type: "richText", editor: "lexical" },
  ] as SchemaField[];
  const known = new Set([
    "payload-cms-agency",
    "strapi-cms-overview",
    "services/headless-cms-expert-agency",
  ]);
  const lookup = vi.fn(async (c: string[]) => c.some((x) => known.has(x)));
  const before = {
    body: "See [Payload](https://my-agency.example/payload-cms-agency/) and [Next](https://nextjs.org/docs).",
    more: rt({ type: "text", text: "x" }),
  };

  it("flags a composed URL on the document's own host and a relative one, and lets a real slug through", async () => {
    const after = {
      ...before,
      body:
        before.body +
        " Also [customisation](https://my-agency.example/strapi-customization/), [overview](https://my-agency.example/strapi-cms-overview/), " +
        "[experts](/services/headless-cms-expert-agency/), [modeling](/strapi-content-modeling/).",
    };
    const probe = vi.fn(async () => "missing" as const);
    const bad = await findUnresolvedNewLinks(fields, before, after, { lookup, probe });

    expect(bad.map((b) => [b.slug, b.verdict])).toEqual([
      ["strapi-customization", "missing"],
      ["strapi-content-modeling", "missing"],
    ]);
    expect(probe.mock.calls.map((c: any[]) => c[0])).toEqual([
      "https://my-agency.example/strapi-customization/",
      "https://my-agency.example/strapi-content-modeling/",
    ]);
  });

  it("never judges a URL the person wrote into the task - the gate is for composed URLs", async () => {
    const after = {
      ...before,
      body:
        before.body +
        " Read the [blog](https://my-agency.example/blog/) and [cases](/case-studies/).",
    };
    const probe = vi.fn(async () => "missing" as const);
    const bad = await findUnresolvedNewLinks(fields, before, after, {
      lookup,
      probe,
      instruction: 'link "blog" to https://my-agency.example/blog and "cases" to /case-studies/',
    });

    expect(bad).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
    const other = { ...before, body: before.body + " [b](/blog-archive/)" };

    expect(
      (
        await findUnresolvedNewLinks(fields, before, other, {
          lookup,
          probe,
          instruction: "link to /blog/",
        })
      ).map((b) => b.slug)
    ).toEqual(["blog-archive"]);
  });

  it("a route the site serves without a document (/blog/) passes when the site says so", async () => {
    const after = { ...before, body: before.body + " [blog](https://my-agency.example/blog/)" };
    const probe = vi.fn(async () => "ok" as const);

    expect(await findUnresolvedNewLinks(fields, before, after, { lookup, probe })).toEqual([]);
  });

  it("probes a relative link only on a host that serves this site's documents, not on the most cited one", async () => {
    const cited = {
      body:
        "See [a](https://docs.vendor.example/guide/a), [b](https://docs.vendor.example/guide/b), " +
        "[c](https://docs.vendor.example/guide/c) and [us](https://my-agency.example/payload-cms-agency/).",
      more: rt({ type: "text", text: "x" }),
    };
    const probe = vi.fn(async () => "missing" as const);
    const after = { ...cited, body: cited.body + " [pricing](/pricing/)" };
    const bad = await findUnresolvedNewLinks(fields, cited, after, { lookup, probe });

    expect(probe).toHaveBeenCalledWith("https://my-agency.example/pricing/");
    expect(bad.map((b) => b.verdict)).toEqual(["missing"]);
    const external = { body: cited.body.replace(/ and \[us\]\([^)]+\)/u, ""), more: cited.more };

    probe.mockClear();
    const unsure = await findUnresolvedNewLinks(
      fields,
      external,
      { ...external, body: external.body + " [pricing](/pricing/)" },
      { lookup, probe }
    );

    expect(probe).not.toHaveBeenCalled();
    expect(unsure.map((b) => b.verdict)).toEqual(["unverified"]);
  });

  it("reports, and does not condemn, a link the site could not be asked about", async () => {
    const after = {
      ...before,
      body: before.body + " [blog](https://my-agency.example/blog/) [x](/made-up/)",
    };

    expect(
      (await findUnresolvedNewLinks(fields, before, after, { lookup })).map((b) => b.verdict)
    ).toEqual(["unverified", "unverified"]);
    const down = vi.fn(async () => "unknown" as const);

    expect(
      (await findUnresolvedNewLinks(fields, before, after, { lookup, probe: down })).map(
        (b) => b.verdict
      )
    ).toEqual(["unverified", "unverified"]);
    const thrown = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    expect(
      (await findUnresolvedNewLinks(fields, before, after, { lookup, probe: thrown })).map(
        (b) => b.verdict
      )
    ).toEqual(["unverified", "unverified"]);
    const bad = await findUnresolvedNewLinks(
      fields,
      { body: "plain" },
      { body: "[b](/nope/)" },
      { lookup, probe: vi.fn(async () => "missing" as const) }
    );

    expect(bad.map((b) => b.verdict)).toEqual(["unverified"]);
  });

  it("ignores links that were already there, external hosts, files, and URL-valued fields", async () => {
    const after = {
      ...before,
      body:
        before.body +
        " [React](https://react.dev/learn) [pdf](https://my-agency.example/files/deck.pdf) [home](https://my-agency.example/)",
    };

    expect(await findUnresolvedNewLinks(fields, before, after, { lookup })).toEqual([]);
    const noHost = { body: "plain" };
    const bad = await findUnresolvedNewLinks(
      fields,
      noHost,
      { body: "[a](https://example.com/whatever/) [b](/nope/)" },
      { lookup }
    );

    expect(bad.map((b) => b.slug)).toEqual(["nope"]);
  });

  it("looks a nested route up by its last segment AND its full path", async () => {
    const after = {
      ...before,
      body:
        before.body + " [experts](https://my-agency.example/services/headless-cms-expert-agency/)",
    };

    lookup.mockClear();
    await findUnresolvedNewLinks(fields, before, after, { lookup });
    expect(lookup).toHaveBeenCalledWith([
      "headless-cms-expert-agency",
      "services/headless-cms-expert-agency",
    ]);
  });
});
