import {
  shiftedEntryError,
  duplicateAfterInsert,
  neighbourOverlapError,
  SHRINK_RATIO,
} from "../guards.js";
import { collectLinksInRichText } from "../links.js";
import { isObjectLike } from "../discovery.js";
import { isRecord } from "../../../borders.js";
import { applySurgicalEdits, viewedAsText } from "../../subAgents/lexicalMarkdown.js";
import type { SurgicalEdit } from "../../subAgents/lexicalMarkdown.js";
import { extractText } from "../../subAgents/programmaticOps.js";
import { censusTypes, collectTextNodes, isInlineChild, writeTextNode } from "../lexicalEngine.js";
import { blankSegment } from "./blankSegment.js";
import type { TextNode } from "../lexicalEngine.js";
import { keepSpacesOutOfLinks } from "../linkEdges.js";
import { unusableLinkError, unusableMarkdownLink } from "../linkUrl.js";
import { topLevelNodes } from "./context.js";
import type { RichTextToolsContext } from "./context.js";
import { EDITOR_ADVICE } from "../editAdvice.js";
import type { EditAdvice } from "../editAdvice.js";

// One edit per node: applySurgicalEdits applies by original index in reverse order, and two edits
// on one index would clobber the neighbouring node.
function repeatedIndexError(edits: SurgicalEdit[]): string | null {
  const indices = edits.map((edit) => parseInt(edit.key, 10));

  for (let i = 0; i < indices.length; i++) {
    if (!Number.isNaN(indices[i]) && indices.indexOf(indices[i]) !== i) {
      return `Two edits target the same node index [${indices[i]}] - apply one edit per node (re-view for current indices and batch distinct ones). Overlapping edits would corrupt adjacent nodes.`;
    }
  }

  return null;
}

const HTML_TAG_RE =
  /<\/?(?:ul|ol|li|p|div|span|h[1-6]|br|hr|strong|em|b|i|u|a|table|thead|tbody|tr|td|th|img|blockquote|section|article|figure|figcaption|pre|code)\b[^>]*>/iu;

function stripCodeSpans(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/gu, "").replace(/`[^`]*`/gu, "");
}

export function htmlMarkupError(label: string, value: string): string | null {
  const found = stripCodeSpans(value).match(HTML_TAG_RE);

  if (!found) return null;

  return (
    `${label} contains HTML markup (${found[0]}) - this field takes MARKDOWN, not HTML. ` +
    "HTML is not parsed: every tag would be stored and rendered as literal text. " +
    'Rewrite it in markdown ("- item" for a list, "**bold**", "## heading", "[text](url)"). ' +
    "To write about HTML on purpose, wrap the tags in backticks."
  );
}

function markdownPlainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/(\*\*|__|~~|`)/gu, "")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gmu, "")
    .trim();
}

function editShapeError(edit: SurgicalEdit): string | null {
  const destructive = edit.action === "replace" || edit.action === "remove";

  if (destructive && !edit.expectedText && !edit.expectedType) {
    return `"${edit.action}" requires an anchor: expectedText (a distinctive snippet of the node's current text) or expectedType (its node type, e.g. "upload"/"block") - so it cannot hit the wrong node.`;
  }

  // An empty markdown splices in zero nodes, which deletes the node.
  if (
    (edit.action === "replace" ||
      edit.action === "insertAfter" ||
      edit.action === "insertBefore") &&
    !(typeof edit.markdown === "string" && edit.markdown.trim().length > 0)
  ) {
    return `"${edit.action}" requires non-empty "markdown" (the new content). To delete a node, use the "remove" action instead of an empty replace.`;
  }

  if (typeof edit.markdown === "string" && edit.markdown.length > 0) {
    const htmlErr = htmlMarkupError(`Edit [${edit.key}] "markdown"`, edit.markdown);

    if (htmlErr) return htmlErr;
    const unusable = unusableMarkdownLink(edit.markdown);

    if (unusable) return `Edit [${edit.key}]: ${unusableLinkError(unusable)}`;
  }

  return null;
}

const ANCHOR_HINT_CHARS = 200;

// The view is Markdown, so a snippet copied from it can carry link and emphasis syntax.
function anchorHolder(snippet: string): (node: unknown) => boolean {
  const plain = markdownPlainText(snippet);

  return (node) => {
    const text = extractText(node);

    return text.includes(snippet) || (plain.length > 0 && text.includes(plain));
  };
}

