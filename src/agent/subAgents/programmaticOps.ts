import { isRecord } from "../../borders.js";

export function extractText(node: unknown): string {
  if (!isRecord(node)) return "";
  if (typeof node.text === "string" && node.text) return node.text;
  if (Array.isArray(node.children)) return node.children.map(extractText).join("");

  return "";
}

/** The text of each top-level heading, in order. */
export function topLevelHeadings(content: unknown): string[] {
  const root = isRecord(content) ? content.root : undefined;
  const children: unknown[] = isRecord(root) && Array.isArray(root.children) ? root.children : [];

  return children
    .filter((node) => isRecord(node) && node.type === "heading")
    .map((node) => extractText(node).trim());
}

export function trimAfterHeading(
  content: unknown,
  headingText: string
): { content: unknown; removedCount: number; matches?: number } {
  const root = isRecord(content) ? content.root : undefined;

  if (!isRecord(content) || !isRecord(root)) return { content, removedCount: 0 };
  const children: unknown[] = Array.isArray(root.children) ? root.children : [];
  const normalizedTarget = headingText.trim().toLowerCase();

  const matchingIndices = children.reduce<number[]>((acc, node, i) => {
    if (
      isRecord(node) &&
      node.type === "heading" &&
      extractText(node).trim().toLowerCase() === normalizedTarget
    )
      acc.push(i);

    return acc;
  }, []);

  if (matchingIndices.length === 0) {
    return { content, removedCount: 0 };
  }

  if (matchingIndices.length > 1) {
    return { content, removedCount: 0, matches: matchingIndices.length };
  }

  const headingIndex = matchingIndices[0];
  const removedCount = children.length - headingIndex;
  const newChildren = children.slice(0, headingIndex);

  return {
    content: {
      ...content,
      root: {
        ...root,
        children: newChildren,
      },
    },
    removedCount,
  };
}

export function replaceTextInLexical(
  content: unknown,
  find: string,
  replace: string
): { content: unknown; count: number } {
  if (!find) return { content, count: 0 };
  let count = 0;

  const sub = (text: string): string => {
    count += text.split(find).length - 1;

    return text.split(find).join(replace);
  };

  // Link nodes only: a block's own `url` field is edited as a separate leaf.
  const LINK_TYPES = new Set(["link", "autolink"]);

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);

    if (isRecord(node)) {
      const out: Record<string, unknown> = { ...node };

      if (typeof out.text === "string" && out.text.includes(find)) out.text = sub(out.text);

      if (typeof out.type === "string" && LINK_TYPES.has(out.type)) {
        if (typeof out.url === "string" && out.url.includes(find)) out.url = sub(out.url);

        if (
          isRecord(out.fields) &&
          typeof out.fields.url === "string" &&
          out.fields.url.includes(find)
        ) {
          out.fields = { ...out.fields, url: sub(out.fields.url) };
        }
      }

      if (Array.isArray(out.children)) out.children = out.children.map(walk);

      return out;
    }

    return node;
  };

  if (!isRecord(content) || !content.root) return { content, count: 0 };

  return { content: { ...content, root: walk(content.root) }, count };
}
