import type { PayloadDoc } from "../../../borders.js";
import type { SchemaContext, SchemaField } from "../../../types.js";
import { formatPath, getByPath, resolveFieldAtPath, setByPath } from "../discovery.js";
import type { Path } from "../discovery.js";
import { NO_OPEN_DOCUMENT } from "../noOpenDocument.js";
import { sharedFieldRefusal } from "../sharedField.js";
import type { EditAdvice } from "../editAdvice.js";

export interface DocumentWorkspace {
  ref: { current: PayloadDoc | null };
  collection: string | null;
  global?: string | null;
  original?: PayloadDoc;
  locale?: string;
  readLocale?: string;
  /** The document in the write locale at the open, when it is not the read locale. */
  writeBaseline?: PayloadDoc;
  /** What a locale other than the default stores, without the values its fallback lends. */
  ownValues?: PayloadDoc;
}

export interface BlockToolGuards {
  remove?: (item: unknown, path: string) => string | null;
  /** Read at each check: the editor can declare a shorter text after the session opened. */
  shrinkRatio?: () => number | null;
  /** The next-step sentences, when the tools run for another caller than the content editor. */
  advice?: EditAdvice;
}

export interface BlockToolsContext {
  workspace: DocumentWorkspace;
  schema: SchemaContext;
  guards: BlockToolGuards;
}

export const rootFields = ({ workspace, schema }: BlockToolsContext): SchemaField[] =>
  workspace.global
    ? (schema.globals.find((global) => global.slug === workspace.global)?.fields ?? [])
    : (schema.collections.find((collection) => collection.slug === workspace.collection)?.fields ??
      []);

export const isOpen = ({ workspace }: BlockToolsContext) =>
  (!!workspace.collection || !!workspace.global) && workspace.ref.current != null;
const targetLabel = ({ workspace }: BlockToolsContext) => workspace.global ?? workspace.collection;

export function resolveContainer(
  context: BlockToolsContext,
  path: Path,
  { create = false }: { create?: boolean } = {}
): { field: SchemaField; array: unknown[]; kind: "blocks" | "array" } | { error: string } {
  const { workspace } = context;

  if (!isOpen(context)) return { error: NO_OPEN_DOCUMENT };

  const res = resolveFieldAtPath(rootFields(context), workspace.ref.current, path);

  if (!res)
    return {
      error: `Path "${formatPath(path)}" does not exist in the ${targetLabel(context)} schema. Copy the path from getEditableContent.`,
    };
  const kind = res.field?.type;

  if (kind !== "blocks" && kind !== "array")
    return {
      error: `Path "${formatPath(path)}" is a ${kind ?? "unknown"} field, not a blocks or array field - items can only be inserted, moved or removed inside those.`,
    };

  if (res.readOnly)
    return {
      error: `"${formatPath(path)}" is read-only: the agent does not add, move or remove its items. Say so in your summary.`,
    };

  const shared = sharedFieldRefusal(workspace, formatPath(path), res.localized);

  if (shared) return { error: shared };

  let array = getByPath(workspace.ref.current, path);

  if (array == null && create) {
    setByPath(workspace.ref.current, path, []);
    array = getByPath(workspace.ref.current, path);
  }

  if (!Array.isArray(array))
    return {
      error: `"${formatPath(path)}" has no items yet, so there is nothing to move or remove. Add the first one with insertItem({ path: "${formatPath(path)}" }).`,
    };

  return { field: res.field!, array, kind };
}
