import { z } from "zod";
import { tool } from "ai";
import type { DocFields } from "../../../borders.js";
import type { SchemaField } from "../../../types.js";
import { isObjectLike, parsePath, rowId } from "../discovery.js";
import { buildBlockSkeleton, buildRowSkeleton, validateFieldValue } from "../schemaValues.js";
import { itemNotFoundError } from "../../toolErrors.js";
import { resolveContainer } from "./containers.js";
import type { BlockToolsContext } from "./containers.js";
import { EDITOR_ADVICE } from "../editAdvice.js";
import type { EditAdvice } from "../editAdvice.js";

function headlineOf(item: unknown, fields: SchemaField[]): string {
  const first = fields.find((field) => field.type === "text" && !field.hasMany);
  const value = first && isObjectLike(item) ? item[first.name] : undefined;

  return typeof value === "string" ? value.trim() : "";
}

function sameHeadline(a: unknown, b: unknown, fields: SchemaField[]): boolean {
  const left = headlineOf(a, fields).toLowerCase().replace(/\s+/gu, " "),
    right = headlineOf(b, fields).toLowerCase().replace(/\s+/gu, " ");

  return left.length > 0 && left === right;
}

function nestedRichText(field: SchemaField, value: unknown, path: string): string | null {
  if (field.type === "richText") return path;
  const rows = Array.isArray(value) ? value : [value];

  for (const row of rows) {
    if (!isObjectLike(row)) continue;
    const subFields =
      field.type === "blocks"
        ? (field.blocks?.find((block) => block.slug === row.blockType)?.fields ?? [])
        : (field.fields ?? []);

    for (const subField of subFields) {
      if (!(subField.name in row)) continue;
      const found = nestedRichText(subField, row[subField.name], `${path}.${subField.name}`);

      if (found) return found;
    }
  }

  return null;
}

function rowLimitError(field: SchemaField, path: string, count: number): string | null {
  return field.maxRows !== undefined && count >= field.maxRows
    ? `"${path}" holds ${count} item(s) and takes at most ${field.maxRows}. Remove one with removeItem first, or change an existing item with setValues.`
    : null;
}

function validateInitialFields(
  defFields: SchemaField[],
  fields: DocFields,
  what: string,
  advice: EditAdvice
): string | null {
  for (const [name, value] of Object.entries(fields)) {
    const fdef = defFields.find((field) => field.name === name);

    if (!fdef)
      return `${what} has no field "${name}". Fields: ${defFields.map((field) => field.name).join(", ")}`;
    const richText = nestedRichText(fdef, value, name);

    if (richText) return `"${richText}" is a richText field - ${advice.richTextField}`;
    const validation = validateFieldValue(fdef, value);

    if (!validation.ok) return validation.error ?? `"${name}" rejected by field validation`;
  }

  return null;
}

const insertItemInputSchema = z.object({
  path: z
    .string()
    .describe(
      'Path to the blocks array or plain array field, e.g. "<blocksField>" or "<blocksField>[<blockId>].<arrayField>".'
    ),
  blockType: z
    .string()
    .optional()
    .describe(
      "For a blocks array: the block slug to insert (must be allowed at this path). Omit for a plain array."
    ),
  fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Initial values of the item, keyed by field name: the fields of the block (inspectBlockSchema lists them) or of the array row. Each value has the format that setValues takes. Rows of an array inside the item are objects of its sub-fields; blocks inside it are objects with `blockType`. Leave rich text fields out and write them with applyRichText afterwards."
    ),
  afterId: z
    .string()
    .optional()
    .describe(
      "Insert immediately after the item with this id. The ids are in `structure` of getEditableContent."
    ),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Insert at this 0-based position; a number past the end puts the item last. Ignored if afterId is set."
    ),
  sameTitle: z
    .boolean()
    .optional()
    .describe(
      "Set true ONLY when the task really wants a second item with the same title as an existing one. Without it such an insert is refused as a duplicate."
    ),
});

type InsertItemInput = z.infer<typeof insertItemInputSchema>;

type BuiltItem = { built: true; item: DocFields } | { built: false; error: string };

