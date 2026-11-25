import { describe, expect, it } from "vitest";

import { createDocumentRewriteTools } from "../src/agent/content/documentRewrite.js";
import type { SchemaContext } from "../src/types.js";

const opts = { toolCallId: "t", messages: [] } as any;

const link = (url: string, text: string) => ({
  type: "link",
  fields: { url, newTab: false },
  children: [{ type: "text", text, format: 0, version: 1 }],
  version: 1,
});

const richText = (paragraphs: string[], extra: any[] = []) => ({
  root: {
    type: "root",
    children: [
      ...paragraphs.map((t) => ({
        type: "paragraph",
        children: [{ type: "text", text: t, format: 0, version: 1 }],
        version: 1,
      })),
      ...extra,
    ],
    direction: null,
    format: "",
    indent: 0,
    version: 1,
  },
});

const schema: SchemaContext = {
  collections: [
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text" },
        { name: "snippet", type: "code" },
        { name: "contact", type: "email" },
        { name: "body", type: "richText", editor: "lexical" },
        {
          name: "layout",
          type: "blocks",
          blocks: [
            {
              slug: "hero",
              fields: [
                { name: "heading", type: "text" },
                { name: "intro", type: "richText", editor: "lexical" },
              ],
            },
          ],
        },
      ],
    },
  ],
  globals: [],
} as any;

const makeDoc = () => ({
  id: "p1",
  title: "Sanity CMS agency",
  snippet: "const x = 1",
  contact: "hello@example.com",
  body: richText(
    ["We build with Sanity.", "Ask us anything."],
    [
      { type: "upload", relationTo: "media", value: { id: 9 }, version: 1 },
      {
        type: "paragraph",
        version: 1,
        children: [link("https://my-agency.example/sanity-cms-overview/", "Sanity CMS overview")],
      },
    ]
  ),
  layout: [
    {
      id: "h1",
      blockType: "hero",
      heading: "Sanity experts",
      intro: richText(["Years of Sanity work."]),
    },
  ],
});

const ws = (doc: any) => ({ ref: { current: doc }, collection: "pages", global: null }) as any;

