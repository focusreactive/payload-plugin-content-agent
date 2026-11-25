import { describe, it, expect } from "vitest";
import { htmlToLexical, extractArticle } from "../src/agent/subAgents/htmlToLexical.js";

describe("extractArticle", () => {
  it("extracts title from og:title meta", () => {
    const html = `<html><head><meta property="og:title" content="My Title"></head><body><p>hello</p></body></html>`;
    const { title } = extractArticle(html);

    expect(title).toBe("My Title");
  });

  it("falls back to h1 for title", () => {
    const html = `<html><body><h1>H1 Title</h1><p>hello</p></body></html>`;
    const { title } = extractArticle(html);

    expect(title).toBe("H1 Title");
  });

  it("strips script and style tags", () => {
    const html = `<html><body><article><p>content</p><script>alert(1)</script><style>.x{}</style></article></body></html>`;
    const { articleHtml } = extractArticle(html);

    expect(articleHtml).not.toContain("script");
    expect(articleHtml).not.toContain("style");
    expect(articleHtml).toContain("content");
  });
});

describe("htmlToLexical", () => {
  it("converts paragraphs", () => {
    const html = `<html><body><p>Hello world</p></body></html>`;
    const { lexicalContent } = htmlToLexical(html);
    const root = (lexicalContent as any).root;

    expect(root.children).toHaveLength(1);
    expect(root.children[0].type).toBe("paragraph");
    expect(root.children[0].children[0].text).toBe("Hello world");
  });

  it("converts headings", () => {
    const html = `<html><body><h2>Section Title</h2><p>body text</p></body></html>`;
    const { lexicalContent } = htmlToLexical(html);
    const root = (lexicalContent as any).root;

    expect(root.children[0].type).toBe("heading");
    expect(root.children[0].tag).toBe("h2");
    expect(root.children[0].children[0].text).toBe("Section Title");
  });

  it("converts links", () => {
    const html = `<html><body><p><a href="https://example.com">click here</a></p></body></html>`;
    const { lexicalContent } = htmlToLexical(html);
    const root = (lexicalContent as any).root;
    const link = root.children[0].children[0];

    expect(link.type).toBe("link");
    expect(link.fields.url).toBe("https://example.com");
    expect(link.children[0].text).toBe("click here");
  });

  it("converts bold and italic formatting", () => {
    const html = `<html><body><p><strong>bold</strong> and <em>italic</em></p></body></html>`;
    const { lexicalContent } = htmlToLexical(html);
    const root = (lexicalContent as any).root;
    const children = root.children[0].children;

    expect(children[0].format).toBe(1);
    expect(children[2].format).toBe(2);
  });

  it("converts unordered lists", () => {
    const html = `<html><body><ul><li>one</li><li>two</li></ul></body></html>`;
    const { lexicalContent } = htmlToLexical(html);
    const root = (lexicalContent as any).root;

    expect(root.children[0].type).toBe("list");
    expect(root.children[0].listType).toBe("bullet");
    expect(root.children[0].children).toHaveLength(2);
  });

  it("converts ordered lists", () => {
    const html = `<html><body><ol><li>first</li><li>second</li></ol></body></html>`;
    const { lexicalContent } = htmlToLexical(html);
    const root = (lexicalContent as any).root;

    expect(root.children[0].listType).toBe("number");
  });

  it("converts blockquotes", () => {
    const html = `<html><body><blockquote>quoted text</blockquote></body></html>`;
    const { lexicalContent } = htmlToLexical(html);
    const root = (lexicalContent as any).root;

    expect(root.children[0].type).toBe("quote");
  });

  it("converts horizontal rules", () => {
    const html = `<html><body><hr></body></html>`;
    const { lexicalContent } = htmlToLexical(html);
    const root = (lexicalContent as any).root;

    expect(root.children[0].type).toBe("horizontalrule");
  });

  it("gives no node and no title for a page without text, and writes no placeholder words", () => {
    const html = `<html><body><article><img src="/a.png"><iframe src="/b"></iframe></article></body></html>`;
    const { title, lexicalContent } = htmlToLexical(html);

    expect(title).toBe("");
    expect((lexicalContent as any).root.children).toEqual([]);
  });

  it("reads a relative link against the page, and keeps the text of a link without an address", () => {
    const html = `<html><body><p>See <a href="/docs/setup">setup</a>, <a href="../guide">guide</a>, <a href="https://x.io/a">x</a> and <a>plain</a>.</p></body></html>`;
    const { lexicalContent } = htmlToLexical(html, "https://blog.other.com/posts/one");
    const children = (lexicalContent as any).root.children[0].children;
    const urls = children
      .filter((node: any) => node.type === "link")
      .map((node: any) => node.fields.url);

    expect(urls).toEqual([
      "https://blog.other.com/docs/setup",
      "https://blog.other.com/guide",
      "https://x.io/a",
    ]);
    expect(JSON.stringify(children)).toContain("plain");
    expect(JSON.stringify(children)).not.toContain('"#"');
  });

  it("keeps the text of a link whose target is not a usable URL, without the link", () => {
    const html = `<html><body><p>Run <a href="javascript:alert(1)">this</a> now.</p></body></html>`;
    const { lexicalContent } = htmlToLexical(html);
    const children = (lexicalContent as any).root.children[0].children;

    expect(children.some((node: any) => node.type === "link")).toBe(false);
    expect(JSON.stringify(children)).toContain("this");
    expect(JSON.stringify(children)).not.toContain("javascript");
  });
});
