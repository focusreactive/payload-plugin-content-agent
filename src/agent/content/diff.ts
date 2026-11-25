import { isRecord } from "../../borders.js";
import type { DocFields } from "../../borders.js";
import { eachNestedRoot } from "./lexicalEngine.js";
import type { SchemaField } from "../../types.js";

// Lexical's BlocksFeature keeps an embedded block's field data under `node.fields`, not
// `children`.
/**
 * The plain text of a Lexical rich text value, with the text of its embedded blocks.
 * @beta
 */
export function richTextToText(value: unknown): string {
  if (!isRecord(value) || !value.root) return "";
  const parts: string[] = [];
  let line = "";

  const flush = () => {
    if (line) parts.push(line);
    line = "";
  };

  // Lexical splits a word into several text nodes where its format changes: the text of one
  // block runs on, and only blocks are set apart.
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);

      return;
    }

    if (!isRecord(node)) return;

    if (typeof node.text === "string") {
      line += node.text;

      return;
    }

    if (node.type === "linebreak") {
      line += " ";

      return;
    }

    const isLink = node.type === "link" || node.type === "autolink";

    if (!isLink) flush();
    if (Array.isArray(node.children)) node.children.forEach(walk);

    if (isLink) {
      const url = (isRecord(node.fields) ? node.fields.url : undefined) ?? node.url;

      if (typeof url === "string" && url) line += ` (${url})`;
    } else {
      if (node.fields && typeof node.fields === "object") eachNestedRoot(node.fields, walk);
      flush();
    }
  };

  walk(value.root);
  flush();

  return parts.join(" ").replace(/\s+/gu, " ").trim();
}

const asFields = (value: unknown): DocFields => (isRecord(value) ? value : {});

const itemId = (item: unknown): string => String(isRecord(item) ? item.id : undefined);

function changedKeys(a: DocFields, b: DocFields): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];

  for (const key of keys) {
    if (key === "id") continue;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(key);
  }

  return out;
}

interface BlockArrayDiff {
  added: Array<{ id: string; blockType?: string; summary?: string }>;
  removed: Array<{ id: string; blockType?: string; summary?: string }>;
  changed: Array<{ id: string; blockType?: string; summary?: string; fields: string[] }>;
  reordered: boolean;
}

const SUMMARY_CHARS = 90;
const TEXT_TYPES = new Set(["text", "textarea", "richText", "email"]);
const NOT_CONTENT = new Set(["id", "blockType", "blockName"]);

const fieldsOfItem = (def: SchemaField | undefined, item: unknown): SchemaField[] | undefined =>
  def?.type === "blocks"
    ? def.blocks?.find((block) => isRecord(item) && block.slug === item.blockType)?.fields
    : def?.fields;

function firstOf<Entry>(entries: Entry[], read: (entry: Entry) => string): string {
  for (const entry of entries) {
    const found = read(entry);

    if (found) return found;
  }

  return "";
}

function firstText(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return firstOf(value, (element) => firstText(element, depth + 1));
  if (!isRecord(value)) return "";
  if (value.root) return richTextToText(value);

  return firstOf(Object.entries(value), ([key, entry]) =>
    NOT_CONTENT.has(key) ? "" : firstText(entry, depth + 1)
  );
}

// With the schema of the item: its first text field that holds something, then the text of its
// nested rows. Without it: the first text found.
function schemaText(item: unknown, fields: SchemaField[], depth = 0): string {
  if (depth > 4 || !isRecord(item)) return "";
  const own = firstOf(fields, (field) =>
    TEXT_TYPES.has(field.type) ? firstText(item[field.name]) : ""
  );

  if (own) return own;

  return firstOf(fields, (field) => {
    const value = item[field.name];

    if (field.type === "group" && field.fields) return schemaText(value, field.fields, depth + 1);
    if (!Array.isArray(value)) return "";

    return firstOf(value, (row) => {
      const rowFields = fieldsOfItem(field, row);

      return rowFields ? schemaText(row, rowFields, depth + 1) : "";
    });
  });
}

export function itemSummary(item: unknown, fields?: SchemaField[]): string {
  const text = (fields ? schemaText(item, fields) : firstText(item)).replace(/\s+/gu, " ");

  return text.length > SUMMARY_CHARS ? text.slice(0, SUMMARY_CHARS - 1) + "…" : text;
}

const withSummary = <Rest extends { id: string }>(
  item: unknown,
  def: SchemaField | undefined,
  rest: Rest
): Rest & { blockType?: string; summary?: string } => {
  const summary = itemSummary(item, fieldsOfItem(def, item));
  const blockType =
    isRecord(item) && typeof item.blockType === "string" ? item.blockType : undefined;

  return { ...rest, blockType, ...(summary ? { summary } : {}) };
};

