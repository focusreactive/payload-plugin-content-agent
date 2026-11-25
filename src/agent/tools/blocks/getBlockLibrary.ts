import { z } from "zod";
import { tool } from "ai";
import type { DocId, PayloadDoc } from "../../../borders.js";
import type { SchemaCollection, SchemaContext, SchemaField } from "../../../types.js";
import { valueAtPath } from "../../../schema/fieldPaths.js";
import type { FieldAtPath } from "../../../schema/fieldPaths.js";
import type { DocumentIO } from "../../content/documentIo.js";
import { previewRefValue, previewValue } from "../../content/blockTools.js";
import { isObjectLike } from "../../content/discovery.js";
import { docLabel } from "../../../schema/docLabel.js";
import { capMcpToolOutput } from "../outputCap.js";
import { asArray, blocksFields, pickBlocksField } from "./shared.js";

const MAX_SCAN_DOCS = 400;
const PAGE_SIZE = 100;
const EXEMPLARS_PER_TYPE = 2;

const hasRoot = (value: unknown): value is Record<string, unknown> =>
  isObjectLike(value) && !!value.root;

function textOf(value: unknown): string {
  if (typeof value === "string") return value;

  if (hasRoot(value)) {
    const out: string[] = [];

    const walk = (node: unknown) => {
      if (!isObjectLike(node)) return;
      if (typeof node.text === "string") out.push(node.text);
      for (const child of asArray(node.children)) walk(child);
    };

    walk(value.root);

    return out.join(" ");
  }

  return "";
}

function fillScore(
  fields: SchemaField[],
  block: unknown
): { score: number; filled: number; total: number; refs: number } {
  let score = 0;
  let filled = 0;
  let total = 0;
  let refs = 0;

  for (const field of fields) {
    if (!field.name || field.name === "id" || field.name === "blockName") continue;
    const value = isObjectLike(block) ? block[field.name] : undefined;

    total += 1;
    const empty =
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (hasRoot(value) && textOf(value).trim() === "");

    if (empty) continue;
    filled += 1;
    score += 1;

    if (field.type === "relationship" || field.type === "upload") {
      refs += 1;
      score += 1;
    }

    if (Array.isArray(value) && value.length > 1) score += 1;
  }

  return { score, filled, total, refs };
}

function previewBlock(fields: SchemaField[], block: unknown, max = 6): Record<string, string> {
  const out: Record<string, string> = {};
  const row = isObjectLike(block) ? block : {};
  let shown = 0;

  for (const field of fields) {
    if (!field.name || field.name === "id" || field.name === "blockName" || !(field.name in row))
      continue;
    if (shown >= max) break;
    const value = row[field.name];

    if (value === null || value === undefined || value === "") continue;
    out[field.name] =
      previewRefValue(field, value) ??
      (hasRoot(value) ? `[rich text, ${textOf(value).length} chars]` : previewValue(value));
    shown += 1;
  }

  return out;
}

interface Exemplar {
  score: number;
  docId: DocId | undefined;
  doc: string;
  blockId: unknown;
  filled: string;
  refs: number;
  preview: Record<string, string>;
}

interface BlockTypeUsage {
  instances: number;
  docIds: Set<DocId | undefined>;
  exemplars: Exemplar[];
}

interface LibraryInput {
  collection: string;
  path?: string;
}

async function scanCollectionDocs(
  io: DocumentIO,
  collection: string
): Promise<{ error: string } | { error?: undefined; docs: PayloadDoc[]; totalDocs: number }> {
  const docs: PayloadDoc[] = [];
  let totalDocs = 0;

  for (let page = 1; docs.length < MAX_SCAN_DOCS; page += 1) {
    const res = await io.list(collection, { page, limit: PAGE_SIZE, callId: "block-library" });

    if (res.error) return { error: `Could not read "${collection}": ${res.error}` };
    docs.push(...res.docs);
    totalDocs = Math.max(res.totalDocs ?? 0, docs.length);
    if (page >= res.totalPages || res.docs.length === 0) break;
  }

  return { docs, totalDocs };
}

function addExemplar(
  entry: BlockTypeUsage,
  fields: SchemaField[],
  doc: { id: DocId | undefined; label: string },
  block: Record<string, unknown>
): void {
  const fill = fillScore(fields, block);

  entry.exemplars.push({
    score: fill.score,
    docId: doc.id,
    doc: doc.label,
    blockId: block.id,
    filled: `${fill.filled}/${fill.total} fields`,
    refs: fill.refs,
    preview: previewBlock(fields, block),
  });
  entry.exemplars.sort((a, b) => b.score - a.score);
  entry.exemplars.length = Math.min(entry.exemplars.length, EXEMPLARS_PER_TYPE);
}

