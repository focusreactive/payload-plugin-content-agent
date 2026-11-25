import { z } from "zod";
import { isRecord } from "../../borders.js";
import type { SchemaContext, SchemaField } from "../../types.js";
import type { LexicalNode } from "./lexicalEngine.js";

/** An object or an array: a path segment can be a key of either. */
export const isObjectLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const rowId = (item: unknown): string => String(isObjectLike(item) ? item.id : undefined);

/**
 * Fits the `locale` parameter of every tool to the site: no parameter on a site without locales,
 * and on a localized site the codes of the schema as the only values. The codes are not repeated
 * in the description: in twelve tools that sentence made the agent answer in the content locale.
 */
export function omitLocaleParam<Tools extends Record<string, unknown>>(
  tools: Tools,
  schema: SchemaContext
): Tools {
  const writable: Record<string, unknown> = tools;
  const [first, ...rest] = schema.locales ?? [];

  if (first) {
    for (const [name, tool] of Object.entries(tools)) {
      if (!isObjectLike(tool)) continue;
      const input = tool.inputSchema;

      if (!(input instanceof z.ZodObject) || !("locale" in input.shape)) continue;
      const described: unknown = input.shape.locale.description;
      const locale = z
        .enum([first, ...rest])
        .optional()
        .describe(typeof described === "string" ? described : "Locale code.");

      writable[name] = { ...tool, inputSchema: input.extend({ locale }) };
    }

    return tools;
  }

  for (const [name, tool] of Object.entries(tools)) {
    if (!isObjectLike(tool)) continue;
    const input = tool.inputSchema;

    if (
      isObjectLike(input) &&
      typeof input.omit === "function" &&
      isObjectLike(input.shape) &&
      "locale" in input.shape
    ) {
      writable[name] = { ...tool, inputSchema: input.omit({ locale: true }) };
    }
  }

  return tools;
}

export function validateLocaleArg(
  schema: SchemaContext,
  locale: string | undefined
): string | null {
  if (!locale) return null;
  if (!schema.locales?.length)
    return `This project is not localized (no locales configured) - the "locale" argument is not applicable.`;
  if (!schema.locales.includes(locale))
    return `Unknown locale "${locale}". Available locales: ${schema.locales.join(", ")}.`;

  return null;
}

type PathSegment = string | { id: string };
export type Path = PathSegment[];

interface ContentSlot {
  schemaPath: string;
  kind: "richText" | "blocks";
  field: SchemaField;
}

export interface Resolution {
  field: SchemaField | null;
  fields: SchemaField[];
  value: unknown;
  /** The field or one of its parents is read-only. */
  readOnly?: boolean;
  /** The field or one of its parents is localized: its value is stored once for each locale. */
  localized?: boolean;
}

export function formatPath(path: Path): string {
  let out = "";

  for (const seg of path) {
    if (typeof seg === "string") out += out ? `.${seg}` : seg;
    else out += `[${seg.id}]`;
  }

  return out;
}

export function parsePath(str: string): Path {
  const path: Path = [];

  if (!str) return path;

  for (const token of str.split(".")) {
    if (!token) continue;
    const keyMatch = token.match(/^([^[\]]*)/u);
    const key = keyMatch?.[1] ?? "";

    if (key) path.push(key);
    const idMatches = token.matchAll(/\[([^\]]+)\]/gu);

    for (const match of idMatches) path.push({ id: match[1] });
  }

  return path;
}

const LEXICAL_BLOCK_TYPES = new Set(["block", "inlineBlock"]);

function isRichTextValue(value: unknown): boolean {
  return !!(isObjectLike(value) && value.root && typeof value.root === "object");
}

interface LexicalBlockNode extends LexicalNode {
  type: string;
  fields: Record<string, unknown>;
}

const isLexicalBlockNode = (node: LexicalNode): node is LexicalBlockNode =>
  typeof node.type === "string" && LEXICAL_BLOCK_TYPES.has(node.type) && isObjectLike(node.fields);

