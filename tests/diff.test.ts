import { describe, it, expect } from "vitest";
import { computeDocDiff, itemSummary, richTextToText } from "../src/agent/content/diff.js";
import type { SchemaField } from "../src/types.js";

const fields: SchemaField[] = [
  { name: "title", type: "text" },
  { name: "body", type: "richText", editor: "lexical" },
  {
    name: "layout",
    type: "blocks",
    blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }],
  },
];

const rt = (text: string) => ({
  root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text }] }] },
});

const rtLink = (url: string) => ({
  root: {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            fields: { url, linkType: "custom" },
            children: [{ type: "text", text: "Get in touch" }],
          },
        ],
      },
    ],
  },
});

describe("computeDocDiff", () => {
  it("shows no text change when only the format of part of a word changed", () => {
    const split = {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Pay", format: 1 },
              { type: "text", text: "load is fast" },
            ],
          },
          { type: "paragraph", children: [{ type: "text", text: "Second." }] },
        ],
      },
    };
    const whole = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Payload is fast" }] },
          { type: "paragraph", children: [{ type: "text", text: "Second." }] },
        ],
      },
    };

    expect(richTextToText(split)).toBe("Payload is fast Second.");
    expect(richTextToText(split)).toBe(richTextToText(whole));
    expect(richTextToText(rtLink("https://x.io/a"))).toBe("Get in touch (https://x.io/a)");
  });

  it("reports a changed scalar field with before/after", () => {
    const d = computeDocDiff({
      fields,
      collection: "pages",
      published: { id: 1, title: "Old" },
      draft: { id: 1, title: "New", _status: "changed" },
    });
    const f = d.fields.find((x) => x.name === "title")!;

    expect(f).toMatchObject({ type: "text", before: "Old", after: "New" });
    expect(d.status).toBe("changed");
    expect(d.isNew).toBe(false);
  });

  it("reduces richText to plain text for both sides", () => {
    const d = computeDocDiff({
      fields,
      collection: "pages",
      published: { id: 1, body: rt("Hello world") },
      draft: { id: 1, body: rt("Bonjour le monde") },
    });
    const f = d.fields.find((x) => x.name === "body")!;

    expect(f.type).toBe("richText");
    expect(f.before).toBe("Hello world");
    expect(f.after).toBe("Bonjour le monde");
  });

  it("makes a link-URL-only change visible in the richText diff (find/replace on a CTA URL)", () => {
    const d = computeDocDiff({
      fields,
      collection: "pages",
      published: { id: 1, body: rtLink("https://my-agency.example/#contacts") },
      draft: { id: 1, body: rtLink("https://my-agency.example/contact-us") },
    });
    const f = d.fields.find((x) => x.name === "body")!;

    expect(f.before).toContain("#contacts");
    expect(f.after).toContain("contact-us");
    expect(f.before).not.toBe(f.after);
  });

  it("summarizes block arrays: added / removed / reordered / changed (by id)", () => {
    const before = {
      id: 1,
      layout: [
        { id: "a", blockType: "hero", heading: "A" },
        { id: "b", blockType: "hero", heading: "B" },
      ],
    };
    const after = {
      id: 1,
      layout: [
        { id: "b", blockType: "hero", heading: "B2" },
        { id: "c", blockType: "hero", heading: "C" },
      ],
    };
    const d = computeDocDiff({ fields, collection: "pages", published: before, draft: after });
    const f = d.fields.find((x) => x.name === "layout")!;

    expect(f.blocks!.added.map((x) => x.id)).toEqual(["c"]);
    expect(f.blocks!.removed.map((x) => x.id)).toEqual(["a"]);
    expect(f.blocks!.changed.map((x) => x.id)).toEqual(["b"]);
    expect(f.blocks!.changed[0].fields).toContain("heading");
  });

  it("treats a never-published doc as new (before = null)", () => {
    const d = computeDocDiff({
      fields,
      collection: "pages",
      published: null,
      draft: { id: 1, title: "Fresh", _status: "draft" },
    });

    expect(d.isNew).toBe(true);
    expect(d.fields.find((x) => x.name === "title")!.after).toBe("Fresh");
  });

  it("ignores system fields like _status", () => {
    const d = computeDocDiff({
      fields,
      collection: "pages",
      published: { id: 1, title: "X", _status: "published" },
      draft: { id: 1, title: "X", _status: "draft" },
    });

    expect(d.fields).toHaveLength(0);
  });

  it("returns no field diffs when content is identical", () => {
    const doc = { id: 1, title: "Same", body: rt("same") };

    expect(
      computeDocDiff({ fields, collection: "pages", published: doc, draft: { ...doc } }).fields
    ).toHaveLength(0);
  });
});

