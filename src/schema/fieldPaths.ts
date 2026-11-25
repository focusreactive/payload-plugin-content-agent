import { isRecord } from "../borders.js";
import type { SchemaField } from "../types.js";

export interface FieldAtPath {
  path: string;
  field: SchemaField;
}

/**
 * Every field that matches, at the top level and inside groups (a named tab is a group).
 * The path is dotted and holds no item id: fields inside an array row or a block are not listed.
 * `enters` limits the groups that are walked into.
 */
export function fieldsThroughGroups(
  fields: SchemaField[],
  matches: (field: SchemaField) => boolean,
  enters: (group: SchemaField) => boolean = () => true
): FieldAtPath[] {
  const walk = (list: SchemaField[], prefix: string): FieldAtPath[] =>
    list.flatMap((field) => {
      if (!field.name) return [];
      const path = `${prefix}${field.name}`;

      if (matches(field)) return [{ path, field }];
      if (field.type !== "group" || !field.fields || !enters(field)) return [];

      return walk(field.fields, `${path}.`);
    });

  return walk(fields, "");
}

export function valueAtPath(doc: unknown, path: string): unknown {
  let current = doc;

  for (const key of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }

  return current;
}

/** The top-level patch that sets `value` at `path` and keeps the rest of the group it sits in. */
export function patchAtPath(doc: unknown, path: string, value: unknown): Record<string, unknown> {
  const [top, ...rest] = path.split(".");

  if (!rest.length) return { [top]: value };
  const existing = isRecord(doc) ? doc[top] : undefined;
  const root: Record<string, unknown> = isRecord(existing) ? structuredClone(existing) : {};
  let current = root;

  for (const key of rest.slice(0, -1)) {
    const child = current[key];
    const next: Record<string, unknown> = isRecord(child) ? child : {};

    current[key] = next;
    current = next;
  }

  current[rest[rest.length - 1]] = value;

  return { [top]: root };
}