function collectLexicalBlocks(content: unknown): LexicalBlockNode[] {
  const out: LexicalBlockNode[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isRecord(node)) return;

    if (isLexicalBlockNode(node)) {
      out.push(node);

      return;
    }

    if (Array.isArray(node.children)) node.children.forEach(walk);
  };

  walk(isObjectLike(content) ? (content.root ?? content) : content);

  return out;
}

function findLexicalBlockById(richText: unknown, id: string): LexicalBlockNode | undefined {
  return collectLexicalBlocks(richText).find((node) => String(node.fields.id) === String(id));
}

export function getByPath(doc: unknown, path: Path): unknown {
  let cur: unknown = doc;

  for (const seg of path) {
    if (cur == null) return undefined;

    if (typeof seg === "string") {
      cur = isObjectLike(cur) ? cur[seg] : undefined;
    } else if (Array.isArray(cur)) {
      cur = cur.find((item: unknown) => rowId(item) === String(seg.id));
    } else if (isRichTextValue(cur)) {
      cur = findLexicalBlockById(cur, seg.id)?.fields;
    } else {
      return undefined;
    }
  }

  return cur;
}

export function setByPath(doc: unknown, path: Path, value: unknown): boolean {
  if (path.length === 0) return false;
  const parent = getByPath(doc, path.slice(0, -1));

  const last = path[path.length - 1];

  // An unset group on the way to the field: the schema resolved the path, so the group is created.
  if (parent == null && typeof last === "string" && path.length > 1) {
    const above = path[path.length - 2];

    if (typeof above !== "string" || !setByPath(doc, path.slice(0, -1), {})) return false;

    return setByPath(doc, path, value);
  }

  if (!isObjectLike(parent)) return false;

  if (typeof last === "string") {
    parent[last] = value;

    return true;
  }

  if (!Array.isArray(parent)) return false;
  const idx = parent.findIndex((item: unknown) => rowId(item) === String(last.id));

  if (idx === -1) return false;
  parent[idx] = value;

  return true;
}

const isRichText = (field: SchemaField) => field.type === "richText";
const isBlocks = (field: SchemaField) => field.type === "blocks";

export function findContentSlots(fields: SchemaField[], basePath = ""): ContentSlot[] {
  const slots: ContentSlot[] = [];

  for (const field of fields) {
    if (!field.name) continue;
    if (field.readOnly) continue;
    const path = basePath ? `${basePath}.${field.name}` : field.name;

    if (isRichText(field)) {
      slots.push({ schemaPath: path, kind: "richText", field });
    } else if (isBlocks(field)) {
      slots.push({ schemaPath: path, kind: "blocks", field });

      for (const block of field.blocks ?? []) {
        slots.push(...findContentSlots(block.fields, `${path}[].${block.slug}`));
      }
    } else if (field.type === "group" && field.fields) {
      slots.push(...findContentSlots(field.fields, path));
    } else if (field.type === "array" && field.fields) {
      slots.push(...findContentSlots(field.fields, `${path}[]`));
    }
  }

  return slots;
}

const BLOCK_NAME = "blockName";
const BLOCK_NAME_FIELD: SchemaField = { name: BLOCK_NAME, type: "text" };

const isBlockRow = ({ field, value }: Resolution): boolean =>
  (field?.type === "blocks" || field?.type === "richText") &&
  isObjectLike(value) &&
  typeof value.blockType === "string";

function stepIntoName(cursor: Resolution, name: string): Resolution | null {
  const found =
    cursor.fields.find((candidate) => candidate.name === name) ??
    (name === BLOCK_NAME && isBlockRow(cursor) ? BLOCK_NAME_FIELD : undefined);

  if (!found) return null;

  return {
    field: found,
    fields: found.type === "group" ? (found.fields ?? []) : [],
    value: isObjectLike(cursor.value) ? cursor.value[name] : undefined,
    readOnly: cursor.readOnly || !!found.readOnly,
    localized: cursor.localized || !!found.localized,
  };
}

/** What a row or an embedded block takes over from the field that holds it. */
const inherited = ({ readOnly, localized }: Resolution) => ({ readOnly, localized });

