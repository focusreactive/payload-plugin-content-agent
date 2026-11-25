import { parseHTML } from "linkedom";
import { isUsableLinkUrl, opensInNewTab } from "../content/linkUrl.js";

interface ImportedTextNode {
  type: "text";
  version: number;
  text: string;
  format: number;
  detail: number;
  mode: string;
  style: string;
}

interface ImportedElementNode {
  type:
    | "heading"
    | "paragraph"
    | "quote"
    | "list"
    | "listitem"
    | "link"
    | "linebreak"
    | "horizontalrule";
  [key: string]: unknown;
}

type ImportedNode = ImportedTextNode | ImportedElementNode;

interface InlineParent {
  childNodes: Iterable<Node>;
}

const isElement = (node: Node): node is Element => node.nodeType === 1;

function articleTitle(document: Document): string {
  return (
    document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    document.querySelector("h1")?.textContent?.trim() ||
    document.querySelector("title")?.textContent?.trim() ||
    ""
  );
}

function articleExcerpt(document: Document): string {
  return (
    document.querySelector('meta[name="description"]')?.getAttribute("content") ||
    document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
    ""
  );
}

function articleRoot(document: Document): Element {
  return (
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector('[class*="post-content"]') ||
    document.querySelector('[class*="article-content"]') ||
    document.querySelector('[class*="entry-content"]') ||
    document.querySelector('[class*="prose"]') ||
    document.body
  );
}

export function extractArticle(html: string): {
  title: string;
  excerpt: string;
  articleHtml: string;
} {
  const { document } = parseHTML(html);

  const title = articleTitle(document);

  const excerpt = articleExcerpt(document);

  const article = articleRoot(document);

  if (article) {
    for (const sel of [
      "script",
      "style",
      "nav",
      "footer",
      "aside",
      "iframe",
      "noscript",
      "svg",
      "header",
      "form",
    ]) {
      article.querySelectorAll(sel).forEach((element) => element.remove());
    }
  }

  return { title, excerpt, articleHtml: article?.innerHTML || "" };
}

function textNode(text: string, format = 0): ImportedTextNode {
  return { type: "text", version: 1, text, format, detail: 0, mode: "normal", style: "" };
}

function makeParagraph(children: ImportedNode[]): ImportedElementNode {
  return {
    type: "paragraph",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    textFormat: 0,
    textStyle: "",
    children,
  };
}

function applyFormat(element: Element, format: number): ImportedNode[] {
  return processInline(element).map((node) =>
    node.type === "text" ? { ...node, format: node.format | format } : node
  );
}

/** A link without a usable target keeps its text. */
function anchorNodes(anchor: Element): ImportedNode[] {
  const href = anchor.getAttribute("href");
  const children = processInline(anchor);

  if (!href || !isUsableLinkUrl(href) || !children.length) return children;

  return [
    {
      type: "link",
      version: 3,
      direction: null,
      format: "",
      indent: 0,
      fields: { url: href, newTab: opensInNewTab(href), linkType: "custom" },
      children,
    },
  ];
}

function processInline(parent: InlineParent): ImportedNode[] {
  const nodes: ImportedNode[] = [];

  for (const child of parent.childNodes) {
    if (child.nodeType === 3) {
      const text = child.textContent || "";

      if (text.trim() || text.includes(" ")) nodes.push(textNode(text));
    } else if (isElement(child)) {
      const tag = child.tagName?.toLowerCase();

      if (tag === "a") {
        nodes.push(...anchorNodes(child));
      } else if (tag === "strong" || tag === "b") {
        nodes.push(...applyFormat(child, 1));
      } else if (tag === "em" || tag === "i") {
        nodes.push(...applyFormat(child, 2));
      } else if (tag === "code") {
        nodes.push(...applyFormat(child, 16));
      } else if (tag === "u") {
        nodes.push(...applyFormat(child, 8));
      } else if (tag === "s" || tag === "del") {
        nodes.push(...applyFormat(child, 4));
      } else if (tag === "br") {
        nodes.push({ type: "linebreak", version: 1 });
      } else {
        nodes.push(...processInline(child));
      }
    }
  }

  return nodes;
}

