import { describe, it, expect } from "vitest";
import {
  censusTypes,
  validateLexical,
  collectTextNodes,
  gluedSides,
  inlineContext,
  isEmptyRichText,
  isGluedBoundary,
} from "../src/agent/content/lexicalEngine.js";

function makeDoc() {
  return {
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [
        {
          type: "paragraph",
          version: 1,
          children: [{ type: "text", version: 1, text: "Intro 2025" }],
        },
        {
          type: "block",
          version: 2,
          fields: { blockType: "cta", heading: "Sign up", url: "https://x.com/2025" },
        },
        { type: "upload", version: 2, relationTo: "media", value: "media-1", fields: {} },
        {
          type: "paragraph",
          version: 1,
          children: [
            {
              type: "link",
              version: 3,
              fields: { url: "https://x.com", linkType: "custom" },
              children: [{ type: "text", version: 1, text: "a link" }],
            },
          ],
        },
      ],
    },
  };
}

describe("censusTypes", () => {
  it("counts node types across nested carriers (block, upload, link, text)", () => {
    const c = censusTypes(makeDoc());

    expect(c.get("block")).toBe(1);
    expect(c.get("upload")).toBe(1);
    expect(c.get("link")).toBe(1);
    expect(c.get("paragraph")).toBe(2);
  });
});

