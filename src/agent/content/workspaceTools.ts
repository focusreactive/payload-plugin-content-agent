import { z } from "zod";
import { tool } from "ai";
import type { PayloadDoc } from "../../borders.js";
import type { SchemaContext, SchemaField } from "../../types.js";
import type { DocumentWorkspace } from "./blockTools.js";
import { concurrentEditRefusal } from "./concurrentEdit.js";
import type { DocumentIO, DocTarget } from "./documentIo.js";
import { bodyHint } from "./bodyHint.js";
import {
  isObjectLike,
  resolveBlockDef,
  findContentSlots,
  getByPath,
  setByPath,
  parsePath,
  resolveFieldAtPath,
  collectContentFields,
} from "./discovery.js";
import type { ContentLeaf } from "./discovery.js";
import { buildChangedFields, ensureNonEmptyRichText } from "./schemaValues.js";
import { NO_OPEN_DOCUMENT } from "./noOpenDocument.js";
import { WORKSPACE_SAVE_ID } from "../tools/writeIds.js";

export function fieldsForTarget(schema: SchemaContext, target: DocTarget): SchemaField[] {
  if (target.global)
    return schema.globals.find((global) => global.slug === target.global)?.fields ?? [];

  return (
    schema.collections.find((collection) => collection.slug === target.collection)?.fields ?? []
  );
}

/** True when a ref is a field or an item of the open document by the schema of its target. */
export const refResolves =
  (schema: SchemaContext, target: DocTarget, workspace: DocumentWorkspace) =>
  (ref: string): boolean =>
    resolveFieldAtPath(fieldsForTarget(schema, target), workspace.ref.current, parsePath(ref)) !==
    null;

function hasRichTextContent(value: unknown): boolean {
  const root = isObjectLike(value) ? value.root : undefined;
  const children = isObjectLike(root) ? root.children : undefined;

  return Array.isArray(children) && children.length > 0;
}

function documentOverview(schema: SchemaContext, target: DocTarget, doc: unknown) {
  const fields = fieldsForTarget(schema, target);
  const slots = findContentSlots(fields);

  return slots
    .filter((slot) => !slot.schemaPath.includes("[]"))
    .map((slot) => {
      const val = getByPath(doc, parsePath(slot.schemaPath));

      if (slot.kind === "blocks") {
        return {
          path: slot.schemaPath,
          kind: "blocks",
          count: Array.isArray(val) ? val.length : 0,
          allowedBlocks: (slot.field.blocks ?? []).map((block) => block.slug),
        };
      }

      return { path: slot.schemaPath, kind: "richText", hasContent: hasRichTextContent(val) };
    });
}

// Payload stores a non-localized array or blocks container once for all locales: its row set and
// order must match the original document.
function restoreSharedContainerStructure(
  fields: SchemaField[],
  original: unknown,
  doc: unknown
): void {
  if (!isObjectLike(doc) || !isObjectLike(original)) return;

  for (const field of fields) {
    if (!field.name || field.localized) continue;
    const origVal = original[field.name];
    const curVal = doc[field.name];

    if (field.type === "group") {
      if (origVal && typeof origVal === "object" && curVal && typeof curVal === "object") {
        restoreSharedContainerStructure(field.fields ?? [], origVal, curVal);
      }
    } else if (
      (field.type === "array" || field.type === "blocks") &&
      Array.isArray(origVal) &&
      Array.isArray(curVal)
    ) {
      const curById = new Map(
        curVal
          .filter(
            (row: unknown): row is Record<string, unknown> => isObjectLike(row) && row.id != null
          )
          .map((row) => [String(row.id), row])
      );

      doc[field.name] = origVal.map((origRow: unknown) => {
        const row: unknown =
          (isObjectLike(origRow) && origRow.id != null && curById.get(String(origRow.id))) ||
          origRow;

        if (field.type === "blocks") {
          const def = resolveBlockDef(field, origRow);

          if (def) restoreSharedContainerStructure(def.fields, origRow, row);
        } else if (field.fields?.length) {
          restoreSharedContainerStructure(field.fields, origRow, row);
        }

        return row;
      });
    }
  }
}

interface WorkspaceToolsContext {
  workspace: DocumentWorkspace;
  io: DocumentIO;
  schema: SchemaContext;
}

