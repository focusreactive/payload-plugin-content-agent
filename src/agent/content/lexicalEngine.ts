import type { SanitizedConfig } from "payload";
import { isRecord, isRichTextState } from "../../borders.js";
import { editorConfigOf, nodeTypesOf } from "../../schema/editorNodes.js";
import type { SchemaField } from "../../types.js";
import { UNSPACED_SCRIPT } from "../../words.js";
import { inlineMarkupError } from "./editorFit.js";
import { isUsableLinkUrl, opensInNewTab, unusableLinkError } from "./linkUrl.js";

/** A Lexical node read from a document. Projects add node types, so only the shape is known. */
export type LexicalNode = Record<string, unknown>;

export interface TextNode extends LexicalNode {
  type: "text";
  text: string;
}

interface InlineLinkNode extends LexicalNode {
  type: "link";
  children: TextNode[];
}

export type InlineNode = TextNode | InlineLinkNode;

const isTextNode = (node: LexicalNode): node is TextNode =>
  node.type === "text" && typeof node.text === "string";

const INLINE_TYPES = new Set(["text", "link", "autolink", "linebreak", "tab", "inlineBlock"]);

export const isInlineChild = (node: unknown): node is LexicalNode =>
  isRecord(node) && typeof node.type === "string" && INLINE_TYPES.has(node.type);

export const rootOf = (content: unknown): unknown =>
  isRecord(content) ? (content.root ?? content) : content;

const BUILTIN_TYPES = new Set(["root", "paragraph", "text", "linebreak", "tab"]);

/** Visits the root of every rich text value nested in the value, without going into it. */
export function eachNestedRoot(value: unknown, visit: (root: unknown) => void): void {
  if (Array.isArray(value)) return value.forEach((entry: unknown) => eachNestedRoot(entry, visit));
  if (!isRecord(value)) return;
  if (value.root && typeof value.root === "object") return visit(value.root);
  for (const val of Object.values(value)) eachNestedRoot(val, visit);
}

// Block `fields` hold application data with its own `type` keys (a link group): eachNestedRoot only
// searches them for nested rich text and never counts them as nodes.
export function censusTypes(content: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (type: string) => counts.set(type, (counts.get(type) ?? 0) + 1);

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isRecord(node)) return;
    if (typeof node.type === "string") bump(node.type);
    if (Array.isArray(node.children)) node.children.forEach(walk);
    if (node.fields && typeof node.fields === "object") eachNestedRoot(node.fields, walk);
  };

  walk(rootOf(content));

  return counts;
}

export function countNodes(content: unknown): number {
  let total = 0;

  for (const count of censusTypes(content).values()) total += count;

  return total;
}

export interface TextNodeRef {
  node: TextNode;
  linkTarget?: string;
  linkNode?: LexicalNode;
  block?: LexicalNode;
}

const INLINE_BLOCK_MARKER = "[block]";

export function inlineContext(
  block: unknown,
  node: unknown,
  width = 24
): { before: string; after: string } {
  let before = "";
  let after = "";
  let seen = false;

  const walk = (current: unknown): void => {
    if (Array.isArray(current)) return current.forEach(walk);
    if (!isRecord(current)) return;

    if (current === node) {
      seen = true;

      return;
    }

    if (current.type === "text" && typeof current.text === "string") {
      if (seen) after += current.text;
      else before += current.text;

      return;
    }

    if (current.type === "linebreak") {
      if (seen) after += "\n";
      else before += "\n";

      return;
    }

    if (current.type === "inlineBlock") {
      if (seen) after += INLINE_BLOCK_MARKER;
      else before += INLINE_BLOCK_MARKER;

      return;
    }

    if (Array.isArray(current.children))
      current.children.forEach((child: unknown) =>
        isInlineChild(child) ? walk(child) : undefined
      );
  };

  if (isRecord(block) && Array.isArray(block.children))
    block.children.forEach((child: unknown) => (isInlineChild(child) ? walk(child) : undefined));
  if (!seen) return { before: "", after: "" };

  return {
    before: before.length > width ? before.slice(-width) : before,
    after: after.length > width ? after.slice(0, width) : after,
  };
}

const WORD_EDGE = /[\p{L}\p{N}]/u;

