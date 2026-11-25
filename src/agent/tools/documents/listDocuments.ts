import { tool } from "ai";
import { z } from "zod";
import type { PayloadDoc, Where } from "../../../borders.js";
import type { SchemaCollection, SchemaContext, SchemaField } from "../../../types.js";
import { titleFieldOf } from "../../../schema/titleField.js";
import type { DocumentIO } from "../../content/documentIo.js";
import { asksForPublished, readWhere, sortError, WHERE_FORMAT } from "../../content/whereClause.js";
import { unknownTargetError } from "../../toolErrors.js";
import { isRecord } from "../../../borders.js";
import { capMcpToolOutput, MAX_STRIPPED_JSON_CHARS, stringifyCapped } from "../outputCap.js";
import { stripContent } from "./stripContent.js";

export interface ListInput {
  collection: string;
  where?: string;
  page?: number;
  limit?: number;
  fields?: string[];
  sort?: string;
  draft?: boolean;
  locale?: string;
}

function valueAt(doc: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), doc);
}

/** A row with the id and the named fields only, each under its path. */
function pickFields(doc: unknown, fields: string[]): Record<string, unknown> {
  const row: Record<string, unknown> = { id: valueAt(doc, "id") };
  const published = valueAt(doc, "hasPublishedVersion");

  if (published !== undefined) row.hasPublishedVersion = published;

  for (const path of fields) row[path] = valueAt(doc, path) ?? null;

  return row;
}

const BUILT_IN_FIELDS = ["id", "createdAt", "updatedAt", "_status"];

/** Where a path leaves the schema: the group it stops in and the names that group has. */
function unresolved(
  fields: SchemaField[],
  path: string
): { group: string; names: string[] } | null {
  const walked: string[] = [];
  let scope = fields;

  for (const segment of path.split(".")) {
    const names = scope.map((field) => field.name);
    const field = scope.find((candidate) => candidate.name === segment);

    if (!walked.length)
      names.push(...BUILT_IN_FIELDS.filter((builtIn) => !names.includes(builtIn)));
    if (!field) return names.includes(segment) ? null : { group: walked.join("."), names };
    if (field.type !== "group") return null;
    walked.push(segment);
    scope = field.fields ?? [];
  }

  return null;
}

function unknownFieldError(
  schema: SchemaContext,
  collection: string,
  fields: string[]
): string | null {
  const known = schema.collections.find((entry) => entry.slug === collection)?.fields;

  if (!known) return null;
  const unknown: string[] = [];
  const scopes = new Map<string, string[]>();

  for (const path of fields) {
    const fault = unresolved(known, path);

    if (!fault) continue;
    unknown.push(path);
    scopes.set(fault.group, fault.names);
  }

  if (!unknown.length) return null;
  const lists = [...scopes].map(
    ([group, names]) =>
      `The fields of ${group ? `the group "${group}"` : collection}: ${names.join(", ")}.`
  );

  return `Unknown field(s) in \`fields\`: ${unknown.join(", ")}. ${lists.join(" ")} A field inside a group is "<group>.<field>".`;
}

/**
 * A draft row reads the same for a document that was never published and for a published one
 * with a newer draft. `hasPublishedVersion` tells them apart.
 */
async function markPublished(
  io: DocumentIO,
  collection: string,
  docs: PayloadDoc[],
  locale: string | undefined
): Promise<void> {
  const drafts = docs.filter((doc) => doc._status === "draft");

  if (!drafts.length) return;
  const published = await io.list(collection, {
    page: 1,
    limit: drafts.length,
    locale,
    where: {
      and: [{ id: { in: drafts.map((doc) => doc.id) } }, { _status: { equals: "published" } }],
    },
    draft: false,
    callId: "list-published",
    select: { id: true },
  });

  if (published.error) return;
  const live = new Set(published.docs.map((doc) => String(doc.id)));

  for (const doc of drafts) doc.hasPublishedVersion = live.has(String(doc.id));
}

const ROWS_NOTE =
  "The whole rows of this page are too large to return, so some of them are cut off below. When you need a few fields of every document, call listDocuments again with `fields` set to those field paths: the rows then fit and the page is complete.";

function pageRows(docs: unknown[], fields: string[] | undefined) {
  const rows = docs.map((doc) => stripContent(doc));

  if (fields?.length) return { docs: rows.map((row) => pickFields(row, fields)) };

  return {
    ...(JSON.stringify(rows).length > MAX_STRIPPED_JSON_CHARS ? { rowsNote: ROWS_NOTE } : {}),
    docs: rows,
  };
}

