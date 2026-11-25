import { z } from "zod";
import { tool } from "ai";
import { withDocumentLock } from "../../content/documentLock.js";
import { isRecord } from "../../../borders.js";
import type { DocFields, PayloadDoc } from "../../../borders.js";
import type {
  EditRecordRef,
  SchemaCollection,
  SchemaContext,
  SchemaField,
} from "../../../types.js";
import { patchAtPath, valueAtPath } from "../../../schema/fieldPaths.js";
import type { FieldAtPath } from "../../../schema/fieldPaths.js";
import type { DocumentIO } from "../../content/documentIo.js";
import { isObjectLike, rowId } from "../../content/discovery.js";
import { documentOutline } from "../../content/outline.js";
import { healEmptyRichTextDeep } from "../../content/schemaValues.js";
import { documentNotFoundError, itemNotFoundError, unknownTargetError } from "../../toolErrors.js";
import { cloneFieldValue } from "../cloneDocument.js";
import { capMcpToolOutput } from "../outputCap.js";
import { COPY_BLOCK_WRITE_ID } from "../writeIds.js";
import { asArray, blocksFields, pickBlocksField } from "./shared.js";

type RecordEdits = (refs: EditRecordRef[]) => void;

const blockIdOf = (block: unknown): unknown => (isRecord(block) ? (block.id ?? null) : null);

const SETTING_TYPES = new Set(["checkbox", "select", "radio"]);

function inheritableSettings(
  fields: SchemaField[],
  source: DocFields,
  target: DocFields
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const field of fields) {
    if (!field.name || !SETTING_TYPES.has(field.type) || field.readOnly || field.unsupported)
      continue;
    const sourceValue = source?.[field.name];

    if (sourceValue === undefined || sourceValue === null) continue;
    const targetValue = target?.[field.name];
    const unset =
      targetValue === undefined ||
      targetValue === null ||
      (field.type === "checkbox" && targetValue === false && sourceValue === true);

    if (unset && JSON.stringify(sourceValue) !== JSON.stringify(targetValue))
      out[field.name] = sourceValue;
  }

  return out;
}

const blockPick = z.object({
  fromCollection: z
    .string()
    .optional()
    .describe("Collection of the source document. Defaults to toCollection."),
  fromId: z.union([z.string(), z.number()]).describe("Id of the source document."),
  blockId: z
    .string()
    .describe(
      'Id of the block to copy, from getBlockLibrary or readDocument({ view: "outline" }).'
    ),
  blockName: z.string().optional().describe("Optional admin label for the copied block."),
  fromPath: z
    .string()
    .optional()
    .describe("The blocks field of this source document. Omit when it has one."),
});

type BlockPick = z.infer<typeof blockPick>;

interface CopyContext {
  io: DocumentIO;
  schema: SchemaContext;
  recordEdits?: RecordEdits;
}

interface CopyInput {
  toCollection: string;
  toId: string | number;
  blocks?: BlockPick[];
  fromCollection?: string;
  fromId?: string | number;
  blockId?: string;
  blockName?: string;
  path?: string;
  fromPath?: string;
  afterBlockId?: string;
  inheritSettings?: boolean;
}

interface CopyRun {
  dst: SchemaCollection;
  target: FieldAtPath;
  sources: Map<string, PayloadDoc>;
  copies: Array<{ copy: unknown; from: string; blockType: unknown }>;
  skipped: Array<{ blockId: string; from: string; reason: string }>;
}

async function readSource(io: DocumentIO, col: string, fromId: string | number) {
  const read = () => io.read({ collection: col }, { id: fromId, callId: "copy-block-source" });
  let { doc, error } = await read();

  // One retry: a dropped pooled connection is gone on the next call.
  if (!doc && error) ({ doc, error } = await read());

  return doc ? { doc } : { error: error ?? "not found" };
}

