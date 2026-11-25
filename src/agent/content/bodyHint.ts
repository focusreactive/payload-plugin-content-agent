import { isRecord } from "../../borders.js";
import type { SchemaField } from "../../types.js";
import { fieldsThroughGroups, valueAtPath } from "../../schema/fieldPaths.js";

const NOT_PROSE_KEYS = new Set(["id", "blockType", "blockName"]);

function nodeProse(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + nodeProse(child), 0);
  if (!isRecord(node)) return 0;
  const own = node.type === "text" && typeof node.text === "string" ? node.text.length : 0;
  const inBlock =
    isRecord(node.fields) && node.type !== "link" && node.type !== "autolink"
      ? fieldsProse(node.fields)
      : 0;

  return own + (Array.isArray(node.children) ? nodeProse(node.children) : 0) + inBlock;
}

// An embedded block keeps its data under `fields`: plain values and nested rich text.
function fieldsProse(data: unknown): number {
  if (typeof data === "string") return data.trim().length;
  if (Array.isArray(data)) return data.reduce((sum: number, child) => sum + fieldsProse(child), 0);
  if (!isRecord(data)) return 0;
  if (isRecord(data.root)) return nodeProse(data.root);

  return Object.entries(data).reduce(
    (sum, [key, child]) => sum + (NOT_PROSE_KEYS.has(key) ? 0 : fieldsProse(child)),
    0
  );
}

export function proseLength(value: unknown): number {
  if (typeof value === "string") return value.trim().length;
  if (typeof value !== "object" || value === null) return 0;

  return nodeProse(isRecord(value) ? (value.root ?? value) : value);
}

export interface BodyHint {
  ref: string;
  type: string;
  chars: number;
  others: Array<{ ref: string; type: string; chars: number }>;
  note: string;
}

const PROSE_TYPES = new Set(["richText", "textarea", "code"]);

export function bodyHint(fields: SchemaField[], doc: unknown): BodyHint | null {
  const candidates = fieldsThroughGroups(fields, (field) => PROSE_TYPES.has(field.type)).map(
    ({ path, field }) => ({
      ref: path,
      type: field.type,
      chars: proseLength(valueAtPath(doc, path)),
    })
  );

  if (candidates.length < 2) return null;
  candidates.sort((a, b) => b.chars - a.chars);
  const [top, ...others] = candidates;

  if (top.chars < 500) return null;

  return {
    ref: top.ref,
    type: top.type,
    chars: top.chars,
    others,
    note:
      `The document's prose is in "${top.ref}" (${top.type}, ${top.chars} chars). ` +
      others
        .map((other) => `"${other.ref}" (${other.type}) holds ${other.chars} chars`)
        .join(", ") +
      "; a task that speaks of the body of the document means the field that HOLDS the prose, not the one whose name sounds like it.",
  };
}
