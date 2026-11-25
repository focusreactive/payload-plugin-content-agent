import type { SchemaField } from "../../types.js";
import { isRecord } from "../../borders.js";
import { collectContentFields, getByPath, isObjectLike, parsePath, rowId } from "./discovery.js";
import { rootOf } from "./lexicalEngine.js";

const MAX_LINES = 12;
const EXCERPT = 60;

/** `block` numbers the paragraph, heading or list item that holds the segment. */
type Seg =
  | { kind: "text"; text: string; block: number }
  | { kind: "link"; url: string; text: string; block: number };

const isInline = (node: unknown): boolean =>
  isRecord(node) && (node.type === "text" || node.type === "link" || node.type === "autolink");

const BLOCK_MARK = " ¶ ";

/** The text as a person reads it: the mark stands where one block ends and the next starts. */
function readingText(list: Seg[]): string {
  let text = "";

  list.forEach((segment, i) => {
    if (i > 0 && segment.block !== list[i - 1].block) text += BLOCK_MARK;
    text += segment.text;
  });

  return text.replace(/\s+/gu, " ");
}

function linkedDocId(doc: unknown): unknown {
  const value = isObjectLike(doc) ? doc.value : undefined;
  const id = isObjectLike(value) ? value.id : undefined;

  return id ?? value ?? doc;
}

function anchor(node: unknown): string {
  if (!isObjectLike(node)) return "";
  if (node.type === "text") return typeof node.text === "string" ? node.text : "";

  return Array.isArray(node.children) ? node.children.map(anchor).join("") : "";
}

function segments(value: unknown): Seg[] {
  const out: Seg[] = [];
  let block = 0;

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isRecord(node)) return;

    if (node.type === "link" || node.type === "autolink") {
      const linkFields = isObjectLike(node.fields) ? node.fields : {};
      const url =
        typeof linkFields.url === "string"
          ? linkFields.url
          : linkFields.doc != null
            ? `document ${JSON.stringify(linkedDocId(linkFields.doc))}`
            : "";

      out.push({ kind: "link", url, text: anchor(node), block });

      return;
    }

    if (node.type === "text" && typeof node.text === "string") {
      out.push({ kind: "text", text: node.text, block });

      return;
    }

    if (Array.isArray(node.children)) {
      if (node.children.some(isInline)) block += 1;
      node.children.forEach(walk);
    }

    if (node.fields && typeof node.fields === "object")
      for (const fieldValue of Object.values(node.fields))
        if (isObjectLike(fieldValue) && fieldValue.root) walk(fieldValue.root);
  };

  walk(rootOf(value));

  return out;
}

const quote = (text: string, max = EXCERPT) =>
  `"${text.length > max ? `${text.slice(0, max)}…` : text}"`;

function focus(a: string, b: string): [string, string] {
  let start = 0;

  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;

  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const lead = Math.max(0, start - 20);
  const cut = (text: string, end: number) =>
    `${lead ? "…" : ""}${text.slice(lead, Math.min(text.length, end + 20))}${end + 20 < text.length ? "…" : ""}`;

  return [cut(a, endA), cut(b, endB)];
}

const segKey = (segment: Seg) =>
  segment.kind === "text" ? `t:${segment.text}` : `l:${segment.url}:${segment.text}`;

interface LinkText {
  url: string;
  text: string;
}

function linkLines(ref: string, goneLinks: LinkText[], cameLinks: LinkText[]): string[] {
  const lines: string[] = [];

  for (const link of cameLinks) {
    const previous = goneLinks.find((goneLink) => goneLink.text === link.text);

    lines.push(
      previous
        ? `${ref}: link ${quote(link.text)} repointed ${previous.url} -> ${link.url}`
        : `${ref}: link added on ${quote(link.text)} -> ${link.url}`
    );
  }

  for (const link of goneLinks)
    if (!cameLinks.some((cameLink) => cameLink.text === link.text))
      lines.push(`${ref}: link removed from ${quote(link.text)} (was ${link.url})`);

  return lines;
}

function textLines(ref: string, gone: Seg[], came: Seg[], lengths: [number, number]): string[] {
  const lines: string[] = [];
  const [beforeLength, afterLength] = lengths;
  const goneText = gone.filter((segment) => segment.kind === "text"),
    cameText = came.filter((segment) => segment.kind === "text");
  const total = Math.max(goneText.length, cameText.length);
  const pairs = Math.min(total, 3);

  for (let i = 0; i < pairs; i++) {
    const removedText = goneText[i]?.text,
      addedText = cameText[i]?.text;

    if (removedText !== undefined && addedText !== undefined) {
      const [focusBefore, focusAfter] = focus(removedText, addedText);

      lines.push(`${ref}: ${quote(focusBefore)} -> ${quote(focusAfter)}`);
    } else if (removedText !== undefined) lines.push(`${ref}: text removed ${quote(removedText)}`);
    else if (addedText !== undefined) lines.push(`${ref}: text added ${quote(addedText)}`);
  }

  if (total > pairs) lines.push(`${ref}: ${total - pairs} more segment(s) changed`);
  if (beforeLength && afterLength < beforeLength * 0.8)
    lines.push(`${ref}: text shrank ${beforeLength} -> ${afterLength} characters`);

  return lines;
}

function countKeys(list: Seg[]): Map<string, number> {
  const keys = new Map<string, number>();

  for (const segment of list) keys.set(segKey(segment), (keys.get(segKey(segment)) ?? 0) + 1);

  return keys;
}