describe("readDocumentText", () => {
  it("numbers every editable string across fields, blocks and rich text segments", async () => {
    const t = createDocumentRewriteTools(ws(makeDoc()), schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const values = Object.values(r.text);

    expect(values).toContain("Sanity CMS agency");
    expect(values).toContain("We build with Sanity.");
    expect(values).toContain("Ask us anything.");
    expect(values).toContain("Sanity experts");
    expect(values).toContain("Years of Sanity work.");
    expect(r.count).toBe(6);
    expect(r.fields.find((f: any) => f.ref === "body").entries).toBe(3);
  });

  it("leaves code and email out of a prose pass", async () => {
    const t = createDocumentRewriteTools(ws(makeDoc()), schema);
    const r: any = await t.readDocumentText.execute!({}, opts);

    expect(Object.values(r.text)).not.toContain("const x = 1");
    expect(Object.values(r.text)).not.toContain("hello@example.com");
    expect(r.skipped.join(" ")).toMatch(/snippet|contact/u);
  });
});

describe("applyDocumentText", () => {
  it("rewrites the whole document in one call", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = (text: string) => Object.entries(read.text).find(([, v]) => v === text)![0];
    const r: any = await t.applyDocumentText.execute!(
      {
        token: read.token,
        text: {
          [n("Sanity CMS agency")]: "Strapi CMS agency",
          [n("We build with Sanity.")]: "We build with Strapi.",
          [n("Sanity experts")]: "Strapi experts",
          [n("Years of Sanity work.")]: "Years of Strapi work.",
        },
      },
      opts
    );

    expect(r.ok).toBe(true);
    expect(r.changed).toBe(4);
    expect(doc.title).toBe("Strapi CMS agency");
    expect(doc.body.root.children[0].children[0].text).toBe("We build with Strapi.");
    expect(doc.layout[0].heading).toBe("Strapi experts");
    expect(doc.layout[0].intro.root.children[0].children[0].text).toBe("Years of Strapi work.");
  });

  it("leaves structure untouched: every node keeps its type and the upload its value", async () => {
    const doc = makeDoc();
    const before = JSON.parse(JSON.stringify(doc.body.root.children.map((c: any) => c.type)));
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "We build with Sanity.")![0];

    await t.applyDocumentText.execute!({ token: read.token, text: { [n]: "Rewritten." } }, opts);
    expect(doc.body.root.children.map((c: any) => c.type)).toEqual(before);
    expect(doc.body.root.children.find((c: any) => c.type === "upload")).toMatchObject({
      value: { id: 9 },
    });
  });

  it("refuses to blank a string", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "Sanity CMS agency")![0];
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: { [n]: "   " } },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toMatch(/does not delete text/u);
    expect(r.errors[0].error).toContain('setValues({ edits: [{ ref: "title", value }] })');
    expect(doc.title).toBe("Sanity CMS agency");
  });

  it("a blank entry of a rich text field names the call that deletes a paragraph", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "Ask us anything.")![0];
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: { [n]: "" } },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toContain('applyRichText on "body"');
    expect(doc.body.root.children[1].children[0].text).toBe("Ask us anything.");
  });

  it("entries sent back as they are do not read as a write", async () => {
    const doc = makeDoc();
    const before = structuredClone(doc);
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "Ask us anything.")![0];
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: { [n]: "Ask us anything." } },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.changed).toBe(0);
    expect(r.error).toMatch(/Nothing was written[\s\S]*applyRichText/u);
    expect(doc).toEqual(before);
  });

  it("refuses edits written against a stale read", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);

    await t.readDocumentText.execute!({}, opts);
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: { "1": "x" } },
      opts
    );

    expect(r.error).toMatch(/Stale token/u);
  });

  it("reports per-field coverage so a half-done pass cannot look finished", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "We build with Sanity.")![0];
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: { [n]: "One of two." } },
      opts
    );

    expect(r.coverage).toContainEqual({ ref: "body", changed: 1, entries: 3 });
    expect(r.note).toMatch(/partly rewritten/u);
  });

  it("rejects an unknown entry number without losing the good ones", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "Sanity CMS agency")![0];
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: { [n]: "Strapi CMS agency", "999": "nowhere" } },
      opts
    );

    expect(r.changed).toBe(1);
    expect(r.failed).toBe(1);
    expect(doc.title).toBe("Strapi CMS agency");
  });

  it("needs a read before it will write", async () => {
    const t = createDocumentRewriteTools(ws(makeDoc()), schema);
    const r: any = await t.applyDocumentText.execute!({ token: "x", text: { "1": "y" } }, opts);

    expect(r.error).toMatch(/readDocumentText first/u);
  });
});

describe("anchors", () => {
  it("surfaces each anchor's destination alongside its text", async () => {
    const t = createDocumentRewriteTools(ws(makeDoc()), schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(r.text).find(([, v]) => v === "Sanity CMS overview")![0];

    expect(r.links[n]).toBe("https://my-agency.example/sanity-cms-overview/");
  });

  it("repoints a link in the same pass that rewrites its words", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "Sanity CMS overview")![0];
    const r: any = await t.applyDocumentText.execute!(
      {
        token: read.token,
        text: { [n]: "Strapi CMS overview" },
        links: { [n]: "https://my-agency.example/strapi-cms-overview/" },
      },
      opts
    );

    expect(r.ok).toBe(true);
    expect(r.relinked).toBe(1);
    const para = doc.body.root.children.at(-1) as any;

    expect(para.children[0].fields.url).toBe("https://my-agency.example/strapi-cms-overview/");
    expect(para.children[0].children[0].text).toBe("Strapi CMS overview");
  });

  it("refuses a destination that is not a usable URL", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "Sanity CMS overview")![0];
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: {}, links: { [n]: "strapi-cms-overview" } },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toMatch(/not a usable URL/u);
  });

  it("refuses to repoint an entry that is not an anchor", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "Sanity CMS agency")![0];
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: {}, links: { [n]: "https://example.com/" } },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toMatch(/not inside a link/u);
  });
});

