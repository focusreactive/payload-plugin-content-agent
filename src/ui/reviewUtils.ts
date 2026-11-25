import { isRecord, isText, recordsOf } from "./lib/narrow.js";
import type { Text } from "./lib/narrow.js";

export interface EditedRef {
  collection: string;
  id: string | number;
}

export const keyOf = (ref: EditedRef) => `${ref.collection}:${ref.id}`;

/** The changes a person can still review: a discarded document has none left. */
export const standingRefs = (refs: EditedRef[], discardedKeys: Set<string>): EditedRef[] =>
  refs.filter((ref) => !discardedKeys.has(keyOf(ref)));

const hasRealId = (id: unknown): id is Text => isText(id) && String(id).trim() !== "";

export function dedupMerge(base: EditedRef[], extra: EditedRef[]): EditedRef[] {
  const seen = new Set(base.map(keyOf));
  const add: EditedRef[] = [];

  for (const ref of extra) {
    if (!ref.collection || !hasRealId(ref.id)) continue;
    const key = keyOf(ref);

    if (seen.has(key)) continue;
    seen.add(key);
    add.push(ref);
  }

  return add.length ? [...base, ...add] : base;
}

export function extractEditedRefs(data: unknown): EditedRef[] {
  if (!isRecord(data)) return [];
  const { collection } = data;

  if (typeof collection !== "string" || !collection) return [];

  if (Array.isArray(data.results)) {
    return recordsOf(data.results).flatMap((result) =>
      hasRealId(result.id) && (result.status === "done" || result.status === undefined)
        ? [{ collection, id: result.id }]
        : []
    );
  }

  // A single op reports phase 'done' even when it was rejected or failed,
  // and nothing was saved then.
  if (
    hasRealId(data.id) &&
    data.phase === "done" &&
    (data.status === "done" || data.status === undefined)
  ) {
    return [{ collection, id: data.id }];
  }

  return [];
}