function expectedTextError(
  children: unknown[],
  edit: SurgicalEdit,
  idx: number,
  node: unknown
): string | null {
  if (!edit.expectedText) return null;
  const snippet = edit.expectedText;
  const holds = anchorHolder(snippet);
  const matches = children.filter(holds).length;

  if (matches === 0) {
    const current = extractText(node ?? {}).trim();

    return current
      ? `expectedText ${JSON.stringify(snippet)} not found in any node. Node [${edit.key}] reads ${JSON.stringify(current.slice(0, ANCHOR_HINT_CHARS))} as plain text - if that is the node you mean, send a distinctive part of this plain text as expectedText (no markdown syntax); if not, re-view for the current indices.`
      : `expectedText ${JSON.stringify(snippet)} not found - the content changed since you viewed it. Re-view and retry.`;
  }

  if (matches > 1)
    return `expectedText ${JSON.stringify(snippet)} matches ${matches} nodes - ambiguous. Include more distinctive surrounding text so exactly one node matches.`;

  if (!holds(node ?? {})) {
    return `node [${edit.key}] does not contain the expected text - the index is wrong (the view shifted). Re-view and use the correct index. Refusing to avoid editing the wrong node.`;
  }

  return null;
}

// Every paragraph matches the type "paragraph": a node the view shows with its text is anchored
// by that text.
function typeOnlyError(edit: SurgicalEdit, node: unknown): string | null {
  if (edit.action !== "replace" && edit.action !== "remove") return null;
  if (edit.expectedText || !viewedAsText(node)) return null;
  const current = extractText(node ?? {}).trim();

  if (!current) return null;

  return `node [${edit.key}] holds text, so "${edit.action}" needs expectedText: a distinctive part of its current text (it reads ${JSON.stringify(current.slice(0, ANCHOR_HINT_CHARS))} as plain text). expectedType alone anchors only a node that the view shows without its text. Nothing was changed.`;
}

/** The parts of a node that the view shows on lines of their own, such as the items of a list. */
const textEntries = (node: unknown): unknown[] =>
  isRecord(node) && Array.isArray(node.children)
    ? node.children.filter((child) => !isInlineChild(child) && extractText(child).trim())
    : [];

// A remove takes the whole node: an anchor in one entry must not take the other entries with it.
function partialRemoveError(edit: SurgicalEdit, node: unknown): string | null {
  if (edit.action !== "remove" || !edit.expectedText || edit.expectedType) return null;
  const entries = textEntries(node);
  const holding = entries.filter(anchorHolder(edit.expectedText)).length;

  if (entries.length < 2 || holding === entries.length) return null;
  const type = isObjectLike(node) ? String(node.type) : "node";

  return `node [${edit.key}] is a ${type} of ${entries.length} entries and expectedText is in ${holding} of them, but "remove" deletes the whole node with every entry. Nothing was changed. To remove only the entry that holds this text: applyRichText({ ref, mode: "transform", removeText: "<the exact text of that entry>" }). To remove the whole ${type} with all its entries: send this remove again with expectedType: "${type}" next to expectedText.`;
}

function verifyEdit(children: unknown[], edit: SurgicalEdit): string | null {
  const idx = parseInt(edit.key, 10);

  // applySurgicalEdits silently drops out-of-range edits, so the bounds are checked here for
  // every action.
  if (Number.isNaN(idx) || idx < 0 || idx >= children.length) {
    return `Edit key "${edit.key}" is not a valid node index (valid: 0..${children.length - 1}). Re-view in surgical mode - to APPEND, use insertAfter on the LAST index (${children.length - 1}).`;
  }

  const node = children[idx];
  const nodeType = isObjectLike(node) ? node.type : undefined;
  const shapeError = editShapeError(edit);

  if (shapeError) return shapeError;
  const textError = expectedTextError(children, edit, idx, node);

  if (textError) return textError;

  if (edit.expectedType && (!node || nodeType !== edit.expectedType)) {
    return `node [${edit.key}] is "${nodeType ?? "missing"}", expected "${edit.expectedType}" - the index is wrong. Re-view. Refusing to avoid editing the wrong node.`;
  }

  return typeOnlyError(edit, node) ?? partialRemoveError(edit, node);
}

function verifyAnchors(content: unknown, edits: SurgicalEdit[]): string | null {
  const children = topLevelNodes(content);
  const badKey = edits.find((edit) => !/^\d+$/u.test(edit.key));

  if (badKey)
    return `Edit key "${badKey.key}" is not a node index: \`key\` is the whole number in brackets before a node of the surgical view, with no other character (valid: 0..${children.length - 1}).`;
  const repeated = repeatedIndexError(edits);

  if (repeated) return repeated;

  for (const edit of edits) {
    const editError = verifyEdit(children, edit);

    if (editError) return editError;
  }

  return null;
}

// A plain text field can hold HTML on purpose (an embed, a snippet): only a field with no tag
// before the write is guarded.
export function plainHtmlError(label: string, before: string, value: string): string | null {
  if (HTML_TAG_RE.test(stripCodeSpans(before))) return null;
  const found = stripCodeSpans(value).match(HTML_TAG_RE);

  return found
    ? `${label} adds HTML markup (${found[0]}) to a plain text field that holds none: the tag would show on the page as literal characters. Nothing was written. Send the text without tags.`
    : null;
}