const gluedDoc = () => ({
  id: "p2",
  title: "Localization",
  body: {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: [
        {
          type: "paragraph",
          version: 1,
          children: [
            { type: "text", version: 1, text: "Lokalise", format: 1 },
            { type: "text", version: 1, text: " explains how" },
            link("https://x.com/cl", "continuous localization"),
            { type: "text", version: 1, text: "removes the bottleneck." },
          ],
        },
        {
          type: "paragraph",
          version: 1,
          children: [
            { type: "text", version: 1, text: "Problem:", format: 1 },
            { type: "text", version: 1, text: " Sanity stores content as Portable Text." },
          ],
        },
      ],
    },
  },
  layout: [],
});

describe("inline neighbours: the glued-link case", () => {
  it("readDocumentText shows the characters either side of a segment that shares its paragraph", async () => {
    const doc: any = gluedDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const n = Number(Object.entries(r.text).find(([, v]) => v === "continuous localization")![0]);

    expect(r.context[n]).toEqual({
      before: "Lokalise explains how",
      after: "removes the bottleneck.",
    });
    const titleN = Number(Object.entries(r.text).find(([, v]) => v === "Localization")![0]);

    expect(r.context[titleN]).toBeUndefined();
    expect(r.hint).toMatch(/glued/u);
    const explains = Number(Object.entries(r.text).find(([, v]) => v === " explains how")![0]);
    const removes = Number(
      Object.entries(r.text).find(([, v]) => v === "removes the bottleneck.")![0]
    );

    expect(r.glued).toEqual([
      {
        between: `${explains}|${n}`,
        shows: "explains how|continuous l",
      },
      {
        between: `${n}|${removes}`,
        shows: "localization|removes the ",
      },
    ]);
    expect(r.gluedNote).toMatch(/2 boundaries/u);
    expect(r.gluedNote).toMatch(/fixGlued: true/u);
    const r2: any = await t.applyDocumentText.execute!({ token: r.token, fixGlued: true }, opts);

    expect(r2.ok).toBe(true);
    expect(r2.changed).toBe(2);
    expect(r2.gluedLeft).toBeUndefined();
    expect(doc.body.root.children[0].children[1].text).toBe(" explains how ");
    expect(doc.body.root.children[0].children[3].text).toBe(" removes the bottleneck.");
    const again: any = await t.applyDocumentText.execute!({ token: r.token, fixGlued: true }, opts);

    expect(again.error).toMatch(/no two words run together/u);
    const r3: any = await t.readDocumentText.execute!({}, opts);

    expect(r3.glued).toBeUndefined();
  });

  it("applyDocumentText refuses an entry that copies the previous neighbour in, and one that copies the next one", async () => {
    const doc: any = gluedDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const byText = (s: string) => Object.entries(r.text).find(([, v]) => v === s)![0];
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [byText(" explains how")]: "Lokalise explains how " } },
      opts
    );

    expect(a.errors[0].error).toMatch(/segment before it/u);
    const b: any = await t.applyDocumentText.execute!(
      {
        token: r.token,
        text: { [byText("Problem:")]: "Problem: Sanity stores content as Portable Text." },
      },
      opts
    );

    expect(b.errors[0].error).toMatch(/segment after it/u);
    expect(doc.body.root.children[0].children[1].text).toBe(" explains how");
    expect(doc.body.root.children[1].children[0].text).toBe("Problem:");
  });

  it("applyDocumentText accepts the real fix: a space inside the entry", async () => {
    const doc: any = gluedDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const byText = (s: string) => Object.entries(r.text).find(([, v]) => v === s)![0];
    const a: any = await t.applyDocumentText.execute!(
      {
        token: r.token,
        text: {
          [byText(" explains how")]: " explains how ",
          [byText("removes the bottleneck.")]: " removes the bottleneck.",
        },
      },
      opts
    );

    expect(a.failed).toBe(0);
    expect(doc.body.root.children[0].children[1].text).toBe(" explains how ");
    expect(doc.body.root.children[0].children[3].text).toBe(" removes the bottleneck.");
  });

  it("a write that fixes one boundary of two names the one that is left and the call that fixes it", async () => {
    const doc: any = gluedDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const byText = (s: string) => Object.entries(r.text).find(([, v]) => v === s)![0];
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [byText(" explains how")]: " explains how " } },
      opts
    );

    expect(a.gluedLeft).toEqual([
      {
        between: `${byText("continuous localization")}|${byText("removes the bottleneck.")}`,
        shows: "localization|removes the ",
      },
    ]);
    expect(a.gluedNote).toMatch(/fixGlued: true/u);
    const b: any = await t.applyDocumentText.execute!({ token: r.token, fixGlued: true }, opts);

    expect(b.ok).toBe(true);
    expect(b.gluedLeft).toBeUndefined();
    expect(doc.body.root.children[0].children[3].text).toBe(" removes the bottleneck.");
  });

  it("a write that is not about spacing says nothing of the boundaries it did not touch", async () => {
    const doc: any = gluedDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const byText = (s: string) => Object.entries(r.text).find(([, v]) => v === s)![0];
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [byText("Problem:")]: "The problem:" } },
      opts
    );

    expect(a.ok).toBe(true);
    expect(a.gluedLeft).toBeUndefined();
  });
});

