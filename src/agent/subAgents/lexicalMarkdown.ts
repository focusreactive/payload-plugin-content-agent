import type { TextMatchTransformer } from "@lexical/markdown";
import type { SerializedLexicalNode } from "lexical";
import { isRecord, isRichTextState } from "../../borders.js";
import type { RichTextNode } from "../../borders.js";
import { opensInNewTab } from "../content/linkUrl.js";

// Lexical is imported lazily: a static import breaks the host bundler.
let _lex: Lex | null = null;

// lexical 0.41 captures `[text](url)` as [full, text, url, title];
// 0.50 as [full, text, <url>, url, title].
// So the url is the first non-empty group after the text, not a fixed position.
export function linkUrlFromMatch(match: ArrayLike<string | null | undefined>): string {
  for (let i = 2; i < match.length; i += 1) {
    const group = match[i];

    if (typeof group === "string" && group.length > 0) return group;
  }

  const urlMatch = String(match[0] ?? "").match(/\]\(\s*<?([^\s>)]+)/u);

  return urlMatch ? urlMatch[1] : "";
}

async function loadLex() {
  const [headless, lexical, richText, list, overflow, markdown, payloadLink] = await Promise.all([
    import("@lexical/headless"),
    import("lexical"),
    import("@lexical/rich-text"),
    import("@lexical/list"),
    import("@lexical/overflow"),
    import("@lexical/markdown"),
    import("@payloadcms/richtext-lexical"),
  ]);

  // Payload's LinkNode stores `fields: { url, linkType, newTab }`, not a URL string.
  const PAYLOAD_LINK: TextMatchTransformer = {
    ...markdown.LINK,
    dependencies: [payloadLink.LinkNode],
    export: (node, exportChildren) => {
      if (!payloadLink.$isLinkNode(node)) return null;
      const fields = node.getFields();
      const url = fields?.url || "";
      const textContent = exportChildren(node);

      return `[${textContent}](${url})`;
    },
    replace: (textNode, match) => {
      const linkText = match[1];
      const linkUrl = linkUrlFromMatch(match);
      const linkNode = payloadLink.$createLinkNode({
        fields: { url: linkUrl, linkType: "custom", newTab: opensInNewTab(linkUrl) },
      });
      const lexicalTextNode = lexical.$createTextNode(linkText);

      linkNode.append(lexicalTextNode);
      textNode.replace(linkNode);
    },
  };

  const PAYLOAD_TRANSFORMERS = markdown.TRANSFORMERS.map((transformer) =>
    transformer === markdown.LINK ? PAYLOAD_LINK : transformer
  );

  return {
    createHeadlessEditor: headless.createHeadlessEditor,
    $getRoot: lexical.$getRoot,
    $createTextNode: lexical.$createTextNode,
    $convertToMarkdownString: markdown.$convertToMarkdownString,
    $convertFromMarkdownString: markdown.$convertFromMarkdownString,
    PAYLOAD_TRANSFORMERS,
    HeadingNode: richText.HeadingNode,
    QuoteNode: richText.QuoteNode,
    ListNode: list.ListNode,
    ListItemNode: list.ListItemNode,
    LinkNode: payloadLink.LinkNode,
    OverflowNode: overflow.OverflowNode,
  };
}

type Lex = Awaited<ReturnType<typeof loadLex>>;

async function getLex(): Promise<Lex> {
  _lex ??= await loadLex();

  return _lex;
}

function createEditor(lex: Lex) {
  return lex.createHeadlessEditor({
    nodes: [
      lex.HeadingNode,
      lex.QuoteNode,
      lex.ListNode,
      lex.ListItemNode,
      lex.LinkNode,
      lex.OverflowNode,
    ].filter(Boolean),
    onError: () => undefined,
  });
}

// Must not run inside another editor.read(): Lexical globals conflict.
function nodeJsonToMarkdown(lex: Lex, nodeJson: RichTextNode): string {
  const tempEditor = createEditor(lex);
  const tempState = tempEditor.parseEditorState({
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [nodeJson],
    },
  });

  tempEditor.setEditorState(tempState);

  let markdown = "";

  tempEditor.read(() => {
    markdown = lex.$convertToMarkdownString(lex.PAYLOAD_TRANSFORMERS);
  });

  return markdown.trim();
}

// Any other node type must not go through parseEditorState:
// an unregistered type gives an empty state, and setEditorState then throws.
const MD_RENDERABLE = new Set(["paragraph", "heading", "list", "quote"]);