async function copyPick(
  { io, schema }: CopyContext,
  { toCollection, path, fromPath }: CopyInput,
  picked: BlockPick,
  run: CopyRun
) {
  const { target, sources, copies, skipped } = run;
  const col = picked.fromCollection ?? toCollection;
  const src = schema.collections.find((collection) => collection.slug === col);

  if (!src) return { error: unknownTargetError(schema, { collection: col }) };
  const samePath = blocksFields(src.fields).some((candidate) => candidate.path === path);
  const srcPick = pickBlocksField(src.fields, col, {
    param: "fromPath",
    path: picked.fromPath ?? fromPath ?? (samePath ? path : undefined),
  });

  if (srcPick.error !== undefined) return srcPick;
  const { path: srcPath, field: srcField } = srcPick.at;
  const key = `${col}#${picked.fromId}`;
  let source = sources.get(key);

  if (!source) {
    const { doc, error } = await readSource(io, col, picked.fromId);

    if (!doc) {
      skipped.push({
        blockId: picked.blockId,
        from: key,
        reason: `could not read the source document: ${error}`,
      });

      return undefined;
    }

    sources.set(key, doc);
    source = doc;
  }

  const sourceBlocks = asArray(valueAtPath(source, srcPath));
  const block = sourceBlocks.find((candidate) => rowId(candidate) === String(picked.blockId));

  if (!isObjectLike(block)) {
    const have = sourceBlocks
      .map((candidate) =>
        isObjectLike(candidate) ? `${candidate.id}:${candidate.blockType}` : "undefined:undefined"
      )
      .slice(0, 30);

    skipped.push({
      blockId: picked.blockId,
      from: key,
      reason: `no such block there; blocks in ${key}.${srcPath}: ${have.join(", ") || "(none)"}`,
    });

    return undefined;
  }

  if (!target.field.blocks?.some((candidate) => candidate.slug === block.blockType)) {
    skipped.push({
      blockId: picked.blockId,
      from: key,
      reason: `block type "${block.blockType}" is not allowed in ${toCollection}.${target.path}`,
    });

    return undefined;
  }

  const [copy] = asArray(cloneFieldValue([block], srcField));

  if (picked.blockName && isRecord(copy)) copy.blockName = picked.blockName;
  healEmptyRichTextDeep(copy);
  copies.push({ copy, from: key, blockType: block.blockType });

  return undefined;
}

interface Landing {
  result: PayloadDoc;
  after: unknown[];
  at: number;
  settings: Record<string, unknown>;
  /** The call asked for the settings and the source is in another collection. */
  settingsRefused: boolean;
}

const SETTINGS_NOT_APPLIED =
  "`inheritSettings` was not applied: the first block comes from another collection than the target, and settings are copied only between documents of one collection. The blocks were copied.";

function copyReport(run: CopyRun, landing: Landing) {
  const { result, after, at, settings, settingsRefused } = landing;
  const { dst, target, copies, skipped } = run;
  const saved = valueAtPath(result, target.path);
  const landed: unknown[] = Array.isArray(saved) ? saved : after;

  return capMcpToolOutput({
    ok: true,
    copied: copies.map((entry, i) => ({
      blockType: entry.blockType,
      from: entry.from,
      newBlockId: blockIdOf(landed[at + i]),
      position: at + i,
    })),
    targetBlocks: landed.length,
    ...(Object.keys(settings).length
      ? { inheritedSettings: settings, inheritedFrom: copies[0].from }
      : {}),
    ...(settingsRefused ? { settingsNote: SETTINGS_NOT_APPLIED } : {}),
    ...(skipped.length ? { skipped } : {}),
    structure: documentOutline(dst.fields, result),
    next: skipped.length
      ? `${copies.length} block(s) written, ${skipped.length} SKIPPED (see skipped). For each skipped block type, call getBlockLibrary again, pick another exemplar, and copy it with afterBlockId to keep the reading order - never ask editContent to build the block from nothing. Then editContent the page ONCE to rewrite the copied text.`
      : "The draft is written - nothing to save. If blocks are still missing, copy them in one more call; then editContent the page ONCE to rewrite the copied text for its new topic.",
  });
}

async function writeCopies({ io, recordEdits }: CopyContext, input: CopyInput, run: CopyRun) {
  const { toCollection, toId, afterBlockId, inheritSettings } = input;
  const { dst, sources, copies } = run;
  const { doc: target, error: targetErr } = await io.read(
    { collection: toCollection },
    { id: toId, callId: "copy-block-target" }
  );

  if (targetErr)
    return { error: `Could not read ${toCollection}/${toId}: ${targetErr}. Nothing was copied.` };
  if (!target) return { error: documentNotFoundError(`Target document ${toCollection}/${toId}`) };
  const existing = valueAtPath(target, run.target.path);
  const before: unknown[] = Array.isArray(existing) ? existing : [];
  let at = before.length;

  if (afterBlockId) {
    const idx = before.findIndex(
      (block) => isRecord(block) && String(block.id) === String(afterBlockId)
    );

    if (idx === -1) return { error: itemNotFoundError(afterBlockId, run.target.path, before) };
    at = idx + 1;
  }

  const after = [...before.slice(0, at), ...copies.map((entry) => entry.copy), ...before.slice(at)];

  const inherit = inheritSettings ?? before.length === 0;
  const firstSource = sources.get(copies[0].from);
  const sameCollection = copies[0].from.split("#")[0] === toCollection;
  const settings =
    inherit && firstSource && sameCollection
      ? inheritableSettings(dst.fields, firstSource, target)
      : {};

  const patch = { ...settings, ...patchAtPath(target, run.target.path, after) };
  const { doc: written, error: writeErr } = await io.write(
    { collection: toCollection },
    { id: toId, patch, callId: COPY_BLOCK_WRITE_ID }
  );

  if (writeErr) return { error: `Copy failed: ${writeErr}` };

  const result = written ?? { ...target, ...patch };

  recordEdits?.([
    { collection: toCollection, id: toId, op: "edit", before: target, after: result },
  ]);

  return copyReport(run, {
    result,
    after,
    at,
    settings,
    settingsRefused: !!inheritSettings && !sameCollection,
  });
}