export function isGluedBoundary(left: string, right: string): boolean {
  const last = [...left].at(-1);
  const [first] = [...right];

  if (!last || !first) return false;
  // Where words have no space between them, a link or a bold word touches its neighbours.
  if (UNSPACED_SCRIPT.test(last) || UNSPACED_SCRIPT.test(first)) return false;

  return WORD_EDGE.test(last) && WORD_EDGE.test(first);
}

export function gluedSides(
  text: string,
  ctx: { before: string; after: string }
): Array<"before" | "after"> {
  const out: Array<"before" | "after"> = [];

  if (isGluedBoundary(ctx.before, text)) out.push("before");
  if (isGluedBoundary(text, ctx.after)) out.push("after");

  return out;
}

export function collectTextNodes(content: unknown): TextNodeRef[] {
  const refs: TextNodeRef[] = [];

  type LinkCtx = { target?: string; node: LexicalNode };

  const walk = (node: unknown, link?: LinkCtx, block?: LexicalNode): void => {
    if (Array.isArray(node)) return node.forEach((child: unknown) => walk(child, link, block));
    if (!isRecord(node)) return;

    if (isTextNode(node)) {
      if (node.text.trim().length > 0)
        refs.push(
          link ? { node, linkTarget: link.target, linkNode: link.node, block } : { node, block }
        );

      return;
    }

    // A link's `fields` are its settings, not block data: do not search them for nested rich text.
    if (node.type === "link" || node.type === "autolink") {
      const linkFields = isRecord(node.fields) ? node.fields : {};
      const target =
        typeof linkFields.url === "string" && linkFields.url
          ? linkFields.url
          : typeof node.url === "string" && node.url
            ? node.url
            : linkFields.doc != null
              ? `document ${JSON.stringify(linkFields.doc)}`
              : undefined;

      if (Array.isArray(node.children))
        node.children.forEach((child: unknown) => walk(child, { target, node }, block));

      return;
    }

    if (Array.isArray(node.children))
      node.children.forEach((child: unknown) => walk(child, link, node));
    if (node.fields && typeof node.fields === "object")
      eachNestedRoot(node.fields, (root) => walk(root, link));
  };

  walk(rootOf(content));

  return refs;
}

const INLINE_MARKDOWN_RE = /\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+?)\*\*/gu;
const BLOCK_MARKDOWN_RE = /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)/u;

const TEXT_FORMAT_BOLD = 1;

function textNodeLike(template: LexicalNode | undefined, text: string, extraFormat = 0): TextNode {
  return {
    type: "text",
    detail: template?.detail ?? 0,
    format: (typeof template?.format === "number" ? template.format : 0) | extraFormat,
    mode: template?.mode ?? "normal",
    style: template?.style ?? "",
    text,
    version: template?.version ?? 1,
  };
}

function linkNodeFor(url: string, child: TextNode): InlineLinkNode {
  return {
    type: "link",
    fields: { url, newTab: opensInNewTab(url), linkType: "custom" },
    format: "",
    indent: 0,
    version: 3,
    children: [child],
  };
}

export function inlineNodesFromMarkdown(
  value: string,
  template: LexicalNode | undefined
): { nodes: InlineNode[]; links: number; bold: number; unusableUrl?: string } | null {
  INLINE_MARKDOWN_RE.lastIndex = 0;
  if (!INLINE_MARKDOWN_RE.test(value)) return null;
  INLINE_MARKDOWN_RE.lastIndex = 0;
  const nodes: InlineNode[] = [];
  let links = 0;
  let bold = 0;
  let last = 0;
  let unusableUrl: string | undefined;

  for (const match of value.matchAll(INLINE_MARKDOWN_RE)) {
    const start = match.index ?? 0;

    if (start > last) nodes.push(textNodeLike(template, value.slice(last, start)));

    if (match[1] !== undefined) {
      if (!isUsableLinkUrl(match[2])) unusableUrl ??= match[2];
      nodes.push(linkNodeFor(match[2], textNodeLike(template, match[1])));
      links += 1;
    } else {
      nodes.push(textNodeLike(template, match[3], TEXT_FORMAT_BOLD));
      bold += 1;
    }

    last = start + match[0].length;
  }

  if (last < value.length) nodes.push(textNodeLike(template, value.slice(last)));

  return { nodes, links, bold, ...(unusableUrl ? { unusableUrl } : {}) };
}

