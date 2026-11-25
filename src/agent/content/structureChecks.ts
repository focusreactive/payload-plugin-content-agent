import type { SchemaContext, SchemaField } from "../../types.js";
import { fieldsForTarget } from "./workspaceTools.js";
import type { DocTarget } from "./documentIo.js";
import { previewRefValue } from "./blockTools.js";
import { TEXT_TYPES, collectContentFields, isObjectLike } from "./discovery.js";

function summarizeBlocksField(field: SchemaField, val: unknown, path: string): string[] {
  const items: unknown[] = Array.isArray(val) ? val : [];
  const lines = [
    `${path}: [${items.map((item) => (isObjectLike(item) ? item.blockType : undefined)).join(", ")}]`,
  ];

  for (const item of items) {
    if (!isObjectLike(item) || item.id == null) continue;
    const def = field.blocks?.find((block) => block.slug === item.blockType);

    if (def) lines.push(...summarizeBlocksArrays(def.fields, item, `${path}[${item.id}]`));
  }

  return lines;
}

function summarizeArrayField(field: SchemaField, val: unknown, path: string): string[] {
  // An empty or absent array still reports "0 row(s)": that line is how the reviewer sees an
  // unfilled section.
  const rows: unknown[] = Array.isArray(val) ? val : [];
  const lines = [`${path}: ${rows.length} row(s)`];

  for (const row of rows) {
    if (isObjectLike(row) && row.id != null)
      lines.push(...summarizeBlocksArrays(field.fields ?? [], row, `${path}[${row.id}]`));
  }

  return lines;
}

function isEmptyRef(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;

  return Array.isArray(value) && value.length === 0;
}

function summarizeReferenceField(field: SchemaField, val: unknown, path: string): string[] {
  if (isEmptyRef(val)) {
    return [`${path}: no ${field.type === "upload" ? "media" : "reference"} set`];
  }

  const ref = previewRefValue(field, val);

  return ref ? [`${path}: ${ref}`] : [];
}

function summarizeBlocksArrays(fields: SchemaField[], data: unknown, basePath = ""): string[] {
  const lines: string[] = [];

  if (!isObjectLike(data)) return lines;

  for (const field of fields) {
    if (!field.name) continue;
    const val = data[field.name];
    const path = basePath ? `${basePath}.${field.name}` : field.name;

    if (field.type === "blocks") {
      lines.push(...summarizeBlocksField(field, val, path));
    } else if (field.type === "group") {
      lines.push(...summarizeBlocksArrays(field.fields ?? [], val, path));
    } else if (field.type === "array") {
      lines.push(...summarizeArrayField(field, val, path));
    } else if (field.type === "relationship" || field.type === "upload") {
      lines.push(...summarizeReferenceField(field, val, path));
    }
  }

  return lines;
}

const MAX_OUTLINE_LINES = 400;

export function outlineDoc(schema: SchemaContext, target: DocTarget, doc: unknown): string {
  const fields = fieldsForTarget(schema, target);
  const all = summarizeBlocksArrays(fields, doc);
  const lines: string[] =
    all.length > MAX_OUTLINE_LINES
      ? [
          ...all.slice(0, MAX_OUTLINE_LINES),
          `… ${all.length - MAX_OUTLINE_LINES} more structural line(s) omitted`,
        ]
      : all;
  const leaves = collectContentFields(fields, doc);
  const textLeaves = leaves.filter((leaf) => TEXT_TYPES.has(leaf.type));
  const totalLen = textLeaves.reduce(
    (total, leaf) => total + (typeof leaf.value === "string" ? leaf.value.length : 0),
    0
  );
  const richTextCount = leaves.filter((leaf) => leaf.richText).length;

  lines.push(
    `plain-text fields: ${textLeaves.length} (${totalLen} chars), richText fields: ${richTextCount}`
  );

  return lines.join("\n");
}

export interface EmptySection {
  path: string;
  blockType: string;
  empty: string[];
}

