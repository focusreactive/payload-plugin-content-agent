import { z } from "zod";
import { tool } from "ai";
import type { SchemaField } from "../../../types.js";
import { bodyHint, proseLength } from "../bodyHint.js";
import {
  TEXT_TYPES,
  collectContentFields,
  getByPath,
  isObjectLike,
  parsePath,
  resolveBlockDef,
  resolveFieldAtPath,
} from "../discovery.js";
import { isOpen, rootFields } from "./containers.js";
import type { BlockToolsContext } from "./containers.js";
import { NO_OPEN_DOCUMENT } from "../noOpenDocument.js";

export interface ContainerStructure {
  path: string;
  kind: string;
  count: number;
  allowedBlocks?: string[];
  items: string[];
}

const itemIdLabel = (item: unknown): unknown => (isObjectLike(item) ? item.id : undefined) ?? "?";

const MAX_STRUCTURE_ITEMS = 80;

function blockLine(item: unknown): string {
  const row = isObjectLike(item) ? item : {};
  const name = typeof row.blockName === "string" && row.blockName ? row.blockName : null;

  return `[${itemIdLabel(item)}] ${row.blockType ?? "?"}${name ? ` blockName ${JSON.stringify(name)}` : ""}`;
}

function structureOf(
  fields: SchemaField[],
  data: unknown,
  basePath: string,
  out: ContainerStructure[]
): void {
  if (!isObjectLike(data)) return;

  for (const field of fields) {
    if (!field.name || field.readOnly) continue;
    const value = data[field.name];
    const path = basePath ? `${basePath}.${field.name}` : field.name;

    if (field.type === "group") {
      structureOf(field.fields ?? [], value, path, out);
      continue;
    }

    if (field.type !== "blocks" && field.type !== "array") continue;
    const items: unknown[] = Array.isArray(value) ? value : [];
    const shown = items.slice(0, MAX_STRUCTURE_ITEMS);

    out.push({
      path,
      kind: field.type,
      count: items.length,
      ...(field.type === "blocks"
        ? { allowedBlocks: (field.blocks ?? []).map((block) => block.slug) }
        : {}),
      items: [
        ...shown.map((item) =>
          field.type === "blocks" ? blockLine(item) : `[${itemIdLabel(item)}]`
        ),
        ...(items.length > shown.length ? [`… +${items.length - shown.length} more`] : []),
      ],
    });

    for (const item of items) {
      const sub =
        field.type === "blocks"
          ? (resolveBlockDef(field, item)?.fields ?? [])
          : (field.fields ?? []);

      structureOf(sub, item, `${path}[${itemIdLabel(item)}]`, out);
    }
  }
}

const MAX_UNSET_FIELDS = 150;
const LEAF_TYPES = new Set([
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
  "relationship",
  "upload",
  "json",
  "richText",
]);

const holdsValue = (field: SchemaField, value: unknown): boolean =>
  field.type === "richText"
    ? isObjectLike(value) && !!value.root
    : TEXT_TYPES.has(field.type) && !field.hasMany
      ? typeof value === "string"
      : value !== undefined && value !== null;

const itemFields = (field: SchemaField, item: unknown): SchemaField[] =>
  field.type === "blocks" ? (resolveBlockDef(field, item)?.fields ?? []) : (field.fields ?? []);

const isWritten = (field: SchemaField): boolean =>
  !!field.name &&
  !field.readOnly &&
  !field.unsupported &&
  !(field.name === "id" && field.type === "text");

/** The writable fields that hold no value: a ref for each one, so the editor never builds a ref. */
function unsetFields(fields: SchemaField[], data: unknown, basePath: string, out: string[]): void {
  const record = isObjectLike(data) ? data : {};

  for (const field of fields.filter(isWritten)) {
    const value = record[field.name];
    const path = basePath ? `${basePath}.${field.name}` : field.name;

    if (field.type === "group") unsetFields(field.fields ?? [], value, path, out);
    else if (field.type === "array" || field.type === "blocks") {
      for (const item of Array.isArray(value) ? value : [])
        if (isObjectLike(item) && item.id != null)
          unsetFields(itemFields(field, item), item, `${path}[${item.id}]`, out);
    } else if (LEAF_TYPES.has(field.type) && !holdsValue(field, value))
      out.push(`${path} (${field.type})`);
  }
}

