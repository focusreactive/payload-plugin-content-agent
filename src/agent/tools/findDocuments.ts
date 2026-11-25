import { z } from "zod";
import { tool } from "ai";
import type { PayloadDoc } from "../../borders.js";
import type { SchemaContext, SchemaCollection } from "../../types.js";
import type { DocumentIO } from "../content/documentIo.js";
import { docKeys, docLabel, keyFields, labelSelect } from "../../schema/docLabel.js";
import { titleFieldOf } from "../../schema/titleField.js";
import { capMcpToolOutput, stringifyCapped } from "./outputCap.js";

const DEFAULT_PER_COLLECTION = 5;
const MAX_PER_COLLECTION = 20;

export function searchableFields(collection: SchemaCollection): string[] {
  const textNames = new Set(
    collection.fields
      .filter(
        (field) =>
          field.name &&
          (field.type === "text" || field.type === "textarea" || field.type === "email")
      )
      .map((field) => field.name!)
  );
  const titleField = titleFieldOf(collection);
  const names = [...(titleField ? [titleField] : []), ...keyFields(collection)];

  return [...new Set(names)].filter((name) => textNames.has(name));
}

interface CollectionHits {
  collection: string;
  totalDocs: number;
  docs: Array<{
    collection: string;
    id: PayloadDoc["id"];
    title: string;
    slug?: unknown;
    _status?: PayloadDoc["_status"];
  }>;
}

interface CollectionFailure {
  collection: string;
  error: string;
}

export interface FindDocumentsContext {
  io: DocumentIO;
  schema: SchemaContext;
  searchable: SchemaCollection[];
}

export interface FindDocumentsInput {
  query: string;
  collections?: string[];
  limit?: number;
  locale?: string;
}

interface NameSearch {
  trimmedQuery: string;
  per: number;
  locale?: string;
}

function resolveTargets(
  { schema, searchable }: FindDocumentsContext,
  collections: string[] | undefined
): SchemaCollection[] | { error: string } {
  let targets = searchable;

  if (collections?.length) {
    const unknown = collections.filter(
      (slug) => !schema.collections.some((collection) => collection.slug === slug)
    );

    if (unknown.length)
      return {
        error: `Unknown collection(s): ${unknown.join(", ")}. Collections: ${schema.collections.map((collection) => collection.slug).join(", ")}`,
      };
    targets = searchable.filter((collection) => collections.includes(collection.slug));

    if (!targets.length)
      return {
        error: `None of ${collections.join(", ")} has a text field to match a name against. Collections this tool searches: ${searchable.map((collection) => collection.slug).join(", ") || "none"}. For the others call listDocuments with a \`where\` clause.`,
      };
  }

  return targets;
}

async function findInCollection(
  io: DocumentIO,
  collection: SchemaCollection,
  { trimmedQuery, per, locale }: NameSearch
): Promise<CollectionHits | CollectionFailure> {
  const fields = searchableFields(collection);
  const where =
    fields.length === 1
      ? { [fields[0]]: { like: trimmedQuery } }
      : { or: fields.map((fieldName) => ({ [fieldName]: { like: trimmedQuery } })) };

  try {
    const { docs, totalDocs, error } = await io.list(collection.slug, {
      page: 1,
      limit: per,
      where,
      locale,
      callId: "find-documents",
      select: labelSelect(collection),
    });

    if (error) return { collection: collection.slug, error };

    return {
      collection: collection.slug,
      totalDocs,
      docs: docs.map((doc) => ({
        collection: collection.slug,
        id: doc.id,
        title: docLabel(doc, collection) ?? String(doc.id ?? ""),
        ...docKeys(doc, collection),
        ...(doc._status ? { _status: doc._status } : {}),
      })),
    };
  } catch (err) {
    return {
      collection: collection.slug,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The collections the call named that have no text field for a name: they were not searched. */
function notSearched(targets: SchemaCollection[], collections: string[] | undefined) {
  const left = (collections ?? []).filter(
    (slug) => !targets.some((collection) => collection.slug === slug)
  );

  return left.length
    ? {
        notSearchable: left,
        notSearchableNote: `${left.join(", ")} ${left.length === 1 ? "has" : "have"} no text field to match a name against and ${left.length === 1 ? "was" : "were"} not searched. To look there call listDocuments with a \`where\` clause.`,
      }
    : {};
}

export async function findDocuments(
  context: FindDocumentsContext,
  { query, collections, limit, locale }: FindDocumentsInput
) {
  const trimmedQuery = query.trim();

  if (!trimmedQuery)
    return { error: "`query` is empty: pass the words of the name of the document to find." };
  const targets = resolveTargets(context, collections);

  if (!Array.isArray(targets)) return targets;
  const per = limit ?? DEFAULT_PER_COLLECTION;

  const perCollection = await Promise.all(
    targets.map((collection) =>
      findInCollection(context.io, collection, { trimmedQuery, per, locale })
    )
  );

  const hits = perCollection.flatMap((result) =>
    "docs" in result && result.docs.length ? [result] : []
  );
  const failed = perCollection.flatMap((result) => ("error" in result ? [result] : []));
  const totalDocs = hits.reduce((sum, hit) => sum + hit.totalDocs, 0);

  return capMcpToolOutput({
    query: trimmedQuery,
    searched: targets.map((collection) => collection.slug),
    ...notSearched(targets, collections),
    totalDocs,
    docs: hits.flatMap((hit) => hit.docs),
    byCollection: hits.map((hit) => ({
      collection: hit.collection,
      totalDocs: hit.totalDocs,
      shown: hit.docs.length,
    })),
    ...(failed.length ? { failed } : {}),
    ...(totalDocs === 0
      ? {
          note: `No document in ${targets.length} collection(s) has a title-like field containing all of: ${trimmedQuery}. Try fewer words, or a different spelling.`,
        }
      : {}),
  });
}

export const findDocumentsInput = z.object({
  query: z.string().min(1).describe("Words of the name to look for. Not a sentence."),
  collections: z
    .array(z.string())
    .optional()
    .describe("Restrict the search to these collection slugs. Omit to search all."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PER_COLLECTION)
    .optional()
    .describe(`Max hits per collection (default ${DEFAULT_PER_COLLECTION}).`),
  locale: z
    .string()
    .optional()
    .describe("Locale code to match localized titles in. Omit for the default locale."),
});

export const searchableCollections = (schema: SchemaContext): SchemaCollection[] =>
  schema.collections.filter((collection) => searchableFields(collection).length);

export function createFindDocumentsTool(io: DocumentIO, schema: SchemaContext) {
  const searchable = searchableCollections(schema);

  return tool({
    description:
      "Find documents BY NAME across ALL collections in one call - when you know what something is called but not where it lives. " +
      "Matches the words of `query` against each collection's title-like " +
      "fields (case-insensitive, all words must appear) and returns the hits grouped by collection, with ids. " +
      "Use this INSTEAD of probing collections one by one with listDocuments. Pass `collections` to narrow it. " +
      `Searchable collections: ${searchable.map((collection) => collection.slug).join(", ")}`,
    inputSchema: findDocumentsInput,
    execute: (input: FindDocumentsInput) => findDocuments({ io, schema, searchable }, input),
    toModelOutput: ({ output }) => ({
      type: "text" as const,
      value: typeof output === "string" ? output : stringifyCapped(output),
    }),
  });
}
