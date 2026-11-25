import { isRecord } from "../../borders.js";
import type { DocFields } from "../../borders.js";
import type { SchemaField } from "../../types.js";

export interface RestoreVersions {
  /** The document before the first change of the conversation. */
  restore: DocFields;
  /** The document as the last change left it. `null` when that version was not stored. */
  after: DocFields | null;
  /** The document as it is now. */
  current: DocFields;
}

export interface RestorePlan {
  /** Top-level values to write. */
  patch: DocFields;
  restored: string[];
  /** Fields that do not hold the value the change left: someone changed them after it. */
  changedSince: string[];
}

function canonical(value: unknown, withIds: boolean): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonical(entry, withIds));
  if (!isRecord(value)) return value ?? null;

  // An empty value arrives as `null` from one read and as no key from another.
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] != null && (withIds || key !== "id"))
      .sort()
      .map((key) => [key, canonical(value[key], withIds)])
  );
}

const same = (left: unknown, right: unknown, withIds = true): boolean =>
  JSON.stringify(canonical(left, withIds)) === JSON.stringify(canonical(right, withIds));

const writable = (field: SchemaField): boolean =>
  Boolean(field.name) && !field.readOnly && field.type !== "join";

/**
 * What a discard writes. A field goes back to its stored value when it still holds what the
 * change left. A field that holds something else was changed after it and is kept, unless
 * `force` is set. The CMS gives a new row its id at the save, so row ids do not count there.
 */
export function planRestore(
  fields: SchemaField[],
  { restore, after, current }: RestoreVersions,
  force = false
): RestorePlan {
  const plan: RestorePlan = { patch: {}, restored: [], changedSince: [] };

  for (const { name } of fields.filter(writable)) {
    if (after && same(restore[name], after[name])) continue;
    if (same(current[name], restore[name])) continue;

    if (force || (after && same(current[name], after[name], false))) {
      plan.patch[name] = restore[name] ?? null;
      plan.restored.push(name);
    } else plan.changedSince.push(name);
  }

  return plan;
}
