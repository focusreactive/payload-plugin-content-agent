import type { SchemaCollection } from "../types.js";
import { titleFieldOf } from "./titleField.js";

type Doc = Record<string, unknown> | null | undefined;

/**
 * The title of a document: the value of the field its collection shows as the title.
 * @beta
 */
export function docLabel(
  doc: Record<string, unknown> | null | undefined,
  collection: SchemaCollection | undefined
): string | undefined {
  const field = collection ? titleFieldOf(collection) : undefined;
  const value = field ? doc?.[field] : undefined;

  if (typeof value === "number") return String(value);

  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

const isKey = (type: string): boolean => type === "text" || type === "email";

export function keyFields(collection: SchemaCollection): string[] {
  return collection.fields
    .filter((field) => field.unique && !field.hasMany && isKey(field.type))
    .map((field) => field.name);
}

export function docKeys(
  doc: Doc,
  collection: SchemaCollection | undefined
): Record<string, string> {
  const keys: Record<string, string> = {};

  if (!collection) return keys;
  const titleField = titleFieldOf(collection);

  for (const name of keyFields(collection)) {
    const value = doc?.[name];

    if (name !== titleField && typeof value === "string" && value !== "") keys[name] = value;
  }

  return keys;
}

/** The fields that `docLabel` and `docKeys` read, and the draft status: all a list row needs. */
export function labelSelect(collection: SchemaCollection): Record<string, true> {
  const title = titleFieldOf(collection);

  return {
    id: true,
    ...(title ? { [title]: true } : {}),
    ...Object.fromEntries(keyFields(collection).map((name) => [name, true] as const)),
    ...(collection.hasDrafts ? { _status: true } : {}),
  };
}