function collectRowIds(value: unknown, into: Set<string>, depth = 0): void {
  if (!isObjectLike(value) || depth > 12) return;

  if (Array.isArray(value)) {
    for (const child of value) collectRowIds(child, into, depth + 1);

    return;
  }

  if (value.id != null) into.add(String(value.id));
  for (const child of Object.values(value)) collectRowIds(child, into, depth + 1);
}

function emptyContainersOf(
  defFields: SchemaField[],
  item: Record<string, unknown>
): string[] | null {
  const containers = defFields.filter(
    (subField) => !!subField.name && (subField.type === "array" || subField.type === "blocks")
  );
  const emptyOnes = containers.filter((subField) => {
    const rows = item[subField.name];

    return !Array.isArray(rows) || rows.length === 0;
  });

  if (containers.length > 0 && emptyOnes.length === containers.length)
    return emptyOnes.map((subField) => subField.name);

  return null;
}

export function findEmptyNewSections(
  fields: SchemaField[],
  before: unknown,
  after: unknown
): EmptySection[] {
  const known = new Set<string>();

  collectRowIds(before, known);
  const out: EmptySection[] = [];

  const walkBlocks = (
    field: SchemaField,
    items: unknown[],
    path: string,
    descend: (levelFields: SchemaField[], data: unknown, base: string) => void
  ): void => {
    for (const item of items) {
      if (!isObjectLike(item)) continue;
      const def = field.blocks?.find((block) => block.slug === item.blockType);

      if (!def || item.id == null) continue;
      const itemPath = `${path}[${item.id}]`;

      if (!known.has(String(item.id))) {
        const empty = emptyContainersOf(def.fields, item);

        if (empty) out.push({ path: itemPath, blockType: def.slug, empty });
      }

      descend(def.fields, item, itemPath);
    }
  };

  const walk = (levelFields: SchemaField[], data: unknown, base: string): void => {
    if (!isObjectLike(data)) return;

    for (const field of levelFields) {
      if (!field.name) continue;
      const val = data[field.name];
      const path = base ? `${base}.${field.name}` : field.name;

      if (field.type === "blocks" && Array.isArray(val)) {
        walkBlocks(field, val, path, walk);
      } else if (field.type === "group") {
        walk(field.fields ?? [], val, path);
      } else if (field.type === "array" && Array.isArray(val)) {
        for (const row of val)
          if (isObjectLike(row) && row.id != null)
            walk(field.fields ?? [], row, `${path}[${row.id}]`);
      }
    }
  };

  walk(fields, after, "");

  return out;
}

function hasNoBlocks(fields: SchemaField[], doc: unknown): boolean {
  for (const field of fields) {
    if (!field.name || !isObjectLike(doc)) continue;
    const val = doc[field.name];

    if (field.type === "blocks" && Array.isArray(val) && val.length > 0) return false;
    if (field.type === "group" && !hasNoBlocks(field.fields ?? [], val)) return false;
  }

  return true;
}

export function cloneRoutingRefusal(
  fields: SchemaField[],
  doc: unknown,
  modelDocument: string | undefined
): string | null {
  if (!modelDocument?.trim() || !hasNoBlocks(fields, doc)) return null;

  return (
    `This document has no sections yet and \`modelDocument\` says the page should follow an existing one ("${modelDocument.trim().slice(0, 120)}"). ` +
    "Composing it from scratch here is the wrong job: this editor cannot read the model page, so it would invent its own " +
    "block set and leave every section that references another document or an image empty. " +
    "Clone instead - cloneDocument({ collection, sourceId, data: { <a new value for the title field and for every unique field> } }) copies the model page verbatim - then call " +
    "editContent on the NEW id and say the structure must be preserved. " +
    "If there is genuinely no source document in the CMS, call editContent again without `modelDocument` and name " +
    'the block types and section order explicitly (readDocument({ view: "outline" }) on a comparable page returns them).'
  );
}