export const startsWithBlockMarkdown = (value: string): boolean => BLOCK_MARKDOWN_RE.test(value);

export function writeTextNode(
  block: unknown,
  node: TextNode,
  value: string,
  { label, field }: { label: string; field?: SchemaField }
): { error: string } | { node: TextNode; links: number; bold: number } {
  if (BLOCK_MARKDOWN_RE.test(value)) {
    return {
      error: `${label} starts with block markdown ("${value.trim().slice(0, 12)}…") - a heading, list item, quote or code fence cannot be created from inside a text segment; it would be stored as literal characters. Use the surgical mode of this field (viewRichText mode:"surgical") and insert or replace the node with that markdown.`,
    };
  }

  const conv = inlineNodesFromMarkdown(value, node);

  if (!conv) {
    node.text = value;

    return { node, links: 0, bold: 0 };
  }

  if (conv.unusableUrl) return { error: `${label}: ${unusableLinkError(conv.unusableUrl)}` };
  const misfit = inlineMarkupError(field, conv);

  if (misfit) return { error: `${label}: ${misfit}` };
  const siblings: unknown[] | undefined =
    isRecord(block) && Array.isArray(block.children) ? block.children : undefined;
  const at = siblings ? siblings.indexOf(node) : -1;

  if (!siblings || at < 0) {
    return {
      error: `${label} contains inline markdown but is itself the text of a link (or a nested inline node). Change its words only, and put new links in the surrounding plain segments instead. The destination of an existing link is changed with readDocumentText + applyDocumentText({ token, links }).`,
    };
  }

  siblings.splice(at, 1, ...conv.nodes);
  const head = conv.nodes[0];
  const first =
    conv.nodes.find((candidate) => candidate.type === "text") ??
    (head?.type === "link" ? head.children[0] : undefined) ??
    node;

  return { node: first, links: conv.links, bold: conv.bold };
}

export function isEmptyRichText(value: unknown): boolean {
  const root = rootOf(value);

  if (!root || typeof root !== "object") return true;
  let hasContent = false;

  const walk = (node: unknown): void => {
    if (hasContent) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isRecord(node)) return;
    const type = node.type;

    if (type && type !== "root" && type !== "paragraph" && type !== "text") {
      hasContent = true;

      return;
    }

    if (type === "text" && typeof node.text === "string" && node.text.trim().length > 0) {
      hasContent = true;

      return;
    }

    if (Array.isArray(node.children)) node.children.forEach(walk);
  };

  walk(root);

  return !hasContent;
}

export type ValidateResult =
  | { ok: true; validated: boolean; note?: string }
  | { ok: false; reason: string };

type EditorConfig = Parameters<
  typeof import("@payloadcms/richtext-lexical").getEnabledNodes
>[0]["editorConfig"];

/** Parses the content with the nodes of the field's own editor, else of the site default. */
export async function validateLexical(
  content: unknown,
  config?: SanitizedConfig,
  field?: SchemaField
): Promise<ValidateResult> {
  if (!isRecord(content) || !content.root) return { ok: false, reason: "missing root" };
  const own = editorConfigOf(field) as EditorConfig | undefined;

  if (!config && !own)
    return { ok: true, validated: false, note: "no config - relied on pure splice" };

  try {
    const [server, headless] = await Promise.all([
      import("@payloadcms/richtext-lexical"),
      import("@payloadcms/richtext-lexical/lexical/headless"),
    ]);
    const editorConfig =
      own ?? (await server.editorConfigFactory.fromFeatures({ config: config! }));
    const nodes = server.getEnabledNodes({ editorConfig });
    const enabled = new Set<string>(nodes.flatMap(nodeTypesOf));

    const present = [...censusTypes(content).keys()].filter((type) => !BUILTIN_TYPES.has(type));
    const unknown = present.filter((type) => !enabled.has(type));

    if (unknown.length) {
      return {
        ok: true,
        validated: false,
        note: `types not in registry, skipped strict parse: ${unknown.join(", ")}`,
      };
    }

    if (!isRichTextState(content)) throw new Error("root has no children array");
    const editor = headless.createHeadlessEditor({
      nodes,
      onError: (error: Error) => {
        throw error;
      },
    });

    editor.setEditorState(editor.parseEditorState(content));

    return { ok: true, validated: true };
  } catch (error) {
    return {
      ok: false,
      reason: `invalid Lexical: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