/** The segments of `list` that `other` lacks: a text twice here and once there is one. */
function surplus(list: Seg[], other: Seg[]): Seg[] {
  const left = countKeys(other);

  return list.filter((segment) => {
    const key = segKey(segment);
    const count = left.get(key) ?? 0;

    if (count === 0) return true;
    left.set(key, count - 1);

    return false;
  });
}

function describeRichText(ref: string, before: unknown, after: unknown): string[] {
  const beforeSegments = segments(before),
    afterSegments = segments(after);

  if (beforeSegments.map(segKey).join("\n") === afterSegments.map(segKey).join("\n")) return [];
  const gone = surplus(beforeSegments, afterSegments);
  const came = surplus(afterSegments, beforeSegments);
  const bText = beforeSegments.map((segment) => segment.text).join(""),
    aText = afterSegments.map((segment) => segment.text).join("");
  const textSame = bText === aText;
  const goneLinks = gone.filter((segment) => segment.kind === "link") as Extract<
    Seg,
    { kind: "link" }
  >[];
  const cameLinks = came.filter((segment) => segment.kind === "link") as Extract<
    Seg,
    { kind: "link" }
  >[];
  const lines = linkLines(ref, goneLinks, cameLinks);

  if (!textSame) {
    lines.push(...textLines(ref, gone, came, [bText.length, aText.length]));
  } else if (!lines.length) {
    lines.push(`${ref}: formatting or node boundaries changed, text identical`);
  }

  if (!textSame && !lines.some((line) => line.includes('" -> "'))) {
    const [focusBefore, focusAfter] = focus(
      readingText(beforeSegments),
      readingText(afterSegments)
    );

    lines.push(`${ref}: the page read ${quote(focusBefore)} and now reads ${quote(focusAfter)}`);
  }

  return lines;
}

function rowLabel(ref: string): { parent: string; row: string } | null {
  const match = /^(.*)\[([^\]]+)\](?:\.[^.[]+)?$/u.exec(ref);

  return match ? { parent: match[1], row: match[2] } : null;
}

function rowAt(doc: unknown, parent: string, row: string): unknown {
  try {
    const arr = getByPath(doc, parsePath(parent));

    if (!Array.isArray(arr)) return undefined;

    return arr.find((candidate: unknown) => rowId(candidate) === row);
  } catch {
    return undefined;
  }
}

function blockTypeAt(doc: unknown, parent: string, row: string): string {
  const item = rowAt(doc, parent, row);

  return isObjectLike(item) && item.blockType ? `block ${item.blockType}` : "row";
}

/** The row of a leaf that is missing on the other side, when the row itself is missing there. */
function missingRow(ref: string, other: unknown) {
  const label = rowLabel(ref);

  return label && rowAt(other, label.parent, label.row) === undefined ? label : null;
}

function describeValueChange(ref: string, beforeValue: unknown, afterValue: unknown): string {
  if (typeof beforeValue === "string" && typeof afterValue === "string") {
    const [focusBefore, focusAfter] = focus(beforeValue, afterValue);

    return `${ref}: ${quote(focusBefore)} -> ${quote(focusAfter)}`;
  }

  return `${ref}: ${quote(JSON.stringify(beforeValue ?? null), 40)} -> ${quote(JSON.stringify(afterValue ?? null), 40)}`;
}

export function describeChanges(fields: SchemaField[], before: unknown, after: unknown): string[] {
  const bLeaves = collectContentFields(fields, before, { blockNames: true }),
    aLeaves = collectContentFields(fields, after, { blockNames: true });
  const bByRef = new Map(bLeaves.map((leaf) => [leaf.ref, leaf])),
    aByRef = new Map(aLeaves.map((leaf) => [leaf.ref, leaf]));
  const lines: string[] = [];
  const rowsGone = new Map<string, string>(),
    rowsCame = new Map<string, string>();

  for (const leaf of bLeaves) {
    if (leaf.embeddedInRichText) continue;
    const other = aByRef.get(leaf.ref);

    if (!other) {
      const label = missingRow(leaf.ref, after);

      if (label)
        rowsGone.set(`${label.parent}[${label.row}]`, blockTypeAt(before, label.parent, label.row));
      else lines.push(`${leaf.ref}: removed`);
      continue;
    }

    if (leaf.richText) {
      lines.push(
        ...describeRichText(
          leaf.ref,
          getByPath(before, parsePath(leaf.ref)),
          getByPath(after, parsePath(leaf.ref))
        )
      );
      continue;
    }

    const beforeValue = leaf.value,
      afterValue = other.value;

    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
    lines.push(describeValueChange(leaf.ref, beforeValue, afterValue));
  }

  for (const leaf of aLeaves) {
    if (leaf.embeddedInRichText || bByRef.has(leaf.ref)) continue;
    const label = missingRow(leaf.ref, before);

    if (label)
      rowsCame.set(`${label.parent}[${label.row}]`, blockTypeAt(after, label.parent, label.row));
    else
      lines.push(
        `${leaf.ref}: added ${typeof leaf.value === "string" ? quote(leaf.value) : ""}`.trim()
      );
  }

  for (const [rowRef, kind] of rowsGone)
    if (!rowsCame.has(rowRef)) lines.unshift(`${rowRef}: ${kind} removed`);
  for (const [rowRef, kind] of rowsCame)
    if (!rowsGone.has(rowRef)) lines.unshift(`${rowRef}: ${kind} added`);

  if (lines.length > MAX_LINES)
    return [...lines.slice(0, MAX_LINES), `${lines.length - MAX_LINES} more change(s)`];

  return lines;
}