function stepIntoRow(cursor: Resolution, rows: unknown[], id: string): Resolution | null {
  const item: unknown = rows.find((row: unknown) => rowId(row) === String(id));

  if (item === undefined) return null;
  const { field } = cursor;

  if (field?.type === "blocks") {
    const blockType = isObjectLike(item) ? item.blockType : undefined;
    const def = field.blocks?.find((block) => block.slug === blockType);

    return { field, fields: def?.fields ?? [], value: item, ...inherited(cursor) };
  }

  if (field?.type === "array")
    return { field, fields: field.fields ?? [], value: item, ...inherited(cursor) };

  return { field, fields: cursor.fields, value: item, ...inherited(cursor) };
}

function stepIntoEmbeddedBlock(cursor: Resolution, id: string): Resolution | null {
  const { field, value } = cursor;

  if (field?.type !== "richText" || !isRichTextValue(value)) return null;
  const node = findLexicalBlockById(value, id);

  if (!node) return null;
  const def = [...(field.blocks ?? []), ...(field.inlineBlocks ?? [])].find(
    (block) => block.slug === node.fields.blockType
  );

  if (!def) return null;

  return { field, fields: def.fields ?? [], value: node.fields, ...inherited(cursor) };
}

function stepInto(cursor: Resolution, seg: PathSegment): Resolution | null {
  if (typeof seg === "string") return stepIntoName(cursor, seg);
  if (Array.isArray(cursor.value)) return stepIntoRow(cursor, cursor.value, seg.id);

  return stepIntoEmbeddedBlock(cursor, seg.id);
}

export function resolveFieldAtPath(
  rootFields: SchemaField[],
  doc: unknown,
  path: Path
): Resolution | null {
  let cursor: Resolution = { field: null, fields: rootFields, value: doc };

  for (const seg of path) {
    const next = stepInto(cursor, seg);

    if (!next) return null;
    cursor = next;
  }

  return cursor;
}

export interface ContentLeaf {
  ref: string;
  type: string;
  value?: unknown;
  richText?: boolean;
  localized: boolean;
  /** A richText inside a Lexical-embedded block. A consumer whose walk of the parent richText
   *  enters block fields skips it, or the same prose is read twice. A walk that stops at block
   *  nodes (find-replace, search) reads it as its own leaf. */
  embeddedInRichText?: boolean;
}

/** The field types that hold their text as a plain string. */
export const TEXT_TYPES: ReadonlySet<string> = new Set(["text", "textarea", "email", "code"]);
const SCALAR_TYPES = new Set([
  "number",
  "checkbox",
  "date",
  "select",
  "radio",
  "point",
  "relationship",
  "upload",
  "json",
]);

export interface CollectContentOptions {
  basePath?: string;
  parentLocalized?: boolean;
  warnings?: string[];
  underRichText?: boolean;
  /** Also list the name a block carries in the admin, as a text leaf at `<block>.blockName`. */
  blockNames?: boolean;
}

interface LeafPosition {
  path: string;
  localized: boolean;
  warnings?: string[];
  underRichText: boolean;
  blockNames: boolean;
}

const nestedOptions = (position: LeafPosition, basePath: string): CollectContentOptions => ({
  basePath,
  parentLocalized: position.localized,
  warnings: position.warnings,
  underRichText: position.underRichText,
  blockNames: position.blockNames,
});

function blockNameLeaf(
  def: { fields: SchemaField[] },
  row: Record<string, unknown>,
  position: LeafPosition,
  rowPath: string
): ContentLeaf[] {
  if (!position.blockNames || def.fields.some((field) => field.name === BLOCK_NAME)) return [];
  const value = typeof row[BLOCK_NAME] === "string" ? row[BLOCK_NAME] : "";

  return [{ ref: `${rowPath}.${BLOCK_NAME}`, type: "text", value, localized: position.localized }];
}