function processList(element: Element): ImportedElementNode | null {
  const listTag = element.tagName.toLowerCase();
  const items: ImportedElementNode[] = [];
  let nextValue = 1;

  element.querySelectorAll(":scope > li").forEach((listItem) => {
    const inline: ImportedNode[] = [];
    const nestedLists: ImportedElementNode[] = [];

    for (const child of listItem.childNodes) {
      const childTag = isElement(child) ? child.tagName?.toLowerCase() : null;

      if (isElement(child) && (childTag === "ul" || childTag === "ol")) {
        const sub = processList(child);

        if (sub) nestedLists.push(sub);
      } else if (child.nodeType === 3) {
        const text = child.textContent || "";

        if (text.trim() || text.includes(" ")) inline.push(textNode(text));
      } else if (isElement(child)) {
        inline.push(...processInline({ childNodes: [child] }));
      }
    }

    if (inline.length)
      items.push({
        type: "listitem",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        value: nextValue++,
        children: inline,
      });
    for (const sub of nestedLists)
      items.push({
        type: "listitem",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        value: nextValue++,
        children: [sub],
      });
  });
  if (!items.length) return null;

  return {
    type: "list",
    tag: listTag,
    listType: listTag === "ul" ? "bullet" : "number",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    start: 1,
    children: items,
  };
}

function headingNodes(element: Element, tag: string): ImportedNode[] {
  const nodes: ImportedNode[] = [];
  const inline = processInline(element);

  if (inline.length)
    nodes.push({
      type: "heading",
      tag,
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: inline,
    });

  return nodes;
}

function paragraphNodes(element: Element): ImportedNode[] {
  const nodes: ImportedNode[] = [];
  const inline = processInline(element);

  if (inline.length) nodes.push(makeParagraph(inline));

  return nodes;
}

function childBlockNodes(element: Element): ImportedNode[] {
  const nodes: ImportedNode[] = [];

  for (const child of element.childNodes) {
    if (isElement(child)) nodes.push(...processNode(child));
    else if (child.nodeType === 3) {
      const text = child.textContent?.trim();

      if (text) nodes.push(makeParagraph([textNode(text)]));
    }
  }

  return nodes;
}

function divNodes(element: Element): ImportedNode[] {
  if (
    element.querySelector("h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,div,article,section,table,hr")
  ) {
    return childBlockNodes(element);
  }

  return paragraphNodes(element);
}

function listNodes(element: Element): ImportedNode[] {
  const nodes: ImportedNode[] = [];
  const list = processList(element);

  if (list) nodes.push(list);

  return nodes;
}

function quoteNodes(element: Element): ImportedNode[] {
  const nodes: ImportedNode[] = [];
  const inline = processInline(element);

  if (inline.length)
    nodes.push({
      type: "quote",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: inline,
    });

  return nodes;
}

function preNodes(element: Element): ImportedNode[] {
  const nodes: ImportedNode[] = [];
  const text = element.textContent?.trim();

  if (text) {
    for (const line of text.split("\n")) {
      if (line.trim()) nodes.push(makeParagraph([textNode(line, 16)]));
    }
  }

  return nodes;
}

function processNode(element: Element): ImportedNode[] {
  const tag = element.tagName?.toLowerCase();

  if (!tag) return [];

  if (/^h[1-6]$/u.test(tag)) return headingNodes(element, tag);
  if (tag === "p") return paragraphNodes(element);
  if (tag === "div") return divNodes(element);
  if (tag === "ul" || tag === "ol") return listNodes(element);
  if (tag === "blockquote") return quoteNodes(element);
  if (tag === "pre") return preNodes(element);
  if (tag === "hr") return [{ type: "horizontalrule", version: 1 }];

  return childBlockNodes(element);
}

/** A link of the page opens what it opened there: a relative address is read against the page. */
function resolveLinks(document: Document, pageUrl: string | undefined): void {
  if (!pageUrl) return;

  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") ?? "";

    if (URL.canParse(href) || !URL.canParse(href, pageUrl)) continue;
    anchor.setAttribute("href", new URL(href, pageUrl).toString());
  }
}

/** The title is empty when the page names none, and the content has no node when it has no text. */
export function htmlToLexical(
  html: string,
  pageUrl?: string
): {
  title: string;
  excerpt: string;
  lexicalContent: object;
} {
  const { title, excerpt, articleHtml } = extractArticle(html);
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${articleHtml}</body></html>`);
  const children: ImportedNode[] = [];

  resolveLinks(document, pageUrl);

  for (const child of document.body.childNodes) {
    if (isElement(child)) children.push(...processNode(child));
    else if (child.nodeType === 3) {
      const text = child.textContent?.trim();

      if (text) children.push(makeParagraph([textNode(text)]));
    }
  }

  return {
    title,
    excerpt,
    lexicalContent: {
      root: {
        type: "root",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        children,
      },
    },
  };
}
