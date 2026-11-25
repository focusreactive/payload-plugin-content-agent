import { isRecord } from "../../borders.js";
import type { SchemaField } from "../../types.js";
import { rootOf } from "./lexicalEngine.js";

/**
 * `text`: only values inside fields that already exist changed, and every rich text kept its
 * nodes, links and embedded items. `structure`: anything else.
 */
export type ChangeClass = "text" | "structure";

const same = (before: unknown, after: unknown): boolean =>
  JSON.stringify(before ?? null) === JSON.stringify(after ?? null);

const REFERENCE_TYPES = new Set(["relationship", "upload", "join"]);
const VALUE_TYPES = new Set([
  "text",
  "textarea",
  "email",
  "code",
  "number",
  "checkbox",
  "date",
  "select",
  "radio",
  "point",
]);

const TEXT_RUN = "#text";

/**
 * A rich text tree without the words: each run of text nodes becomes one mark, and every other
 * node keeps its type and all it holds besides its children. A reworded sentence and a format
 * change leave the result equal; a new or removed node, link target or embedded item does not.
 */
function skeleton(node: unknown): unknown {
  if (!isRecord(node)) return node;
  if (node.type === "text") return TEXT_RUN;
  const { children, ...rest } = node;
  const kept: unknown[] = [];

  for (const child of Array.isArray(children) ? children : []) {
    const shape = skeleton(child);

    if (shape !== TEXT_RUN || kept.at(-1) !== TEXT_RUN) kept.push(shape);
  }

  return { ...rest, children: kept };
}

const sameRichTextShape = (before: unknown, after: unknown): boolean =>
  same(skeleton(rootOf(before)), skeleton(rootOf(after)));

const rowsOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const rowKey = (row: Record<string, unknown>): string =>
  `${String(row.id ?? "")}:${String(row.blockType ?? "")}`;

function rowsChangeStructure(field: SchemaField, before: unknown, after: unknown): boolean {
  const beforeRows = rowsOf(before);
  const afterRows = rowsOf(after);

  if (beforeRows.map(rowKey).join("|") !== afterRows.map(rowKey).join("|")) return true;

  return beforeRows.some((row, i) => {
    const rowFields =
      field.type === "blocks"
        ? field.blocks?.find((block) => block.slug === row.blockType)?.fields
        : field.fields;

    return !rowFields || fieldsChangeStructure(rowFields, row, afterRows[i]);
  });
}

function fieldChangesStructure(field: SchemaField, before: unknown, after: unknown): boolean {
  if (same(before, after) || VALUE_TYPES.has(field.type)) return false;
  if (REFERENCE_TYPES.has(field.type)) return true;
  if (field.type === "richText") return !sameRichTextShape(before, after);
  if (field.type === "group") return fieldsChangeStructure(field.fields ?? [], before, after);
  if (field.type === "array" || field.type === "blocks")
    return rowsChangeStructure(field, before, after);

  return true;
}

function fieldsChangeStructure(fields: SchemaField[], before: unknown, after: unknown): boolean {
  const beforeValues = isRecord(before) ? before : {};
  const afterValues = isRecord(after) ? after : {};

  return fields.some(
    (field) =>
      !!field.name &&
      fieldChangesStructure(field, beforeValues[field.name], afterValues[field.name])
  );
}

export const classifyChange = (
  fields: SchemaField[],
  before: unknown,
  after: unknown
): ChangeClass => (fieldsChangeStructure(fields, before, after) ? "structure" : "text");