// An internal link has no url, so the markdown round-trip drops its document reference.
function containsInternalLink(node: unknown): boolean {
  if (!isRecord(node)) return false;
  const fields = isRecord(node.fields) ? node.fields : undefined;

  if (
    (node.type === "link" || node.type === "autolink") &&
    fields?.linkType === "internal" &&
    !fields.url
  )
    return true;
  if (Array.isArray(node.children)) return node.children.some(containsInternalLink);

  return false;
}

function structuralPlaceholder(node: unknown): string {
  const type = (isRecord(node) ? node.type : undefined) ?? "unknown";
  const blockType = isRecord(node) && isRecord(node.fields) ? node.fields.blockType : undefined;

  return `<${type}${blockType ? `: ${blockType}` : ""}> (structural node - preserved as-is; target it with expectedType:"${type}")`;
}

function internalLinkPlaceholder(node: RichTextNode): string {
  return `<${node?.type ?? "node"}: contains an internal document link> (cannot be edited via surgical replace without losing the link - use expectedType:"${node?.type}" only to remove it, or applyRichText transform mode to change its surrounding text)`;
}

/** The surgical view shows this node as its markdown, not as a placeholder. */
export const viewedAsText = (node: unknown): boolean =>
  isRecord(node) &&
  typeof node.type === "string" &&
  MD_RENDERABLE.has(node.type) &&
  !containsInternalLink(node);

export async function keyedMarkdownView(content: unknown): Promise<string> {
  const children = isRichTextState(content) ? content.root.children : [];

  if (children.length === 0) return "";

  const lex = await getLex();

  const lines: string[] = [];

  for (let i = 0; i < children.length; i++) {
    const node = children[i];

    if (!MD_RENDERABLE.has(node?.type)) {
      lines.push(`[${i}] ${structuralPlaceholder(node)}`);
      continue;
    }

    if (containsInternalLink(node)) {
      lines.push(`[${i}] ${internalLinkPlaceholder(node)}`);
      continue;
    }

    try {
      lines.push(`[${i}] ${nodeJsonToMarkdown(lex, node)}`);
    } catch {
      lines.push(`[${i}] ${structuralPlaceholder(node)}`);
    }
  }

  return lines.join("\n");
}

async function markdownToNodes(lex: Lex, markdown: string): Promise<SerializedLexicalNode[]> {
  const editor = createEditor(lex);

  editor.update(
    () => {
      lex.$convertFromMarkdownString(markdown, lex.PAYLOAD_TRANSFORMERS);
    },
    { discrete: true }
  );

  const state = editor.getEditorState().toJSON();
  const nodes = state.root.children;

  // A transformer for an unregistered node throws inside editor.update;
  // Lexical rolls the update back and the result is an empty list, not an error.
  if (nodes.length === 0 && markdown.trim().length > 0) {
    throw new Error(
      `Could not convert markdown to Lexical nodes - the fragment may use unsupported syntax (e.g. fenced code blocks): ${markdown.slice(0, 100)}`
    );
  }

  return nodes;
}

export interface SurgicalEdit {
  key: string;
  action: "replace" | "remove" | "insertAfter" | "insertBefore";
  markdown?: string;
  expectedText?: string;
  expectedType?: string;
}

export async function applySurgicalEdits(
  content: unknown,
  edits: SurgicalEdit[]
): Promise<{ root: Record<string, unknown> }> {
  const lex = await getLex();

  const root = isRecord(content) ? content.root : undefined;

  if (!isRecord(root)) throw new TypeError("The rich text value has no root.");
  const children: unknown[] = Array.isArray(root.children) ? [...root.children] : [];

  const parsedNodes: Record<number, SerializedLexicalNode[]> = {};

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];

    if (edit.markdown && edit.action !== "remove") {
      parsedNodes[i] = await markdownToNodes(lex, edit.markdown);
    }
  }

  const sortedEdits = edits
    .map((edit, i) => ({ edit, editIndex: i, nodeIndex: parseInt(edit.key, 10) }))
    .filter(
      (entry) =>
        !isNaN(entry.nodeIndex) && entry.nodeIndex >= 0 && entry.nodeIndex < children.length
    )
    .sort((a, b) => b.nodeIndex - a.nodeIndex);

  for (const { edit, editIndex, nodeIndex } of sortedEdits) {
    const newNodes = parsedNodes[editIndex] || [];

    switch (edit.action) {
      case "remove":
        children.splice(nodeIndex, 1);
        break;
      case "replace":
        children.splice(nodeIndex, 1, ...newNodes);
        break;
      case "insertAfter":
        children.splice(nodeIndex + 1, 0, ...newNodes);
        break;
      case "insertBefore":
        children.splice(nodeIndex, 0, ...newNodes);
        break;
    }
  }

  // The spliced JSON is returned as is: the headless editor registers few node types
  // and drops every other one on re-serialization.
  return {
    root: { ...root, children },
  };
}