describe("inline markdown in applyDocumentText entries and append", () => {
  it("an entry with [text](url) becomes text + link node, and a second write to it asks for a new read", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(r.text).find(([, v]) => v === "We build with Sanity.")![0];
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [n]: "We build with [Sanity](https://www.sanity.io)." } },
      opts
    );

    expect(a.failed).toBe(0);
    expect(a.linksCreated).toBe(1);
    expect(a.linksNote).toMatch(/readDocumentText again/u);
    const children = doc.body.root.children[0].children;

    expect(children.map((c: any) => c.type)).toEqual(["text", "link", "text"]);
    expect(children[1].fields.url).toBe("https://www.sanity.io");
    expect(JSON.stringify(doc.body)).not.toContain("](");
    const b: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [n]: "We build with" } },
      opts
    );

    expect(b.failed).toBe(1);
    expect(b.errors[0].error).toMatch(/readDocumentText/u);
    expect(children.map((c: any) => c.text ?? c.children[0].text)).toEqual([
      "We build with ",
      "Sanity",
      ".",
    ]);
  });

  it("a link written inside a list item reports no glued boundary, and fixGlued does not write the entry again", async () => {
    const doc: any = makeDoc();

    doc.body.root.children.push({
      type: "list",
      listType: "bullet",
      version: 1,
      children: [
        {
          type: "listitem",
          value: 1,
          version: 1,
          children: [{ type: "text", text: "Read the guide now", format: 0, version: 1 }],
        },
      ],
    });
    const t = createDocumentRewriteTools(ws(doc), schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(r.text).find(([, v]) => v === "Read the guide now")![0];
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [n]: "Read [the guide](https://x.io) now" } },
      opts
    );

    expect(a.ok).toBe(true);
    expect(a.gluedLeft).toBeUndefined();
    const again: any = await t.applyDocumentText.execute!({ token: r.token, fixGlued: true }, opts);
    const item = doc.body.root.children.at(-1).children[0];
    const words = item.children.map((c: any) => c.text ?? c.children[0].text).join("");

    expect(again.changed ?? 0).toBe(0);
    expect(words).toBe("Read the guide now");
    expect(item.children.filter((c: any) => c.type === "link")).toHaveLength(1);
  });

  it("append with a markdown link lands as a paragraph with a real link node", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const a: any = await t.applyDocumentText.execute!(
      { token: "none", append: { body: "Read the [full guide](https://example.com/guide) next." } },
      opts
    );

    expect(a.appended).toBe(1);
    const para = doc.body.root.children[doc.body.root.children.length - 1];

    expect(para.children.map((c: any) => c.type)).toEqual(["text", "link", "text"]);
    expect(para.children[1].children[0].text).toBe("full guide");
  });

  it("refuses block markdown in an entry", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(r.text).find(([, v]) => v === "Ask us anything.")![0];
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [n]: "- Ask us anything." } },
      opts
    );

    expect(a.errors[0].error).toMatch(/surgical/u);
  });

  it("links on a plain entry says how a link is added, instead of a dead end", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "We build with Sanity.")![0];
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: {}, links: { [n]: "https://www.sanity.io" } },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toMatch(/\[the words\]\(https:\/\/www\.sanity\.io\)/u);
    const r2: any = await t.applyDocumentText.execute!(
      { token: read.token, text: { [n]: "We build with [Sanity](https://www.sanity.io)." } },
      opts
    );

    expect(r2.ok).toBe(true);
    expect(JSON.stringify(doc.body)).toContain('"url":"https://www.sanity.io"');
  });

  it("a link added by inserting its words instead of wrapping them is called out, with the fix", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "We build with Sanity.")![0];
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: { [n]: "[Sanity](https://www.sanity.io) We build with Sanity." } },
      opts
    );

    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/the WORDS changed as well as the markup/u);
    expect(r.warnings[0]).toMatch(/now reads "Sanity We build with Sanity\./u);
    const read2: any = await t.readDocumentText.execute!({}, opts);
    const m = Object.entries(read2.text).find(([, v]) => v === "Ask us anything.")![0];
    const r2: any = await t.applyDocumentText.execute!(
      { token: read2.token, text: { [m]: "Ask us [anything](https://example.com/faq)." } },
      opts
    );

    expect(r2.warnings).toBeUndefined();
  });

  it("repointing an existing anchor says so, with the undo and the way to add a link instead", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const n = Object.entries(read.text).find(([, v]) => v === "Sanity CMS overview")![0];
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: {}, links: { [n]: "https://my-agency.example/blog/" } },
      opts
    );

    expect(r.ok).toBe(true);
    expect(r.relinked).toBe(1);
    expect(r.warnings[0]).toMatch(
      /was already a link to https:\/\/my-agency\.example\/sanity-cms-overview\/ and now points to https:\/\/my-agency\.example\/blog\/ - that is a REPOINT/u
    );
    expect(r.warnings[0]).toContain(
      `links: { "${n}": "https://my-agency.example/sanity-cms-overview/" }`
    );
    const r2: any = await t.applyDocumentText.execute!(
      { token: read.token, text: {}, links: { [n]: "https://my-agency.example/blog/" } },
      opts
    );

    expect(r2.relinked).toBe(0);
    expect(r2.warnings).toBeUndefined();
  });

  it('a task that adds a link cannot repoint an existing one through "links"', async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema, {
      textPassReads: 0,
      linkIntent: () => "more",
    });
    const read: any = await t.readDocumentText.execute!({}, opts);
    const anchor = Object.entries(read.text).find(([, v]) => v === "Sanity CMS overview")![0];
    const r: any = await t.applyDocumentText.execute!(
      { token: read.token, text: {}, links: { [anchor]: "https://my-agency.example/blog/" } },
      opts
    );

    expect(r.failed).toBe(1);
    expect(r.errors[0].error).toMatch(/this task adds a link - it does not repoint/u);
    expect(r.errors[0].error).toContain("[the words](https://my-agency.example/blog/)");
    expect(JSON.stringify(doc.body)).toContain("https://my-agency.example/sanity-cms-overview/");
    const plain = Object.entries(read.text).find(([, v]) => v === "We build with Sanity.")![0];
    const r2: any = await t.applyDocumentText.execute!(
      {
        token: read.token,
        text: { [plain]: "We build with [Sanity](https://my-agency.example/blog/)." },
      },
      opts
    );

    expect(r2.ok).toBe(true);
  });

  it("a link written into an anchor names the first plain entry that holds the word, with the write ready", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const anchor = Object.entries(read.text).find(([, v]) => v === "Sanity CMS overview")![0];
    const plain = Object.entries(read.text).find(([, v]) => v === "We build with Sanity.")![0];
    const r: any = await t.applyDocumentText.execute!(
      {
        token: read.token,
        text: { [anchor]: "[Sanity](https://my-agency.example/blog/) CMS overview" },
      },
      opts
    );

    expect(r.failed).toBe(1);
    expect(r.errors[0].error).toContain(
      `The first PLAIN entry in body with "Sanity" is entry ${plain}`
    );
    expect(r.errors[0].error).toContain(
      `text: { "${plain}": "We build with [Sanity](https://my-agency.example/blog/)." }`
    );
    expect(JSON.stringify(doc.body)).not.toContain("my-agency.example/blog/");
  });
});
