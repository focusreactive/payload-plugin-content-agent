import { isRecord } from "../../../borders.js";
import { extractText } from "../../subAgents/programmaticOps.js";
import { isInlineChild, rootOf } from "../lexicalEngine.js";
import type { collectTextNodes } from "../lexicalEngine.js";

/** Takes one node out of the tree under `parent`. False when it is not there. */
function removeChild(parent: unknown, node: unknown): boolean {
  if (!isRecord(parent) || !Array.isArray(parent.children)) return false;
  const at = parent.children.indexOf(node);

  if (at !== -1) {
    parent.children.splice(at, 1);

    return true;
  }

  return parent.children.some((child: unknown) => removeChild(child, node));
}

function parentOf(node: unknown, target: unknown): Record<string, unknown> | null {
  if (!isRecord(node) || !Array.isArray(node.children)) return null;
  if (node.children.includes(target)) return node;

  for (const child of node.children) {
    const found = parentOf(child, target);

    if (found) return found;
  }

  return null;
}

const holdsList = (item: unknown): boolean =>
  isRecord(item) &&
  Array.isArray(item.children) &&
  item.children.some((child: unknown) => isRecord(child) && child.type === "list");

// As the editor numbers them: an item that only holds a nested list takes no number of its own.
function renumberItems(list: Record<string, unknown>): void {
  let value = typeof list.start === "number" ? list.start : 1;

  for (const item of list.children as unknown[]) {
    if (!isRecord(item) || item.type !== "listitem") continue;
    if (typeof item.value === "number") item.value = value;
    if (!holdsList(item)) value++;
  }
}

/** A list item goes whole when it holds only inline text and its list keeps another item. */
function removeListItem(content: unknown, item: unknown): boolean {
  if (!isRecord(item) || item.type !== "listitem" || !Array.isArray(item.children)) return false;
  if (!item.children.every(isInlineChild)) return false;
  const list = parentOf(rootOf(content), item);

  if (!list) return false;
  const items = list.children as unknown[];
  const at = items.indexOf(item);
  const keepsOther = items.some((other) => other !== item && extractText(other).trim());

  if (!keepsOther || holdsList(items[at + 1])) return false;
  items.splice(at, 1);
  renumberItems(list);

  return true;
}

export interface SegmentTree {
  content: unknown;
  nodes: ReturnType<typeof collectTextNodes>;
  textOf: (index: number) => string;
}

/**
 * An empty segment removes its piece of text when its paragraph keeps other text and the
 * piece is not the text of a link, or its whole list item when the item has no other text.
 * Null for a segment that has text.
 */
export function blankSegment(
  { content, nodes, textOf }: SegmentTree,
  i: number,
  value: unknown
): "removed" | "refused" | null {
  if (typeof value === "string" && value.length > 0) return null;
  const { block, linkNode, node } = nodes[i];

  if (typeof value !== "string" || linkNode) return "refused";
  const keepsText = nodes.some(
    (other, j) => j !== i && other.block === block && textOf(j).trim().length > 0
  );

  if (keepsText) return removeChild(block, node) ? "removed" : "refused";

  return removeListItem(content, block) ? "removed" : "refused";
}