function buildBlockItem(
  field: SchemaField,
  { path, blockType, fields = {} }: InsertItemInput,
  advice: EditAdvice
): BuiltItem {
  if (!blockType)
    return {
      built: false,
      error: `"${path}" is a blocks array - pass \`blockType\`. Allowed: ${(field.blocks ?? []).map((block) => block.slug).join(", ")}`,
    };
  const def = field.blocks?.find((block) => block.slug === blockType);

  if (!def)
    return {
      built: false,
      error: `Block "${blockType}" is not allowed at "${path}". Allowed: ${(field.blocks ?? []).map((block) => block.slug).join(", ")}`,
    };
  const bad = validateInitialFields(def.fields, fields, `Block "${blockType}"`, advice);

  if (bad) return { built: false, error: bad };

  return { built: true, item: buildBlockSkeleton(def, fields) };
}

function buildRowItem(
  field: SchemaField,
  { path, blockType, fields = {} }: InsertItemInput,
  advice: EditAdvice
): BuiltItem {
  if (blockType)
    return {
      built: false,
      error: `"${path}" is a plain array field, not a blocks array - omit \`blockType\`; its rows have the sub-fields ${(field.fields ?? []).map((subField) => subField.name).join(", ")}.`,
    };
  const rowFields = field.fields ?? [];
  const bad = validateInitialFields(rowFields, fields, "Array row", advice);

  if (bad) return { built: false, error: bad };

  return { built: true, item: buildRowSkeleton(rowFields, fields) };
}

async function insertItem(context: BlockToolsContext, input: InsertItemInput) {
  const { path, blockType, afterId, index, sameTitle } = input;
  const resolved = resolveContainer(context, parsePath(path), { create: true });

  if ("error" in resolved) return { error: resolved.error };
  const { field, array, kind } = resolved;
  const full = rowLimitError(field, path, array.length);

  if (full) return { error: full };

  const advice = context.guards.advice ?? EDITOR_ADVICE;
  const result =
    kind === "blocks" ? buildBlockItem(field, input, advice) : buildRowItem(field, input, advice);

  if (!result.built) return { error: result.error };
  const { item } = result;

  const itemFields =
    (kind === "blocks"
      ? field.blocks?.find((block) => block.slug === blockType)?.fields
      : field.fields) ?? [];
  const twin = sameTitle
    ? undefined
    : array.find(
        (existing) =>
          (kind !== "blocks" ||
            (isObjectLike(existing) ? existing.blockType : undefined) === blockType) &&
          sameHeadline(existing, item, itemFields)
      );

  if (isObjectLike(twin)) {
    return {
      error: `Not inserted: ${kind === "blocks" ? `a ${blockType} block` : "a row"} with the same title already exists at "${path}" [${twin.id}] ("${headlineOf(twin, itemFields)}"). ${advice.existingItem}`,
    };
  }

  let at = array.length;

  if (afterId) {
    const i = array.findIndex((row) => rowId(row) === String(afterId));

    if (i === -1) return { error: itemNotFoundError(afterId, path, array) };
    at = i + 1;
  } else if (typeof index === "number") {
    at = Math.max(0, Math.min(index, array.length));
  }

  array.splice(at, 0, item);
  const defaults = Object.fromEntries(
    Object.entries(item).filter(
      ([name]) => name !== "id" && name !== "blockType" && !(name in (input.fields ?? {}))
    )
  );

  return {
    ok: true,
    id: item.id,
    ...(kind === "blocks" ? { blockType } : {}),
    index: at,
    count: array.length,
    ...(Object.keys(defaults).length
      ? {
          defaults,
          note: "`defaults` are the required fields you did not send: they hold a placeholder value. Write the real values with setValues.",
        }
      : {}),
  };
}

export function createInsertItemTool(context: BlockToolsContext) {
  return tool({
    description:
      "Insert a new item into a container: a BLOCK into a blocks array (pass `blockType` - inspectBlockSchema shows its fields), or a ROW into a plain array field (no blockType; the row's sub-fields come from the schema). Initial field values are validated against the schema; richText sub-fields are set afterwards with applyRichText. Returns the new item id, and `defaults` when a required field you did not send got a placeholder value. Position defaults to the end; use afterId or index to place it. A container with a maximum number of items refuses an insert past it.",
    inputSchema: insertItemInputSchema,
    execute: (input) => insertItem(context, input),
  });
}