export function collectContentFields(
  fields: SchemaField[],
  data: unknown,
  options: CollectContentOptions = {}
): ContentLeaf[] {
  const { basePath = "", parentLocalized = false, warnings, underRichText = false } = options;
  const blockNames = options.blockNames ?? false;
  const out: ContentLeaf[] = [];

  if (!isObjectLike(data)) return out;

  for (const field of fields) {
    if (!field.name) continue;
    if (field.readOnly) continue;
    // The auto-injected `id` of a block or array row is its address, not content.
    if (field.name === "id" && field.type === "text") continue;
    const val: unknown = data[field.name];
    const path = basePath ? `${basePath}.${field.name}` : field.name;
    const localized = parentLocalized || !!field.localized;

    out.push(
      ...leavesOfField(field, val, { path, localized, warnings, underRichText, blockNames })
    );
  }

  return out;
}

function richTextLeaves(field: SchemaField, val: unknown, position: LeafPosition): ContentLeaf[] {
  if (!isObjectLike(val) || !val.root) return [];
  const { path, localized, warnings, underRichText } = position;
  const out: ContentLeaf[] = [
    {
      ref: path,
      type: "richText",
      richText: true,
      localized,
      ...(underRichText ? { embeddedInRichText: true } : {}),
    },
  ];
  const defs = [...(field.blocks ?? []), ...(field.inlineBlocks ?? [])];

  if (!defs.length) return out;

  for (const node of collectLexicalBlocks(val)) {
    const id = node.fields.id;

    if (id == null) continue;
    const def = defs.find((block) => block.slug === node.fields.blockType);

    if (def)
      out.push(
        ...blockNameLeaf(def, node.fields, position, `${path}[${id}]`),
        ...collectContentFields(def.fields, node.fields, {
          ...nestedOptions(position, `${path}[${id}]`),
          underRichText: true,
        })
      );
    else
      warnings?.push(
        `${path}[${id}]: unknown embedded blockType "${node.fields.blockType}" - its content is excluded`
      );
  }

  return out;
}

function arrayLeaves(field: SchemaField, val: unknown, position: LeafPosition): ContentLeaf[] {
  const out: ContentLeaf[] = [];

  if (!Array.isArray(val)) return out;
  const { path } = position;

  for (const row of val) {
    if (isObjectLike(row) && row.id != null)
      out.push(
        ...collectContentFields(
          field.fields ?? [],
          row,
          nestedOptions(position, `${path}[${row.id}]`)
        )
      );
  }

  return out;
}

function blocksLeaves(field: SchemaField, val: unknown, position: LeafPosition): ContentLeaf[] {
  const out: ContentLeaf[] = [];

  if (!Array.isArray(val)) return out;
  const { path, warnings } = position;

  for (const item of val) {
    if (!isObjectLike(item) || item.id == null) continue;
    const def = field.blocks?.find((block) => block.slug === item.blockType);

    if (def)
      out.push(
        ...blockNameLeaf(def, item, position, `${path}[${item.id}]`),
        ...collectContentFields(def.fields, item, nestedOptions(position, `${path}[${item.id}]`))
      );
    else
      warnings?.push(
        `${path}[${item.id}]: unknown blockType "${item.blockType}" - its content is excluded`
      );
  }

  return out;
}

function leavesOfField(field: SchemaField, val: unknown, position: LeafPosition): ContentLeaf[] {
  const { path, localized } = position;

  if ((field.type === "text" || field.type === "number") && field.hasMany)
    return Array.isArray(val) ? [{ ref: path, type: field.type, value: val, localized }] : [];
  if (TEXT_TYPES.has(field.type))
    return typeof val === "string" ? [{ ref: path, type: field.type, value: val, localized }] : [];
  if (field.type === "richText") return richTextLeaves(field, val, position);
  if (field.type === "group")
    return collectContentFields(field.fields ?? [], val, nestedOptions(position, path));
  if (field.type === "array") return arrayLeaves(field, val, position);
  if (field.type === "blocks") return blocksLeaves(field, val, position);
  if (SCALAR_TYPES.has(field.type) && val !== undefined && val !== null)
    return [{ ref: path, type: field.type, value: val, localized }];

  return [];
}

export function resolveBlockDef(
  blocksField: SchemaField,
  item: unknown
): { slug: string; fields: SchemaField[] } | null {
  const blockType = isObjectLike(item) ? item.blockType : undefined;

  return blocksField.blocks?.find((block) => block.slug === blockType) ?? null;
}