function valueRules(context: BlockToolsContext, ref: string) {
  const field = resolveFieldAtPath(
    rootFields(context),
    context.workspace.ref.current,
    parsePath(ref)
  )?.field;

  if (!field) return {};

  return {
    ...(field.options
      ? {
          options: field.options.map((option) =>
            typeof option === "string" ? option : option.value
          ),
        }
      : {}),
    ...(field.relationTo ? { relationTo: field.relationTo } : {}),
    ...(field.hasMany ? { hasMany: true } : {}),
    ...(field.required ? { required: true } : {}),
  };
}

async function getEditableContent(context: BlockToolsContext) {
  const { workspace } = context;

  if (!isOpen(context)) return { error: NO_OPEN_DOCUMENT };
  const warnings: string[] = [];
  const leaves = collectContentFields(rootFields(context), workspace.ref.current, {
    basePath: "",
    parentLocalized: false,
    warnings,
  });
  const listed = leaves.filter((leaf) => !(leaf.richText && leaf.embeddedInRichText));

  const fields = listed.map((leaf) => ({
    ref: leaf.ref,
    type: leaf.type,
    editWith: leaf.richText ? "applyRichText" : "setValues",
    ...(leaf.richText ? {} : { value: leaf.value }),
    ...(leaf.localized ? { localized: true } : {}),
    ...valueRules(context, leaf.ref),
    ...(leaf.richText
      ? { chars: proseLength(getByPath(workspace.ref.current, parsePath(leaf.ref))) }
      : {}),
  }));
  const body = bodyHint(rootFields(context), workspace.ref.current);
  const counts = fields.reduce<Record<string, number>>((acc, field) => {
    acc[field.editWith] = (acc[field.editWith] ?? 0) + 1;

    return acc;
  }, {});
  const structure: ContainerStructure[] = [];

  structureOf(rootFields(context), workspace.ref.current, "", structure);
  const unset: string[] = [];

  unsetFields(rootFields(context), workspace.ref.current, "", unset);

  return {
    ...(body ? { body } : {}),
    structure,
    fields,
    ...(unset.length
      ? {
          unset: [
            ...unset.slice(0, MAX_UNSET_FIELDS),
            ...(unset.length > MAX_UNSET_FIELDS
              ? [`… +${unset.length - MAX_UNSET_FIELDS} more`]
              : []),
          ],
        }
      : {}),
    counts,
    ...(warnings.length
      ? {
          warning: `${warnings.length} block(s) excluded from the fields above (unrecognized blockType): ${warnings.join("; ")}`,
        }
      : {}),
    hint: 'Every field above names the tool that writes it in `editWith` - use that tool, do not infer from the field name. setValues({ edits: [{ ref, value }, ...] }) writes any number of non-richText fields in ONE call - plain text, and structured values (checkbox/select/number/date/relationship/upload/point/json), which are usually NOT translated: leave them unless asked. A richText field is read with viewRichText({ ref, mode }) and written with applyRichText({ ref, mode, ... }), one field per call. `structure` lists every blocks/array container with its items in order, by id - insertItem/moveItem/removeItem take those paths and ids; a container shows its first 80 items and then the number of the rest. `unset` lists the fields that hold no value yet, as "<ref> (<type>)": write a richText one with applyRichText and any other one with setValues, at exactly that ref. A select or radio field carries its `options`, a relationship or upload field its `relationTo`, and `hasMany` means the value is an array: setValues `add` and `remove` change some of its entries and keep the rest. Fields marked "localized" store a separate value per locale; unmarked fields are shared across ALL locales. richText values are not inlined here.',
  };
}

export function createGetEditableContentTool(context: BlockToolsContext) {
  return tool({
    description:
      "Return EVERY editable field across the whole open document - all blocks, nested blocks, array rows and groups: each field that holds a value with its full (untruncated) value, a concrete ref, its TYPE, the values it accepts (`options`, `relationTo`, `hasMany`) and the tool that writes it; each field that holds no value yet under `unset`, with its ref and type; plus the document STRUCTURE: every blocks array and plain array with its items in order, by id. A read-only field is not listed: the agent does not write it. An editing session starts with one result of it already in the conversation, so you never miss a field, never guess a type, and have the ids that insertItem/moveItem/removeItem address. Call it again only after your edits changed the structure and you need the new refs and ids.",
    inputSchema: z.object({}),
    execute: () => getEditableContent(context),
  });
}
