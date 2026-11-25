import { z } from "zod";
import { tool } from "ai";
import type { SchemaField } from "../../../types.js";
import { parsePath, resolveFieldAtPath } from "../discovery.js";
import { isOpen, rootFields } from "./containers.js";
import type { BlockToolsContext } from "./containers.js";
import { NO_OPEN_DOCUMENT } from "../noOpenDocument.js";

export interface FieldInfo {
  name: string;
  type: string;
  required: boolean;
  [key: string]: unknown;
}

function describeField(field: SchemaField): FieldInfo {
  // The injected `id` of a block or a row is its address, not a field to write.
  const readOnly = field.readOnly || (field.name === "id" && field.type === "text");

  return {
    name: field.name,
    type: field.type,
    required: !!field.required,
    ...(readOnly ? { readOnly: true } : {}),
    ...(field.unsupported ? { unsupported: true } : {}),
    ...(field.hasMany ? { hasMany: true } : {}),
    ...(field.localized ? { localized: true } : {}),
    ...(field.conditional ? { conditional: true } : {}),
    ...(field.description ? { description: field.description } : {}),
    ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
    ...(field.options
      ? {
          options: field.options.map((option) =>
            typeof option === "string" ? option : option.value
          ),
        }
      : {}),
    ...(field.relationTo ? { relationTo: field.relationTo } : {}),
    ...(field.minRows !== undefined || field.maxRows !== undefined
      ? { rows: { min: field.minRows, max: field.maxRows } }
      : {}),
    ...(field.blocks ? { nestedBlocks: field.blocks.map((block) => block.slug) } : {}),
    ...((field.type === "group" || field.type === "array") && field.fields?.length
      ? { fields: field.fields.map(describeField) }
      : {}),
  };
}

async function inspectBlockSchema(
  context: BlockToolsContext,
  { path, blockType }: { path: string; blockType: string }
) {
  if (!isOpen(context)) return { error: NO_OPEN_DOCUMENT };
  const res = resolveFieldAtPath(
    rootFields(context),
    context.workspace.ref.current,
    parsePath(path)
  );

  const kind = res?.field?.type;

  if (!res?.field || (kind !== "blocks" && kind !== "richText"))
    return {
      error: `Path "${path}" is not a blocks field or a rich text field with blocks (${kind ?? "not found"}). Copy the path of a blocks field from \`structure\` of getEditableContent, or the ref of a richText field.`,
    };
  const defs = [...(res.field.blocks ?? []), ...(res.field.inlineBlocks ?? [])];
  const def = defs.find((block) => block.slug === blockType);

  if (!def)
    return {
      error: `Block "${blockType}" is not allowed at "${path}". Allowed: ${defs.map((block) => block.slug).join(", ") || "none"}`,
    };
  const fields = def.fields.map(describeField);

  return {
    blockType,
    ...(def.label ? { label: def.label } : {}),
    ...(def.description ? { description: def.description } : {}),
    ...(def.group ? { group: def.group } : {}),
    fields,
  };
}

export function createInspectBlockSchemaTool(context: BlockToolsContext) {
  return tool({
    description:
      "Inspect the field schema of a block type so you know what fields to fill. Pass the blockType and the path to the blocks array that allows it, or the ref of a rich text field that embeds it. Each field comes with its type, `required`, the values it accepts (`options`, `relationTo`, `hasMany`), the row limits of an array (`rows`), the fields of a group or an array row (`fields`), and `readOnly` or `unsupported` for a field the agent does not write.",
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "Path to the blocks field (a `path` from `structure` of getEditableContent), or the ref of a rich text field that embeds blocks."
        ),
      blockType: z
        .string()
        .describe(
          "The block slug to inspect: one of `allowedBlocks` of that path in `structure`, or one of the blocks the schema lists for the rich text field."
        ),
    }),
    execute: (input: { path: string; blockType: string }) => inspectBlockSchema(context, input),
  });
}