const REPLACE_SHRINK_MIN_CHARS = 120;

const MARKDOWN_SAFE = new Set([
  "root",
  "paragraph",
  "heading",
  "text",
  "list",
  "listitem",
  "quote",
  "link",
  "linebreak",
  "tab",
]);

function droppedStructural(
  before: unknown,
  after: unknown,
  allowedByType: Map<string, number>
): string | null {
  const beforeCensus = censusTypes(before);
  const afterCensus = censusTypes(after);

  for (const [type, count] of beforeCensus) {
    const dropped = count - (afterCensus.get(type) ?? 0);

    if (!MARKDOWN_SAFE.has(type) && dropped > (allowedByType.get(type) ?? 0)) return type;
  }

  return null;
}

function shrinkingReplaceError(
  content: Record<string, unknown>,
  edits: SurgicalEdit[],
  ratio: number,
  advice: EditAdvice
): string | null {
  for (const edit of edits) {
    if (edit.action !== "replace" || typeof edit.markdown !== "string") continue;
    const before = extractText(topLevelNodes(content)[parseInt(edit.key, 10)] ?? {});
    const after = markdownPlainText(edit.markdown);

    if (before.length >= REPLACE_SHRINK_MIN_CHARS && after.length < before.length * ratio) {
      return (
        `Edit [${edit.key}] "replace" would shrink this node from ${before.length} to ${after.length} characters - that is content lost, not edited. ` +
        `A replace carries the WHOLE node with your change in it. To add a link or change one phrase inside a long paragraph, ${advice.onePhrase} ` +
        advice.shorterPart
      );
    }
  }

  return null;
}

function droppedLinksError(
  content: Record<string, unknown>,
  edits: SurgicalEdit[],
  advice: EditAdvice
): string | null {
  for (const edit of edits) {
    if (edit.action !== "replace" || typeof edit.markdown !== "string") continue;
    const node = topLevelNodes(content)[parseInt(edit.key, 10)];
    const had = collectLinksInRichText(node, "node")
      .map((link) => link.url)
      .filter((url): url is string => !!url);

    if (!had.length) continue;
    const kept = new Set(
      [...edit.markdown.matchAll(/\]\(\s*(<[^>]*>|[^\s)]+)/gu)].map((match) =>
        match[1].replace(/^<|>$/gu, "")
      )
    );
    const dropped = had.filter((url) => !kept.has(url));

    if (dropped.length) {
      return (
        `Edit [${edit.key}] "replace" would drop ${dropped.length} link(s) this node has (${dropped.map((url) => `"${url}"`).join(", ")}). ` +
        `A replace swaps the WHOLE node for your markdown, so the node's other sentences and their links must be in it. ` +
        `To change one phrase inside a long node, ${advice.onePhrase} ` +
        advice.removedLinks
      );
    }
  }

  return null;
}

function guardError(
  content: Record<string, unknown>,
  edits: SurgicalEdit[],
  guards: RichTextToolsContext["guards"]
): string | null {
  const advice = guards?.advice ?? EDITOR_ADVICE;
  const anchorError = verifyAnchors(content, edits);

  if (anchorError) return anchorError;
  const ratio = guards?.shrinkRatio ? guards.shrinkRatio() : SHRINK_RATIO;
  const shrink = ratio === null ? null : shrinkingReplaceError(content, edits, ratio, advice);

  if (shrink) return shrink;

  return guards?.linkIntent?.() === "fewer" ? null : droppedLinksError(content, edits, advice);
}

export async function applySurgical(
  { workspace, guards }: RichTextToolsContext,
  content: Record<string, unknown>,
  edits: SurgicalEdit[] | undefined
): Promise<{ updated: unknown } | { error: string }> {
  if (!edits?.length)
    return {
      error:
        'Surgical mode needs `edits`: at least one { key, action, markdown } with `key` a node index from viewRichText(mode:"surgical").',
    };
  const refused = guardError(content, edits, guards);

  if (refused) return { error: refused };

  const updated: unknown = await applySurgicalEdits(content, edits);
  const inserted = edits
    .filter(
      (edit) =>
        (edit.action === "insertAfter" || edit.action === "insertBefore") &&
        typeof edit.markdown === "string"
    )
    .map((edit) => edit.markdown as string);
  const dup = inserted.length
    ? duplicateAfterInsert(workspace.ref.current, content, updated, inserted)
    : null;

  if (dup)
    return {
      error: `Not inserted: this batch would leave the same text twice in the document ("${dup.slice(0, 80)}…"). It is already there - do not add it again.`,
    };
  const removedBudget = new Map<string, number>();

  for (const edit of edits) {
    if (edit.action === "remove" && edit.expectedType) {
      removedBudget.set(edit.expectedType, (removedBudget.get(edit.expectedType) ?? 0) + 1);
    }
  }

  const lost = droppedStructural(content, updated, removedBudget);

  if (lost) {
    return {
      error: `Edit would drop a "${lost}" node - a surgical replace cannot carry blocks/uploads/relationships. Edit the prose around it, or remove it explicitly with a remove action anchored by expectedType:"${lost}".`,
    };
  }

  return { updated };
}