function usageByType(
  { path, field }: FieldAtPath,
  docs: PayloadDoc[],
  collection: SchemaCollection
): Map<string, BlockTypeUsage> {
  const perType = new Map<string, BlockTypeUsage>();

  for (const doc of docs) {
    const label = (docLabel(doc, collection) ?? String(doc.id ?? "?")).slice(0, 80);

    for (const block of asArray(valueAtPath(doc, path))) {
      if (!isObjectLike(block)) continue;
      const type = block.blockType;

      if (typeof type !== "string" || !type) continue;
      const def = field.blocks?.find((candidate) => candidate.slug === type);
      const entry = perType.get(type) ?? { instances: 0, docIds: new Set(), exemplars: [] };

      entry.instances += 1;
      entry.docIds.add(doc.id);
      if (def) addExemplar(entry, def.fields, { id: doc.id, label }, block);
      perType.set(type, entry);
    }
  }

  return perType;
}

function buildLibrary(field: SchemaField, perType: Map<string, BlockTypeUsage>) {
  const library = (field.blocks ?? []).map((def) => {
    const seen = perType.get(def.slug);

    return {
      blockType: def.slug,
      ...(def.label ? { label: def.label } : {}),
      ...(def.description ? { purpose: def.description } : {}),
      ...(def.group ? { group: def.group } : {}),
      fields: def.fields
        .filter((blockField) => blockField.name && blockField.name !== "id")
        .map((blockField) => `${blockField.name}:${blockField.type}`),
      usedOn: seen?.docIds.size ?? 0,
      instances: seen?.instances ?? 0,
      exemplars: (seen?.exemplars ?? []).map(({ score: _score, ...exemplar }) => exemplar),
    };
  });

  library.sort((a, b) => b.usedOn - a.usedOn || a.blockType.localeCompare(b.blockType));

  return library;
}

async function getBlockLibrary(io: DocumentIO, schema: SchemaContext, input: LibraryInput) {
  const { collection } = input;
  const target = schema.collections.find((candidate) => candidate.slug === collection);

  if (!target) {
    return {
      error: `Unknown collection "${collection}". Available: ${schema.collections.map((candidate) => candidate.slug).join(", ")}`,
    };
  }

  if (!blocksFields(target.fields).length) {
    const withBlocks = schema.collections
      .filter((candidate) => blocksFields(candidate.fields).length)
      .map((candidate) => candidate.slug);

    return {
      error: withBlocks.length
        ? `"${collection}" has no blocks field, so it has no block library. Collections with one: ${withBlocks.join(", ")}.`
        : `"${collection}" has no blocks field, and no collection of this site has one: there is no block library here. Say so to the person.`,
    };
  }

  const resolved = pickBlocksField(target.fields, collection, { param: "path", path: input.path });

  if (resolved.error !== undefined) return resolved;
  const { at } = resolved;
  const fromPath = blocksFields(target.fields).length > 1 ? `, fromPath: "${at.path}"` : "";

  const scanned = await scanCollectionDocs(io, collection);

  if (scanned.error !== undefined) return scanned;
  const { docs, totalDocs } = scanned;

  const library = buildLibrary(at.field, usageByType(at, docs, target));

  return capMcpToolOutput({
    collection,
    path: at.path,
    scanned: docs.length,
    ...(totalDocs > docs.length
      ? {
          incomplete: `Only ${docs.length} of the ${totalDocs} documents of "${collection}" were read: \`usedOn\` and \`instances\` are lower bounds, and a block type with no exemplar here can still be in use on a document that was not read.`,
        }
      : {}),
    blockTypes: library.length,
    library,
    next:
      `Pick block types by purpose and usage. Then make ONE copyBlock({ toCollection, toId, blocks: [{ fromCollection: "${collection}", fromId: <exemplar docId>, blockId: <exemplar blockId>${fromPath} }, ...] }) call ` +
      `with every exemplar in the order the page should read: one call per block races on the same page. Then rewrite the copied text for the new topic with editContent. ` +
      `A block type with no exemplar has never been used on this site - prefer one that has.`,
  });
}

export function createBlockLibraryTool(io: DocumentIO, schema: SchemaContext) {
  return tool({
    description:
      "The site's block library for a collection: every block type that exists, what it is for (from the schema), how often it is used, and one or two EXEMPLARS - real, well-filled instances on existing pages, with their references and media. Call this FIRST when asked to build a page from existing blocks without a single page to clone: pick block types by purpose here, then copyBlock the exemplars into the new page and rewrite their text. Never build a block from an empty skeleton when an exemplar exists.",
    inputSchema: z.object({
      collection: z.string().describe("Collection slug."),
      path: z
        .string()
        .optional()
        .describe(
          "The blocks field to catalog: its name, or a dotted path when it sits inside a group. Omit when the collection has one."
        ),
    }),
    execute: (input: LibraryInput) => getBlockLibrary(io, schema, input),
  });
}