const openDocumentInputSchema = z.object({
  collection: z
    .string()
    .optional()
    .describe("Collection slug. Provide together with `id`. Omit when opening a global."),
  global: z
    .string()
    .optional()
    .describe(
      "Global slug. Globals are singletons - no id. Provide EITHER `global` OR `collection`+`id`."
    ),
  id: z.string().optional().describe("Document id (required with `collection`)."),
  locale: z
    .string()
    .optional()
    .describe(
      "Locale to READ the document in. Localized fields are returned in this locale. Omit for the default locale."
    ),
  writeLocale: z
    .string()
    .optional()
    .describe(
      "Locale to SAVE to (defaults to `locale`). Set DIFFERENT from `locale` only for translation - read the source locale, write the target. Then the minimal patch diffs source-vs-translated and writes localized fields to the target locale."
    ),
});

/** An edit of a locale other than the default, not a translation: the editor sees what the
 * locale shows, its fallback values too, and the save writes back only what the locale stores. */
const editsOtherLocale = (schema: SchemaContext, locale?: string, writeLocale?: string) =>
  !!locale &&
  !!schema.defaultLocale &&
  locale !== schema.defaultLocale &&
  (writeLocale ?? locale) === locale;

/** The document in the locale a translation writes, as it is at the open. */
async function writeBaseline(
  io: DocumentIO,
  target: DocTarget,
  { id, locale, writeLocale }: { id?: string; locale?: string; writeLocale?: string }
): Promise<PayloadDoc | undefined> {
  if (!writeLocale || writeLocale === locale) return undefined;
  const { doc } = await io.read(target, {
    id,
    locale: writeLocale,
    fallbackLocale: false,
    callId: "ws-open",
  });

  return doc ?? undefined;
}

async function ownValues(
  io: DocumentIO,
  schema: SchemaContext,
  target: DocTarget,
  { id, locale, writeLocale }: { id?: string; locale?: string; writeLocale?: string }
): Promise<PayloadDoc | undefined> {
  if (!editsOtherLocale(schema, locale, writeLocale)) return undefined;
  const { doc } = await io.read(target, { id, locale, fallbackLocale: false, callId: "ws-open" });

  return doc ?? undefined;
}