describe("computeDocDiff: uses the collection's configured title field, not a hardcoded guess", () => {
  const headlineFields: SchemaField[] = [{ name: "headline", type: "text" }];

  it("resolves the title from useAsTitle instead of guessing title/name", () => {
    const diff = computeDocDiff({
      fields: headlineFields,
      collection: "posts",
      published: { headline: "Old" },
      draft: { headline: "New", id: "1" },
      opts: { titleField: "headline" },
    });

    expect(diff.title).toBe("New");
  });
  it('does not hide a content field literally named "sizes" on a NON-upload collection', () => {
    const withSizes: SchemaField[] = [{ name: "sizes", type: "text" }];
    const diff = computeDocDiff({
      fields: withSizes,
      collection: "apparel",
      published: { sizes: "S,M" },
      draft: { sizes: "S,M,L", id: "1" },
      opts: { upload: false },
    });

    expect(diff.fields.some((f) => f.name === "sizes")).toBe(true);
  });
  it('still hides "sizes" as system noise on an upload collection', () => {
    const withSizes: SchemaField[] = [{ name: "sizes", type: "json" }];
    const diff = computeDocDiff({
      fields: withSizes,
      collection: "media",
      published: {},
      draft: { sizes: { thumbnail: {} }, id: "1" },
      opts: { upload: true },
    });

    expect(diff.fields.some((f) => f.name === "sizes")).toBe(false);
  });
});

describe("computeDocDiff: created-doc (before={}) hygiene", () => {
  it("skips createdAt/updatedAt noise and reports isNew for a fresh doc", () => {
    const titleFields: SchemaField[] = [{ name: "title", type: "text" }];
    const draft = {
      id: "x",
      title: "Hello",
      createdAt: "2026-07-11T00:00:00Z",
      updatedAt: "2026-07-11T00:00:00Z",
      _status: "draft",
    };
    const diff = computeDocDiff({ fields: titleFields, collection: "posts", published: {}, draft });

    expect(diff.isNew).toBe(true);
    expect(diff.fields.map((f) => f.name)).toEqual(["title"]);
    expect(diff.fields.map((f) => f.name)).not.toContain("createdAt");
  });
});

const layout = (...items: any[]) => ({ id: 1, layout: items });
const hero = (id: string, heading: string) => ({ id, blockType: "hero", heading });

describe('block diff identity ("-1 removed" said nothing about WHICH block)', () => {
  it("names a removed block by type and summary", () => {
    const d = computeDocDiff({
      fields,
      collection: "pages",
      published: layout(hero("a", "Our Sanity practice"), hero("b", "Testimonials")),
      draft: layout(hero("b", "Testimonials")),
    });
    const blocks = d.fields.find((x) => x.name === "layout")!.blocks!;

    expect(blocks.removed).toEqual([
      { id: "a", blockType: "hero", summary: "Our Sanity practice" },
    ]);
    expect(blocks.added).toEqual([]);
  });

  it("summarizes an added block and a changed block the same way", () => {
    const d = computeDocDiff({
      fields,
      collection: "pages",
      published: layout(hero("a", "Old heading")),
      draft: layout(hero("a", "New heading"), hero("c", "Pricing")),
    });
    const blocks = d.fields.find((x) => x.name === "layout")!.blocks!;

    expect(blocks.added).toEqual([{ id: "c", blockType: "hero", summary: "Pricing" }]);
    expect(blocks.changed).toEqual([
      { id: "a", blockType: "hero", summary: "New heading", fields: ["heading"] },
    ]);
  });

  it("falls back to the first prose in the block, including rich text and nested rows, and truncates", () => {
    const long = "x".repeat(200);

    expect(
      itemSummary({ id: "r", blockType: "richSection", content: rt("From the rich text") })
    ).toBe("From the rich text");
    expect(
      itemSummary({ id: "n", blockType: "cards", cards: [{ id: "c1", title: "First card" }] })
    ).toBe("First card");
    expect(itemSummary({ id: "m", blockType: "image", image: 42 })).toBe("");
    expect(itemSummary({ id: "l", blockType: "text", text: long })).toHaveLength(90);
  });
});