describe("censusTypes: does not count arbitrary data-object `type` keys as Lexical nodes", () => {
  it('a link GROUP ({type:"custom", url}) nested in a block field is not counted as a node', () => {
    const tree = {
      root: {
        type: "root",
        version: 1,
        children: [
          {
            type: "block",
            version: 2,
            fields: { id: "b1", blockType: "cta", link: { type: "custom", url: "/x" } },
          },
        ],
      },
    };
    const counts = censusTypes(tree);

    expect(counts.get("block")).toBe(1);
    expect(counts.get("custom")).toBeUndefined();
  });
  it("still counts real nested Lexical nodes reached through a block's nested richText", () => {
    const tree = {
      root: {
        type: "root",
        version: 1,
        children: [
          {
            type: "block",
            version: 2,
            fields: {
              id: "b1",
              blockType: "callout",
              body: {
                root: {
                  type: "root",
                  version: 1,
                  children: [
                    {
                      type: "paragraph",
                      version: 1,
                      children: [{ type: "text", version: 1, text: "hi" }],
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    };
    const counts = censusTypes(tree);

    expect(counts.get("paragraph")).toBe(1);
    expect(counts.get("text")).toBe(1);
  });
});

describe("validateLexical", () => {
  it("is a graceful no-op without a config (pure-splice path)", async () => {
    const r = await validateLexical(makeDoc());

    expect(r).toMatchObject({ ok: true, validated: false });
  });
  it("rejects a tree without a root", async () => {
    const r = await validateLexical({ foo: "bar" } as any);

    expect(r.ok).toBe(false);
  });
});

const refs_ = (c: any) => collectTextNodes(c).map((r) => r.node);

describe("collectTextNodes (lossless text-transform primitive)", () => {
  it("collects non-empty text nodes in document order, descending into links", () => {
    const refs = refs_(makeDoc());

    expect(refs.map((n) => n.text)).toEqual(["Intro 2025", "a link"]);
  });

  it("does NOT collect plain-string block fields (heading/url) or upload values - needs schema to translate safely", () => {
    const texts = refs_(makeDoc()).map((n) => n.text);

    expect(texts).not.toContain("Sign up");
    expect(texts.some((t) => t.includes("http"))).toBe(false);
  });

  it("DOES descend into a nested richText body inside an embedded block (BlocksFeature)", () => {
    const doc: any = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Before" }] },
          {
            type: "block",
            version: 2,
            fields: {
              blockType: "callout",
              id: "c1",
              tone: "info",
              body: {
                root: {
                  type: "root",
                  children: [
                    { type: "paragraph", children: [{ type: "text", text: "Inside block" }] },
                  ],
                },
              },
            },
          },
          { type: "paragraph", children: [{ type: "text", text: "After" }] },
        ],
      },
    };
    const refs = refs_(doc);

    expect(refs.map((n) => n.text)).toEqual(["Before", "Inside block", "After"]);
    refs[1].text = "Translated";
    expect(doc.root.children[1].fields.body.root.children[0].children[0].text).toBe("Translated");
    expect(doc.root.children[1].fields.blockType).toBe("callout");
    expect(doc.root.children[1].fields.tone).toBe("info");
  });

  it("collects richText nested in an array inside an embedded block, in document order", () => {
    const doc: any = {
      root: {
        type: "root",
        children: [
          {
            type: "inlineBlock",
            version: 1,
            fields: {
              blockType: "cards",
              id: "b1",
              items: [
                {
                  id: "i1",
                  body: {
                    root: {
                      type: "root",
                      children: [{ type: "paragraph", children: [{ type: "text", text: "one" }] }],
                    },
                  },
                },
                {
                  id: "i2",
                  body: {
                    root: {
                      type: "root",
                      children: [{ type: "paragraph", children: [{ type: "text", text: "two" }] }],
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    };

    expect(refs_(doc).map((n) => n.text)).toEqual(["one", "two"]);
  });

  it("returns live references: mutating ref.text changes the tree in place", () => {
    const doc: any = makeDoc();

    refs_(doc)[0].text = "Intro 2026";
    expect(doc.root.children[0].children[0].text).toBe("Intro 2026");
  });

  it("skips whitespace-only text nodes", () => {
    const doc = {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "   " },
              { type: "text", text: "real" },
            ],
          },
        ],
      },
    };

    expect(refs_(doc).map((n) => n.text)).toEqual(["real"]);
  });
});

describe("isEmptyRichText", () => {
  it("treats an empty/whitespace paragraph tree as empty", () => {
    expect(isEmptyRichText({ root: { type: "root", children: [] } })).toBe(true);
    expect(
      isEmptyRichText({
        root: {
          type: "root",
          children: [{ type: "paragraph", children: [{ type: "text", text: "   " }] }],
        },
      })
    ).toBe(true);
    expect(isEmptyRichText(null)).toBe(true);
    expect(isEmptyRichText(undefined)).toBe(true);
  });

  it("treats real text as non-empty", () => {
    expect(
      isEmptyRichText({
        root: {
          type: "root",
          children: [{ type: "paragraph", children: [{ type: "text", text: "hi" }] }],
        },
      })
    ).toBe(false);
  });

  it("treats a structural-only field (upload/block, no prose) as non-empty", () => {
    expect(
      isEmptyRichText({
        root: {
          type: "root",
          children: [{ type: "upload", relationTo: "media", value: "m1", fields: {} }],
        },
      })
    ).toBe(false);
    expect(
      isEmptyRichText({
        root: { type: "root", children: [{ type: "heading", tag: "h2", children: [] }] },
      })
    ).toBe(false);
  });

  it("accepts a bare root node, not just a { root } wrapper", () => {
    expect(isEmptyRichText({ type: "root", children: [] })).toBe(true);
  });
});

const glued = () => ({
  root: {
    type: "root",
    version: 1,
    children: [
      {
        type: "paragraph",
        version: 1,
        children: [
          { type: "text", version: 1, text: "Lokalise", format: 1 },
          { type: "text", version: 1, text: " explains how" },
          {
            type: "link",
            version: 3,
            fields: { url: "https://x.com/cl" },
            children: [{ type: "text", version: 1, text: "continuous localization" }],
          },
          { type: "text", version: 1, text: "removes the bottleneck." },
        ],
      },
      {
        type: "paragraph",
        version: 1,
        children: [{ type: "text", version: 1, text: "Next paragraph." }],
      },
    ],
  },
});

describe("inline neighbours: block identity and inlineContext", () => {
  it("collectTextNodes tags every text node with the block it sits in", () => {
    const refs = collectTextNodes(glued());

    expect(refs).toHaveLength(5);
    expect(refs[0].block).toBe(refs[1].block);
    expect(refs[1].block).toBe(refs[2].block);
    expect(refs[3].block).not.toBe(refs[4].block);
  });

  it("inlineContext shows the characters either side of a node, through links, with no space when there is none", () => {
    const refs = collectTextNodes(glued());
    const anchor = inlineContext(refs[2].block, refs[2].node);

    expect(anchor).toEqual({ before: "Lokalise explains how", after: "removes the bottleneck." });
    const first = inlineContext(refs[0].block, refs[0].node);

    expect(first.before).toBe("");
    expect(first.after).toMatch(/^ explains how/u);
    const alone = inlineContext(refs[4].block, refs[4].node);

    expect(alone).toEqual({ before: "", after: "" });
  });

  it("inlineContext shows an inline block between two words as a marker, not as a glued boundary", () => {
    const doc = {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Price:" },
              { type: "inlineBlock", fields: { blockType: "price", amount: 10 } },
              { type: "text", text: "per seat" },
            ],
          },
        ],
      },
    };
    const refs = collectTextNodes(doc);

    expect(refs).toHaveLength(2);
    expect(inlineContext(refs[1].block, refs[1].node).before).toBe("Price:[block]");
    expect(inlineContext(refs[0].block, refs[0].node).after).toBe("[block]per seat");
  });

  it("inlineContext counts whitespace-only nodes that collectTextNodes skips", () => {
    const doc = {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "how" },
              { type: "text", text: " " },
              {
                type: "link",
                fields: { url: "https://x.com" },
                children: [{ type: "text", text: "anchor" }],
              },
            ],
          },
        ],
      },
    };
    const refs = collectTextNodes(doc);

    expect(refs).toHaveLength(2);
    expect(inlineContext(refs[1].block, refs[1].node).before).toBe("how ");
  });
});

describe("glued boundaries", () => {
  it("flags only word-to-word boundaries with no space, not label/space or punctuation boundaries", () => {
    expect(isGluedBoundary("explains how", "continuous")).toBe(true);
    expect(isGluedBoundary("Lokalise", " explains")).toBe(false);
    expect(isGluedBoundary("Trigger:", " An editor")).toBe(false);
    expect(isGluedBoundary("Trigger:", "An editor")).toBe(false);
    expect(isGluedBoundary("объясняет как", "непрерывная")).toBe(true);
    expect(isGluedBoundary("詳しくは", "ガイド")).toBe(false);
    expect(isGluedBoundary("ดูที่", "คู่มือ")).toBe(false);
    expect(isGluedBoundary("see", ".")).toBe(false);
    expect(isGluedBoundary("", "x")).toBe(false);
    expect(
      gluedSides(" explains how", { before: "Lokalise", after: "continuous localization" })
    ).toEqual(["after"]);
    expect(
      gluedSides("continuous localization", {
        before: "Lokalise explains how",
        after: "removes the",
      })
    ).toEqual(["before", "after"]);
    expect(gluedSides(" explains how ", { before: "Lokalise", after: "continuous" })).toEqual([]);
  });
});