async function openDocument(
  { workspace, io, schema }: WorkspaceToolsContext,
  { collection, global, id, locale, writeLocale }: z.infer<typeof openDocumentInputSchema>
) {
  if (!!collection === !!global)
    return { error: "Provide exactly ONE of `collection` (+ `id`) or `global`." };
  if (collection && !id)
    return { error: "An `id` is required when opening a collection document." };
  const target: DocTarget = global ? { global } : { collection };

  try {
    const { doc, error } = await io.read(target, { id, locale, callId: "ws-open" });

    if (error) return { error };
    if (!doc || (collection && !doc.id))
      return { error: `Document ${global ?? `${collection}/${id}`} not found` };
    workspace.ref.current = doc;
    workspace.collection = collection ?? null;
    workspace.global = global ?? null;
    workspace.locale = writeLocale ?? locale;
    workspace.readLocale = locale;
    workspace.original = structuredClone(doc);
    workspace.writeBaseline = await writeBaseline(io, target, { id, locale, writeLocale });
    workspace.ownValues = await ownValues(io, schema, target, { id, locale, writeLocale });
    const body = bodyHint(fieldsForTarget(schema, target), doc);

    return {
      ok: true,
      ...(global ? { global } : { collection, id: doc.id }),
      ...(locale ? { locale } : {}),
      content: documentOverview(schema, target, doc),
      ...(body ? { body } : {}),
    };
  } catch (err) {
    return {
      error: `Failed to open ${global ?? `${collection}/${id}`}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Saving to another locale: a changed non-localized field would overwrite every locale, so
// such leaves are reverted to their original value first.
function revertSharedFields(
  workspace: DocumentWorkspace,
  fields: SchemaField[],
  leaves: ContentLeaf[]
): number {
  const doc = workspace.ref.current;
  let revertedShared = 0;

  if (workspace.readLocale !== workspace.locale) {
    const originalRefs = new Set(
      collectContentFields(fields, workspace.original ?? {}).map((leaf) => leaf.ref)
    );

    for (const leaf of leaves) {
      if (leaf.localized || !originalRefs.has(leaf.ref)) continue;
      const path = parsePath(leaf.ref);
      const origVal = getByPath(workspace.original, path);

      if (JSON.stringify(getByPath(doc, path)) !== JSON.stringify(origVal)) {
        setByPath(doc, path, origVal);
        revertedShared += 1;
      }
    }

    restoreSharedContainerStructure(fields, workspace.original ?? {}, doc);
  }

  return revertedShared;
}

/** A localized value the editor left as it was shown goes back as the locale stores it: the view
 * shows values the fallback locale lends, and they must not become this locale's own. */
function keepOwnValues(
  workspace: DocumentWorkspace,
  fields: SchemaField[],
  patch: Record<string, unknown>
): void {
  const own = workspace.ownValues;

  if (!own) return;
  for (const key of Object.keys(patch)) patch[key] = structuredClone(patch[key]);

  for (const leaf of collectContentFields(fields, patch)) {
    if (!leaf.localized) continue;
    const path = parsePath(leaf.ref);
    const shown = getByPath(workspace.original, path);

    if (JSON.stringify(getByPath(patch, path)) === JSON.stringify(shown))
      setByPath(patch, path, getByPath(own, path) ?? null);
  }
}

async function saveDocument({ workspace, io, schema }: WorkspaceToolsContext) {
  if ((!workspace.collection && !workspace.global) || workspace.ref.current == null)
    return { error: NO_OPEN_DOCUMENT };
  const target: DocTarget = workspace.global
    ? { global: workspace.global }
    : { collection: workspace.collection! };
  const doc = workspace.ref.current;
  const fields = fieldsForTarget(schema, target);
  const leaves = collectContentFields(fields, doc);
  const revertedShared = revertSharedFields(workspace, fields, leaves);

  for (const leaf of leaves) {
    if (leaf.richText) ensureNonEmptyRichText(getByPath(doc, parsePath(leaf.ref)));
  }

  const { patch, changed } = buildChangedFields(workspace.original ?? {}, doc);

  keepOwnValues(workspace, fields, patch);

  // Nothing to save is an error on purpose: an `ok` here reads as finished work on an
  // unchanged document.
  if (changed.length === 0)
    return {
      error: revertedShared
        ? `Nothing was written: the only ${revertedShared} field(s) you changed are shared across every locale, ` +
          `not localized, so saving them under "${workspace.locale}" would have overwritten them for all locales - ` +
          "they were taken back. Report that this document has no localized content to change; do not report a translation."
        : "Nothing was written: the document is byte-identical to the one you opened. " +
          "Your edits either never applied or matched nothing in the content. Do NOT report this as done - " +
          "re-read the fields you meant to change, confirm the text you were looking for is actually there, " +
          "and either make the edit land or say plainly that the content does not need changing.",
      changed: [],
      ...(revertedShared ? { revertedShared } : {}),
    };
  // A translation writes another locale than it reads: a person's edit there is what it could
  // overwrite, so the check compares the write locale with its state at the open.
  const baseline = workspace.writeBaseline
    ? {
        original: workspace.writeBaseline,
        locale: workspace.locale,
        fallbackLocale: false as const,
      }
    : workspace.original && { original: workspace.original, locale: workspace.readLocale };
  const overwrite = baseline
    ? await concurrentEditRefusal(io, target, { ...baseline, fields: changed })
    : null;

  if (overwrite) return { error: overwrite };
  const { error } = await io.write(target, {
    id: doc.id,
    patch,
    locale: workspace.locale,
    callId: WORKSPACE_SAVE_ID,
  });

  if (error) return { error: `CMS rejected the save (no changes persisted): ${error}` };

  return {
    ok: true,
    ...(workspace.global
      ? { global: workspace.global }
      : { collection: workspace.collection, id: doc.id }),
    changed,
  };
}

export function createWorkspaceTools(
  workspace: DocumentWorkspace,
  io: DocumentIO,
  schema: SchemaContext
) {
  const context: WorkspaceToolsContext = { workspace, io, schema };

  return {
    openDocument: tool({
      description:
        "Open a document (or a global) into the editing workspace so you can edit its blocks. Returns an overview of its blocks/richText locations. Call this before any block tool.",
      inputSchema: openDocumentInputSchema,
      execute: (input) => openDocument(context, input),
    }),

    saveDocument: tool({
      description:
        "Save the open document back to the CMS as a draft, persisting all block edits. Call after finishing edits.",
      inputSchema: z.object({}),
      execute: () => saveDocument(context),
    }),
  };
}
