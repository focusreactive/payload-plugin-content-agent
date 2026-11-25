import { isRecord } from "../../borders.js";
import { formatPath, getByPath, isObjectLike, parsePath, rowId } from "./discovery.js";
import type { Criterion } from "./outcomeInput.js";

export interface CriterionResult {
  criterion: Criterion;
  ok: boolean;
  detail?: string;
  deferred?: boolean;
}

export function scopeOf(doc: unknown, path?: string): unknown {
  if (!path) return doc;

  try {
    return getByPath(doc, parsePath(path));
  } catch {
    return undefined;
  }
}

export function checkItemRemoved(
  criterion: Criterion,
  before: unknown,
  after: unknown
): CriterionResult {
  const ref = criterion.path ?? "";

  if (scopeOf(before, ref) === undefined)
    return {
      criterion,
      ok: false,
      detail: `No item was at "${ref}" when the document was opened. Take the ref from \`structure\` in getEditableContent (the path of the container, then the id of the item in brackets) and declare again.`,
    };

  return scopeOf(after, ref) === undefined
    ? { criterion, ok: true, detail: `The item at "${ref}" is gone.` }
    : {
        criterion,
        ok: false,
        detail: `The item at "${ref}" is still in the document. Remove it with removeItem.`,
      };
}

export function checkItemsAdded(
  criterion: Criterion,
  wanted: number,
  scopeBefore: unknown,
  scopeAfter: unknown
): CriterionResult {
  const ref = criterion.path ?? "";

  if (!Array.isArray(scopeAfter))
    return {
      criterion,
      ok: false,
      detail: `"${ref}" is not a blocks or array field. Take the path of the container from \`structure\` in getEditableContent and declare again.`,
    };

  const from = Array.isArray(scopeBefore) ? scopeBefore.length : 0;
  const added = scopeAfter.length - from;

  return added === wanted
    ? { criterion, ok: true, detail: `"${ref}" went from ${from} to ${scopeAfter.length} item(s).` }
    : {
        criterion,
        ok: false,
        detail: `"${ref}" has ${scopeAfter.length} item(s) against ${from} before, and exactly ${wanted} new one(s) were declared. Add a new item with insertItem, then fill it, and leave the existing items as they were.`,
      };
}

const sameRef = (ref: string): string => formatPath(parsePath(ref));

/** Once the editor declared the items the task removes, only those may go. */
export function removalRefusal(
  { criteria }: { criteria: Criterion[] },
  item: unknown,
  path: string
): string | null {
  const declared = criteria.flatMap(({ path: ref, check }) =>
    check.type === "itemRemoved" && ref ? [sameRef(ref)] : []
  );
  const ref = sameRef(`${path}[${rowId(item)}]`);

  if (!declared.length || declared.includes(ref)) return null;
  const row = isObjectLike(item) ? item : {};
  const label = typeof row.blockName === "string" ? row.blockName : "";

  return (
    `Refused: ${row.blockType ?? "item"} "${ref}"${label ? ` ("${label}")` : ""} is not one of the items declared for removal (${declared.map((entry) => `"${entry}"`).join(", ")}). ` +
    `Remove only what the task asks to remove. If the task also removes this item, call declareOutcome again with an "itemRemoved" criterion for "${ref}" next to the criteria already declared, then call removeItem again.`
  );
}

export function containerProblems(criteria: Criterion[], document: unknown): string[] {
  const containers = isRecord(document)
    ? Object.keys(document).filter((key) => Array.isArray(document[key]))
    : [];
  const valid = containers.length
    ? `The blocks and array fields of this document: ${containers.join(", ")}.`
    : "This document has no blocks or array field at its top level.";

  return criteria.flatMap(({ path, check }) => {
    if (check.type !== "itemsAdded") return [];
    const scope = scopeOf(document, path);

    return scope === undefined || scope === null || Array.isArray(scope)
      ? []
      : [
          `itemsAdded at "${path}": "${path}" is not a blocks or array field, so no item can be added to it. ${valid} For text added to a field, declare "present" with the text.`,
        ];
  });
}

/** A path that is no field or item of the document: the criterion could only fail at the end. */
export function pathProblems(
  criteria: Criterion[],
  document: unknown,
  resolves: (path: string) => boolean
): string[] {
  return criteria.flatMap(({ path, check }) =>
    !path || check.type === "itemRemoved" || resolves(path) || scopeOf(document, path) !== undefined
      ? []
      : [
          `${check.type} at "${path}": "${path}" is not a field or an item of this document. Take the ref from getEditableContent: a field of its list, or a \`path\` of \`structure\` with the id of the item in brackets.`,
        ]
  );
}
