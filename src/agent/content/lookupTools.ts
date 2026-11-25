import { z } from "zod";
import { tool } from "ai";
import type { SchemaCollection, SchemaContext } from "../../types.js";
import { docKeys, docLabel, labelSelect } from "../../schema/docLabel.js";
import type { PayloadDoc, Where } from "../../borders.js";
import { searchableFields } from "../tools/findDocuments.js";
import type { DocumentIO } from "./documentIo.js";
import { queryableFields, readWhere, WHERE_FORMAT } from "./whereClause.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function labelFor(doc: PayloadDoc | null, collection: SchemaCollection | undefined): string {
  const label = docLabel(doc, collection) ?? "(no title)";

  return label.length > 80 ? `${label.slice(0, 80)}…` : label;
}

function nameClause(collection: SchemaCollection, query: string): Where | undefined {
  const fields = searchableFields(collection);

  if (!fields.length) return undefined;

  return fields.length === 1
    ? { [fields[0]]: { like: query } }
    : { or: fields.map((fieldName) => ({ [fieldName]: { like: query } })) };
}

const BY_NAME =
  "To find a document by its name, call lookupDocuments with `query` set to the words of the name and no `where`.";

function lookupFilter(
  collection: SchemaCollection,
  query: string | undefined,
  where: string | undefined
): { where: Where | undefined } | { error: string } {
  const clauses: Where[] = [];
  const words = query?.trim();

  if (words) {
    const clause = nameClause(collection, words);

    if (!clause)
      return {
        error: `"${collection.slug}" has no text field to match a name against. Call lookupDocuments without \`query\`, or with a \`where\` clause on one of its fields: ${queryableFields(collection).join(", ")}.`,
      };
    clauses.push(clause);
  }

  if (where) {
    const read = readWhere(where, collection);

    if ("error" in read) return { error: `${read.error} ${BY_NAME}` };
    clauses.push(read.where);
  }

  return { where: clauses.length > 1 ? { and: clauses } : clauses[0] };
}

const SAME_LABEL =
  "Several documents here have the same label, and this list does not tell which one the task means. When the task gives the id to write, write that id: a lookup never overrules an id of the task. When the task gives no id, do not pick one: say in your summary which ids share the label.";

const LOCALE_PARAM =
  "Locale code of the labels. Omit it for the locale the open document is read in.";

const lookupRows = (docs: Array<PayloadDoc | null>, target: SchemaCollection) =>
  docs.map((doc) => ({
    id: doc?.id,
    label: labelFor(doc, target),
    ...docKeys(doc, target),
    ...(doc?._status ? { _status: doc._status } : {}),
  }));

const hasSameLabel = (rows: Array<{ label: string }>): boolean =>
  rows.some((row, index) => rows.findIndex((other) => other.label === row.label) !== index);

export function createLookupTools(
  io: DocumentIO,
  schema: SchemaContext,
  sessionLocale?: () => string | undefined
) {
  const collectionSlugs = schema.collections.map((collection) => collection.slug);

  return {
    lookupDocuments: tool({
      description:
        "List candidate documents of a collection as `{ id, label }` rows, with the unique keys of a document and its `_status` when the collection has them, so you can fill a relationship or upload field with a REAL id. " +
        "Use it whenever a field has a `relationTo` (see inspectBlockSchema): a reference to another document or to media. " +
        "To find a document by what it is called, pass `query` with the words of its name: you do not need to know which field holds the name. " +
        `Never invent an id, and never leave such a section out because you lack one: look it up. Collections: ${collectionSlugs.join(", ")}.`,
      inputSchema: z.object({
        collection: z
          .string()
          .describe("Collection slug to list - take it from the field's `relationTo`."),
        query: z
          .string()
          .optional()
          .describe(
            "Optional words of the name of the document to find. They are matched against the title fields of the collection (case-insensitive, every word must appear). Plain words, not a sentence and not a filter."
          ),
        where: z
          .string()
          .optional()
          .describe(
            `Optional Payload where clause as a JSON string, to filter by a field other than the name. ${WHERE_FORMAT}`
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            `How many to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}). A larger number returns ${MAX_LIMIT}: narrow the list with \`query\` or \`where\` instead.`
          ),
        locale: z.string().optional().describe(LOCALE_PARAM),
      }),
      execute: async ({ collection, query, where, limit, locale }) => {
        const target = schema.collections.find((entry) => entry.slug === collection);

        if (!target)
          return {
            error: `Unknown collection "${collection}". Available: ${collectionSlugs.join(", ")}`,
          };
        const filter = lookupFilter(target, query, where);

        if ("error" in filter) return filter;

        const { docs, totalDocs, error } = await io.list(collection, {
          page: 1,
          limit: Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT),
          locale: locale ?? sessionLocale?.(),
          where: filter.where,
          callId: "editor-lookup",
          select: labelSelect(target),
        });

        if (error) return { error };
        const rows = lookupRows(docs, target);

        return {
          collection,
          totalDocs,
          returned: docs.length,
          docs: rows,
          ...(hasSameLabel(rows) ? { sameLabel: SAME_LABEL } : {}),
          ...(docs.length === 0
            ? {
                note: "No documents matched. Do NOT invent an id - leave the field unset and say so in your summary.",
              }
            : totalDocs > docs.length
              ? {
                  note: `These are ${docs.length} of ${totalDocs} documents. One call returns at most ${MAX_LIMIT}: call lookupDocuments again with \`query\` (the words of a name) or a \`where\` clause that narrows the list to the documents you need.`,
                }
              : {}),
        };
      },
    }),
  };
}
