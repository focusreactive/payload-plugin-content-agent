import type { SchemaContext } from "../types.js";
import { rowId } from "./content/discovery.js";

const MAX_LISTED_ITEMS = 40;

const listed = (label: string, names: string[]): string =>
  names.length ? ` ${label}: ${names.join(", ")}.` : "";

/** An unknown collection or global, with the names the project has. */
export function unknownTargetError(
  schema: SchemaContext,
  target: { collection?: string; global?: string }
): string {
  const named = target.global ? `global "${target.global}"` : `collection "${target.collection}"`;
  const collections = schema.collections.map((collection) => collection.slug);
  const globals = schema.globals.map((global) => global.slug);

  return `Unknown ${named}.${listed("Collections", collections)}${listed("Globals", globals)}`;
}

/** Keys of `data` that are not fields of the target, with the fields it has. */
export function unknownFieldsError(
  slug: string,
  fields: Array<{ name: string }>,
  data: Record<string, unknown>
): string | null {
  const unknown = Object.keys(data).filter((key) => !fields.some((field) => field.name === key));

  return unknown.length
    ? `"${slug}" has no field ${unknown.map((key) => `"${key}"`).join(", ")}, so \`data\` was not written. Its fields: ${fields.map((field) => field.name).join(", ")}. Send \`data\` with field names of the schema only.`
    : null;
}

/**
 * A document id that reads nothing. `label` is `<collection>/<id>`,
 * `nameSearch` the tool that finds a document by name.
 */
export function documentNotFoundError(label: string, nameSearch = "findDocuments"): string {
  return `${label} not found. Take the id from a listDocuments or ${nameSearch} result.`;
}

/** An item id that is not in the array, with the ids that are. */
export function itemNotFoundError(id: unknown, path: string, rows: unknown[]): string {
  const ids = rows.map(rowId).filter(Boolean);
  const shown = ids.slice(0, MAX_LISTED_ITEMS).join(", ");
  const more = ids.length > MAX_LISTED_ITEMS ? ` and ${ids.length - MAX_LISTED_ITEMS} more` : "";

  return ids.length
    ? `No item with id "${id}" at "${path}". The ids there: ${shown}${more}.`
    : `No item with id "${id}" at "${path}": it has no items.`;
}