function diffItemArray(
  before: unknown[],
  after: unknown[],
  def: SchemaField | undefined
): BlockArrayDiff {
  const beforeById = new Map((before ?? []).map((item) => [itemId(item), item]));
  const afterById = new Map((after ?? []).map((item) => [itemId(item), item]));
  const added = [...afterById.keys()]
    .filter((id) => !beforeById.has(id))
    .map((id) => withSummary(afterById.get(id), def, { id }));
  const removed = [...beforeById.keys()]
    .filter((id) => !afterById.has(id))
    .map((id) => withSummary(beforeById.get(id), def, { id }));
  const changed = [...afterById.keys()]
    .filter(
      (id) =>
        beforeById.has(id) &&
        JSON.stringify(afterById.get(id)) !== JSON.stringify(beforeById.get(id))
    )
    .map((id) =>
      withSummary(afterById.get(id), def, {
        id,
        fields: changedKeys(asFields(beforeById.get(id)), asFields(afterById.get(id))),
      })
    );
  const survivingBefore = (before ?? []).map(itemId).filter((id) => afterById.has(id));
  const survivingAfter = (after ?? []).map(itemId).filter((id) => beforeById.has(id));
  const reordered = JSON.stringify(survivingBefore) !== JSON.stringify(survivingAfter);

  return { added, removed, changed, reordered };
}

interface FieldDiff {
  name: string;
  type: string;
  label?: string;
  before?: unknown;
  after?: unknown;
  blocks?: BlockArrayDiff;
}

export interface DocDiff {
  collection: string;
  id: unknown;
  status?: unknown;
  title?: unknown;
  isNew: boolean;
  fields: FieldDiff[];
}

export interface DocDiffOptions {
  titleField?: string;
  upload?: boolean;
}

export interface DocDiffInput {
  fields: SchemaField[];
  collection: string;
  published: DocFields | null | undefined;
  draft: DocFields | null | undefined;
  opts?: DocDiffOptions;
}

interface FieldSide {
  def: SchemaField | undefined;
  name: string;
  label?: string;
}

function diffField(
  { def, name, label }: FieldSide,
  publishedValue: unknown,
  draftValue: unknown
): FieldDiff {
  const type = def?.type ?? "unknown";
  const base = { name, type, ...(label ? { label } : {}) };

  if (type === "richText") {
    return {
      ...base,
      before: richTextToText(publishedValue),
      after: richTextToText(draftValue),
    };
  }

  if (type === "blocks" || type === "array") {
    return {
      ...base,
      blocks: diffItemArray(
        Array.isArray(publishedValue) ? publishedValue : [],
        Array.isArray(draftValue) ? draftValue : [],
        def
      ),
    };
  }

  return { ...base, before: publishedValue ?? null, after: draftValue ?? null };
}

interface GroupSides {
  fields: SchemaField[];
  before: DocFields;
  after: DocFields;
  /** The path and the label of the group the fields sit in; empty at the top level. */
  path: string;
  label: string;
  skips: (name: string) => boolean;
}

// A changed group is reported field by field: its whole value says nothing to a reviewer.
function diffFields({ fields, before, after, path, label, skips }: GroupSides): FieldDiff[] {
  const defs = new Map(fields.filter((field) => field.name).map((field) => [field.name, field]));

  return changedKeys(before, after).flatMap((key) => {
    if (skips(key)) return [];
    const def = defs.get(key);
    const name = path ? `${path}.${key}` : key;
    const ownLabel = def?.label ?? (label ? key : "");
    const fullLabel = label && ownLabel ? `${label} / ${ownLabel}` : ownLabel;

    if (def?.type === "group" && def.fields)
      return diffFields({
        fields: def.fields,
        before: asFields(before[key]),
        after: asFields(after[key]),
        path: name,
        label: fullLabel || key,
        skips: () => false,
      });

    return [diffField({ def, name, label: fullLabel }, before[key], after[key])];
  });
}

function diffTitle(draft: DocFields | null | undefined, opts: DocDiffOptions | undefined): unknown {
  return opts?.titleField ? (draft ?? {})[opts.titleField] : undefined;
}

export function computeDocDiff({
  fields,
  collection,
  published,
  draft,
  opts,
}: DocDiffInput): DocDiff {
  const pub = published ?? {};
  // `sizes` is system data only on an upload collection; elsewhere it can be a content field.
  const SYSTEM_KEYS = new Set(["createdAt", "updatedAt", "id", ...(opts?.upload ? ["sizes"] : [])]);
  const out = diffFields({
    fields,
    before: pub,
    after: draft ?? {},
    path: "",
    label: "",
    skips: (name) => name.startsWith("_") || SYSTEM_KEYS.has(name),
  });

  return {
    collection,
    id: (draft ?? pub)?.id,
    status: (draft ?? {})._status,
    title: diffTitle(draft, opts),
    isNew: !published || Object.keys(published).length === 0,
    fields: out,
  };
}
