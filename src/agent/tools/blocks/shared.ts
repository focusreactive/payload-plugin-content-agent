import type { SchemaField } from "../../../types.js";
import { fieldsThroughGroups } from "../../../schema/fieldPaths.js";
import type { FieldAtPath } from "../../../schema/fieldPaths.js";

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function blocksFields(fields: SchemaField[]): FieldAtPath[] {
  return fieldsThroughGroups(
    fields,
    (field) => field.type === "blocks" && !field.readOnly,
    (group) => !group.readOnly
  );
}

export type BlocksFieldPick = { error: string } | { error?: undefined; at: FieldAtPath };

export function pickBlocksField(
  fields: SchemaField[],
  label: string,
  wanted: { param: string; path?: string }
): BlocksFieldPick {
  const all = blocksFields(fields);

  if (!all.length) return { error: `"${label}" has no blocks field.` };
  const at = wanted.path
    ? all.find((candidate) => candidate.path === wanted.path)
    : all.length === 1
      ? all[0]
      : undefined;

  if (at) return { at };
  const paths = all.map((candidate) => candidate.path).join(", ");

  return {
    error: wanted.path
      ? `"${wanted.path}" is not a blocks field of "${label}". Pass \`${wanted.param}\` as one of: ${paths}`
      : `"${label}" has several blocks fields. Pass \`${wanted.param}\` as one of: ${paths}`,
  };
}
