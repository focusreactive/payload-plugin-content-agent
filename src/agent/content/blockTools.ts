import type { SchemaContext, SchemaField } from "../../types.js";
import { isObjectLike } from "./discovery.js";
import type { BlockToolGuards, BlockToolsContext, DocumentWorkspace } from "./blocks/containers.js";
import { createGetEditableContentTool } from "./blocks/getEditableContent.js";
import { createInsertItemTool } from "./blocks/insertItem.js";
import { createInspectBlockSchemaTool } from "./blocks/inspectBlockSchema.js";
import { createMoveItemTool } from "./blocks/moveItem.js";
import { createRemoveItemTool } from "./blocks/removeItem.js";
import { createSetValuesTool } from "./blocks/setValues.js";

export type { BlockToolGuards, DocumentWorkspace };

const MAX_REF_IDS = 20;

export function previewRefValue(field: SchemaField, value: unknown): string | null {
  if (field.type !== "relationship" && field.type !== "upload") return null;
  if (value === null || value === undefined || value === "") return null;

  const one = (reference: unknown): string => {
    if (isObjectLike(reference)) {
      if ("relationTo" in reference) return `${reference.relationTo}:${one(reference.value)}`;
      if ("id" in reference) return String(reference.id);

      return "?";
    }

    return String(reference);
  };

  const to = typeof field.relationTo === "string" ? `${field.relationTo} ` : "";

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const shown = value.slice(0, MAX_REF_IDS).map(one);
    const more = value.length - shown.length;

    return `→ ${to}[${shown.join(", ")}${more > 0 ? `, … +${more} more` : ""}]`;
  }

  return `→ ${to}${one(value)}`;
}

export function previewValue(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "string")
    return value.length > 60 ? `"${value.slice(0, 60)}…"` : `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isObjectLike(value) && isObjectLike(value.root) && value.root.children) return "[rich text]";

  if (Array.isArray(value)) {
    const first: unknown = value[0];

    if (isObjectLike(first) && first.blockType) return `[${value.length} blocks]`;

    return `[${value.length} items]`;
  }

  if (typeof value === "object") return "{…}";

  return String(value);
}

export function createBlockTools(
  workspace: DocumentWorkspace,
  schema: SchemaContext,
  guards: BlockToolGuards = {}
) {
  const context: BlockToolsContext = { workspace, schema, guards };

  return {
    getEditableContent: createGetEditableContentTool(context),
    setValues: createSetValuesTool(context),
    inspectBlockSchema: createInspectBlockSchemaTool(context),
    insertItem: createInsertItemTool(context),
    moveItem: createMoveItemTool(context),
    removeItem: createRemoveItemTool(context),
  };
}
