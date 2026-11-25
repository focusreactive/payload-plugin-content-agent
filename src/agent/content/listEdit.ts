import { isObjectLike } from "./discovery.js";

/** Entries to put into and take out of a list with many values; every other entry stays. */
export interface ListEdit {
  add?: unknown[];
  remove?: unknown[];
}

const idOf = (value: unknown): string =>
  isObjectLike(value) && value.id !== undefined ? String(value.id) : String(value);

// A list entry by what it holds: a value, an id, or a collection and an id.
const entryKey = (entry: unknown): string =>
  isObjectLike(entry) && "relationTo" in entry
    ? `${String(entry.relationTo)}:${idOf(entry.value)}`
    : idOf(entry);

/** The list at `ref` after `edit`: `remove` takes entries out, `add` puts new ones at the end. */
export function changedList(
  ref: string,
  current: unknown,
  edit: ListEdit
): { value: unknown[] } | { error: string } {
  const list = Array.isArray(current) ? current : [];
  const held = new Set(list.map(entryKey));
  const missing = (edit.remove ?? []).filter((entry) => !held.has(entryKey(entry)));

  if (missing.length)
    return {
      error: `"${ref}" holds no ${JSON.stringify(missing)} to remove. It holds ${JSON.stringify(list)}.`,
    };
  const removed = new Set((edit.remove ?? []).map(entryKey));
  const next = list.filter((entry) => !removed.has(entryKey(entry)));
  const keys = new Set(next.map(entryKey));

  for (const entry of edit.add ?? []) {
    if (keys.has(entryKey(entry))) continue;
    keys.add(entryKey(entry));
    next.push(entry);
  }

  return { value: next };
}