/** The top-level fields of the paths a call keeps, and what `markPublished` reads. */
function rowSelect(target: SchemaCollection, fields: string[]): Record<string, true> {
  return {
    id: true,
    ...Object.fromEntries(fields.map((path) => [path.split(/[.[]/u)[0], true] as const)),
    ...(target.hasDrafts ? { _status: true } : {}),
  };
}

function listRequest(
  schema: SchemaContext,
  target: SchemaCollection | undefined,
  { collection, where, fields, sort }: Pick<ListInput, "collection" | "where" | "fields" | "sort">
): { where: Where | undefined } | { error: string } {
  const fieldError = fields?.length ? unknownFieldError(schema, collection, fields) : null;

  if (fieldError) return { error: fieldError };
  const sortFault = sort ? sortError(sort, target) : null;

  if (sortFault) return { error: sortFault };

  return where ? readWhere(where, target) : { where: undefined };
}

export async function listDocuments(
  io: DocumentIO,
  schema: SchemaContext,
  { collection, where, page, limit, fields, sort, draft, locale }: ListInput
) {
  const target = schema.collections.find((entry) => entry.slug === collection);

  if (!target) return { error: unknownTargetError(schema, { collection }) };
  const titleField = titleFieldOf(target);
  const request = listRequest(schema, target, { collection, where, fields, sort });

  if ("error" in request) return request;
  const publishedOnly = draft === false || asksForPublished(request.where);

  const { docs, totalPages, totalDocs, moreMayExist, error } = await io.list(collection, {
    page: page ?? 1,
    limit: limit ?? 20,
    locale,
    where: request.where,
    sort,
    ...(publishedOnly ? { draft: false } : {}),
    ...(fields?.length ? { select: rowSelect(target, fields) } : {}),
    callId: "list-documents",
  });

  if (error) return { error };
  if (target?.hasDrafts && !publishedOnly) await markPublished(io, collection, docs, locale);

  // `ids` after `docs`: the output cap trims the largest array, and on a tie the first one,
  // so a page that is too big loses rows, never ids.
  return capMcpToolOutput({
    collection,
    ...(titleField ? { titleField } : {}),
    page: page ?? 1,
    totalPages,
    totalDocs,
    ...(moreMayExist
      ? {
          totalIsLowerBound: `The server gave no total. totalDocs counts only the pages read so far: call listDocuments with page ${(page ?? 1) + 1} until a page returns fewer than ${limit ?? 20} documents.`,
        }
      : {}),
    returned: docs.length,
    ...pageRows(docs, fields),
    ids: docs.map((doc) => doc.id),
  });
}

export const listDocumentsInput = z.object({
  collection: z.string().describe("Collection slug"),
  where: z
    .string()
    .optional()
    .describe(
      `Payload where clause as a JSON string. ${WHERE_FORMAT} For an exact count, filter and read totalDocs (limit can stay small).`
    ),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe("The page to read, from 1. The result has `totalPages`."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe("Documents on a page: 1 to 100, default 20."),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      'Field paths to keep in each row, e.g. ["<field>", "<group>.<field>"]; the id is always kept. Pass it whenever you need a few fields of many documents (an audit, a comparison, a check of one field across a collection): the rows stay small, so one page of 100 holds what whole rows cannot.'
    ),
  sort: z
    .string()
    .optional()
    .describe(
      "A field name of the collection to order by; put `-` in front for descending order, e.g. `-updatedAt` for the latest first."
    ),
  draft: z
    .boolean()
    .optional()
    .describe(
      "Omit it: the draft versions are read. Pass false only when the person asks for the published versions."
    ),
  locale: z.string().optional().describe("Locale code. Omit for the default locale."),
});

export function createListDocumentsTool(io: DocumentIO, schema: SchemaContext) {
  const collectionSlugs = schema.collections.map((collection) => collection.slug);

  return tool({
    description:
      `List documents of a collection (draft versions, paged) - works for every collection of the schema. ` +
      `Returns metadata AND the exact total (totalDocs), plus \`ids\` - every id on the page, kept even when the rows are trimmed for size; collect ids from there, never from the rows. To read a few fields of every document (an audit or a check of one field across the collection), pass \`fields\`: whole rows of a large page are cut off, rows with a few fields are not. A row with \`_status: "draft"\` also has \`hasPublishedVersion\`: true means a published version is live and this draft is newer, false means the document was never published. To filter or COUNT by a field, pass a Payload \`where\` clause instead of paging through and eyeballing - ` +
      `e.g. the documents whose field holds 4: where='{"<field>":{"equals":4}}' then read totalDocs; published only: where='{"_status":{"equals":"published"}}', which reads the published versions, so a published document with a newer draft is counted; ` +
      `combine with and/or: where='{"and":[{"<field>":{"equals":4}},{"_status":{"equals":"published"}}]}'. Collections: ${collectionSlugs.join(", ")}`,
    inputSchema: listDocumentsInput,
    execute: (input: ListInput) => listDocuments(io, schema, input),
    toModelOutput: ({ output }) => ({
      type: "text" as const,
      value: typeof output === "string" ? output : stringifyCapped(output),
    }),
  });
}