async function copyBlock(context: CopyContext, input: CopyInput) {
  const { toCollection, toId, blocks, fromCollection, fromId, blockId, blockName, path } = input;

  if (blocks?.length && (fromId !== undefined || blockId))
    return {
      error:
        "Nothing was copied: the call has both `blocks` and the single-block fields (`fromId`, `blockId`), and only one form runs. Send every block in `blocks`, in the order of the page, and leave `fromCollection`, `fromId`, `blockId` and `blockName` out.",
    };
  const picks: BlockPick[] = blocks?.length
    ? blocks
    : fromId !== undefined && blockId
      ? [{ fromCollection, fromId, blockId, blockName }]
      : [];

  if (!picks.length)
    return {
      error:
        "Pass `blocks: [{ fromId, blockId }, ...]` (or the single-block fields fromId + blockId).",
    };

  const dst = context.schema.collections.find((collection) => collection.slug === toCollection);

  if (!dst) return { error: unknownTargetError(context.schema, { collection: toCollection }) };

  const dstPick = pickBlocksField(dst.fields, toCollection, { param: "path", path });

  if (dstPick.error !== undefined) return dstPick;

  const run: CopyRun = { dst, target: dstPick.at, sources: new Map(), copies: [], skipped: [] };

  for (const picked of picks) {
    const failure = await copyPick(context, input, picked, run);

    if (failure) return failure;
  }

  const { copies, skipped } = run;

  if (!copies.length) {
    return {
      error: `None of the ${picks.length} pick(s) could be copied: ${skipped.map((entry) => `${entry.blockId} (${entry.from}): ${entry.reason}`).join("; ")}. Call getBlockLibrary again and pick other exemplars of the same block types - do not build these sections from empty skeletons.`,
      skipped,
    };
  }

  return withDocumentLock(`${toCollection}#${toId}`, () => writeCopies(context, input, run));
}

export function createCopyBlockTool(
  io: DocumentIO,
  schema: SchemaContext,
  recordEdits?: RecordEdits
) {
  return tool({
    description:
      "Copy blocks from existing documents into another document, verbatim: every field, reference, media id, nested row and rich text comes along, with fresh row ids. This is how a page is assembled from the site's existing blocks: pick exemplars with getBlockLibrary, copy them here, then editContent the page once to rewrite the text. Pass ALL the blocks the page needs in ONE call, in reading order (`blocks`) - it is one write, and the order is kept. Copying is a write: the target draft is updated immediately, there is nothing to save.",
    inputSchema: z.object({
      toCollection: z
        .string()
        .describe("Collection of the target document (the page being built)."),
      toId: z.union([z.string(), z.number()]).describe("Id of the target document."),
      blocks: z
        .array(blockPick)
        .min(1)
        .optional()
        .describe(
          "The blocks to copy, in the order they should appear. Preferred over the single-block fields."
        ),
      fromCollection: z
        .string()
        .optional()
        .describe("Single-block form: collection of the source document."),
      fromId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Single-block form: id of the source document."),
      blockId: z.string().optional().describe("Single-block form: id of the block to copy."),
      blockName: z
        .string()
        .optional()
        .describe("Single-block form: optional admin label for the copy."),
      path: z
        .string()
        .optional()
        .describe(
          "The blocks field of the target document: its name, or a dotted path when it sits inside a group. Omit when the target has one."
        ),
      fromPath: z
        .string()
        .optional()
        .describe(
          "The blocks field of the source documents, when it is not the same as `path`. Omit when the source has one."
        ),
      afterBlockId: z
        .string()
        .optional()
        .describe("Place the copies right after this block in the target. Omit to append."),
      inheritSettings: z
        .boolean()
        .optional()
        .describe(
          "Also copy the top-level checkbox, select and radio fields of the document of the FIRST block onto the target, each only where the target has no value. It works only when that document is in the same collection as the target; across collections nothing is copied and the result says so. Default: true when the target has no blocks yet (a fresh shell), false otherwise."
        ),
    }),
    execute: (input: CopyInput) => copyBlock({ io, schema, recordEdits }, input),
  });
}