const whiteSpaceOnlyError = (i: number): string =>
  `segment ${i} would keep only white space, so its words would be removed by the index alone, and an index that is off by one removes the wrong text. Nothing was written. To remove text, name it: applyRichText({ ref, mode: "transform", removeText: "<the exact text to remove>" }).`;

/** A segment that holds the text of a neighbour or of another segment: the indices moved. */
function misplacedSegmentError(
  nodes: ReturnType<typeof collectTextNodes>,
  originals: string[],
  i: number,
  value: string
): string | null {
  const sameBlock = (j: number) => j >= 0 && j < nodes.length && nodes[j].block === nodes[i].block;

  return (
    neighbourOverlapError(`Segment ${i}`, originals[i], value, {
      prev: sameBlock(i - 1) ? originals[i - 1] : undefined,
      next: sameBlock(i + 1) ? originals[i + 1] : undefined,
    }) ??
    shiftedEntryError(
      `Segment ${i}`,
      originals[i],
      value,
      originals.map((text, j) => ({ n: j, text })).filter((other) => other.n !== i)
    )
  );
}

export function applyTransform(
  content: Record<string, unknown>,
  segments: Record<string, string> | undefined,
  nodeCount: number | undefined
):
  | { updated: Record<string, unknown>; refs: TextNode[]; applied: number; linksCreated: number }
  | { error: string } {
  if (!segments || typeof segments !== "object") {
    return {
      error:
        'Nothing was written: mode "transform" needs `segments`, a map { "<index>": "<new text>" } with the indices of viewRichText(mode:"transform"), or `removeText`, or `fixGlued: true`.',
    };
  }

  for (const [key, value] of Object.entries(segments)) {
    if (typeof value !== "string") continue;
    const htmlErr = htmlMarkupError(`Segment "${key}"`, value);

    if (htmlErr) return { error: htmlErr };
  }

  const updated = structuredClone(content);
  let linksCreated = 0;
  let applied = 0;
  const nodes = collectTextNodes(updated);
  const refs = nodes.map((nodeRef) => nodeRef.node);
  // Captured before the writes: a neighbour already rewritten in this call would hide the copy.
  const originals = refs.map((textNode) => textNode.text);

  if (typeof nodeCount === "number" && nodeCount !== refs.length) {
    return {
      error: `The field changed since the transform view was taken (expected ${nodeCount} text segment(s), found ${refs.length}) - re-view in transform mode and retry.`,
    };
  }

  const planned = keepSpacesOutOfLinks(
    segments,
    nodes.map((nodeRef, i) => ({
      text: originals[i],
      link: Boolean(nodeRef.linkNode),
      group: nodeRef.block,
    }))
  );

  for (const [key, value] of Object.entries(planned)) {
    const i = Number(key);

    if (!Number.isInteger(i) || i < 0 || i >= refs.length) {
      return {
        error: `segment index "${key}" is out of range (0..${refs.length - 1}). Re-view in transform mode for the current segments.`,
      };
    }

    if (typeof value === "string" && value.length > 0 && !value.trim())
      return { error: whiteSpaceOnlyError(i) };
    const blank = blankSegment(
      { content: updated, nodes, textOf: (other) => planned[other] ?? originals[other] },
      i,
      value
    );

    if (blank === "refused")
      return {
        error: `segment ${i} is empty, and it is the only text of its paragraph or heading, the only item of its list, or the text of a link - transform must not blank those. To delete that whole paragraph, heading or list, use a surgical remove of its node, or trimRichText for a heading and everything after it.`,
      };

    if (blank === "removed") {
      applied++;
      continue;
    }

    const misplaced = misplacedSegmentError(nodes, originals, i, value);

    if (misplaced) return { error: misplaced };
    const written = writeTextNode(nodes[i].block, refs[i], value, { label: `Segment ${i}` });

    if ("error" in written) return { error: written.error };
    linksCreated += written.links;
    applied++;
  }

  if (applied === 0)
    return {
      error:
        'Nothing was written: `segments` is empty. Send { "<index>": "<new text>" } with the indices of viewRichText(mode:"transform"), or `removeText`, or `fixGlued: true`.',
    };

  return { updated, refs, applied, linksCreated };
}
