import { tool } from "ai";
import { z } from "zod";
import { convertLexicalToPlaintext } from "@payloadcms/richtext-lexical/plaintext";
import type { PlaintextConverters } from "@payloadcms/richtext-lexical/plaintext";
import { isDocId, isRichTextState } from "../../borders.js";
import type { DocId, PayloadDoc } from "../../borders.js";
import type { DocumentIO } from "../content/documentIo.js";
import type { SchemaCollection, SchemaContext } from "../../types.js";
import { collectContentFields, getByPath, parsePath } from "../content/discovery.js";
import { docKeys, docLabel } from "../../schema/docLabel.js";
import { capMcpToolOutput } from "./outputCap.js";

const CONVERTERS: PlaintextConverters = {
  link: ({ node, nodesToPlaintext }) => {
    const url = node.fields?.url || ("url" in node ? node.url : undefined) || "";
    const childText = nodesToPlaintext({ nodes: node.children || [] }).join("");

    return url ? `[${childText}](${url})` : childText;
  },
};

// The MCP find tool refuses a `limit` above 100.
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

const MAX_MATCHED_IDS = 2000;

const MAX_SNIPPETS_PER_DOC = 3;
const MAX_SNIPPET_DOCS = 50;

export interface SearchContext {
  io: DocumentIO;
  schema: SchemaContext;
  collectionSlugs: string[];
}

export interface SearchInput {
  collection: string;
  query: string;
  contextChars?: number;
  locale?: string;
}

interface SearchTerms {
  query: string;
  queryLower: string;
  ctx: number;
}

interface SearchMatch {
  id: DocId | undefined;
  title?: unknown;
  keys?: Record<string, string>;
  snippets: string[];
  matchCount: number;
}

interface SearchScan {
  matchedIds: DocId[];
  hitPageCap: boolean;
  matches: SearchMatch[];
  totalDocs: number;
  scannedCount: number;
}

type ContentLeaf = ReturnType<typeof collectContentFields>[number];

function leafPlaintext(leaf: ContentLeaf, doc: PayloadDoc): string | null {
  let plaintext: string;

  if (leaf.richText) {
    try {
      const val = getByPath(doc, parsePath(leaf.ref));

      if (!isRichTextState(val)) return null;
      plaintext = convertLexicalToPlaintext({ data: val, converters: CONVERTERS });
    } catch {
      return null;
    }
  } else if (typeof leaf.value === "string") {
    plaintext = leaf.value;
  } else {
    return null;
  }

  return plaintext;
}

const percentDecoded = (text: string): string =>
  text.replace(/(?:%[0-9a-f]{2})+/giu, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });

function collectSnippets(
  plaintext: string,
  ref: string,
  { query, queryLower, ctx }: SearchTerms,
  snippets: string[]
): number {
  let matchCount = 0;
  const ptLower = plaintext.toLowerCase();
  let searchFrom = 0;

  while (true) {
    const idx = ptLower.indexOf(queryLower, searchFrom);

    if (idx === -1) break;
    const start = Math.max(0, idx - ctx);
    const end = Math.min(plaintext.length, idx + query.length + ctx);

    matchCount++;

    if (snippets.length < MAX_SNIPPETS_PER_DOC) {
      const snippet =
        (start > 0 ? "..." : "") +
        plaintext.slice(start, end) +
        (end < plaintext.length ? "..." : "");

      snippets.push(`[${ref}] ${snippet}`);
    }

    searchFrom = idx + query.length;
  }

  return matchCount;
}

function scanDocument(
  collectionDef: SchemaCollection | undefined,
  doc: PayloadDoc,
  terms: SearchTerms,
  scan: SearchScan
): void {
  const fields = collectionDef?.fields ?? [];
  const snippets: string[] = [];
  let matchCount = 0;

  for (const leaf of collectContentFields(fields, doc)) {
    const plaintext = leafPlaintext(leaf, doc);

    if (plaintext === null) continue;
    const found = collectSnippets(plaintext, leaf.ref, terms, snippets);

    // An address may be stored percent-encoded: `a%2Db` is the address `a-b`.
    const decoded = found ? plaintext : percentDecoded(plaintext);

    matchCount +=
      found || (decoded === plaintext ? 0 : collectSnippets(decoded, leaf.ref, terms, snippets));
  }

  if (matchCount > 0 && isDocId(doc.id)) {
    scan.matchedIds.push(doc.id);

    if (scan.matches.length < MAX_SNIPPET_DOCS) {
      scan.matches.push({
        id: doc.id,
        title: docLabel(doc, collectionDef),
        keys: docKeys(doc, collectionDef),
        snippets,
        matchCount,
      });
    }
  }
}

async function scanCollection(
  { io, schema }: SearchContext,
  { collection, locale }: SearchInput,
  terms: SearchTerms,
  scan: SearchScan
): Promise<{ error: string } | null> {
  const collectionDef = schema.collections.find((candidate) => candidate.slug === collection);

  let page = 1;
  let totalPages = 1;

  do {
    let res: Awaited<ReturnType<typeof io.list>>;

    try {
      res = await io.list(collection, {
        limit: PAGE_SIZE,
        page,
        locale,
        callId: "search-content",
      });
    } catch (err) {
      return { error: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (res.error) return { error: `Search failed: ${res.error}` };
    totalPages = res.totalPages || 1;
    scan.totalDocs = res.totalDocs;
    if (res.docs.length === 0) break;

    for (const doc of res.docs) scanDocument(collectionDef, doc, terms, scan);
    scan.scannedCount += res.docs.length;
    page++;
  } while (page <= totalPages && page <= MAX_PAGES);

  scan.hitPageCap = page > MAX_PAGES && page <= totalPages;

  return null;
}

function searchReport({ collection, query }: SearchInput, scan: SearchScan) {
  const { matchedIds, matches, totalDocs, scannedCount, hitPageCap } = scan;
  const truncated = scannedCount < totalDocs;
  const idsTruncated = matchedIds.length > MAX_MATCHED_IDS;
  const returnedIds = idsTruncated ? matchedIds.slice(0, MAX_MATCHED_IDS) : matchedIds;

  return capMcpToolOutput({
    collection,
    query,
    totalSearched: scannedCount,
    totalMatches: matchedIds.length,
    matchedIds: returnedIds,
    matches,
    ...(idsTruncated
      ? {
          idsTruncated: true,
          idsTruncatedNote: `Only the first ${MAX_MATCHED_IDS} of ${matchedIds.length} matching ids are returned (keeping the response size manageable) - narrow the query for a smaller, complete result, or process in batches.`,
        }
      : {}),
    ...(matchedIds.length > matches.length
      ? {
          snippetsTruncated: true,
          note: `matchedIds lists ${returnedIds.length} match(es); detailed snippets are shown only for the first ${matches.length}.`,
        }
      : {}),
    ...(truncated
      ? {
          truncated: true,
          totalDocs,
          truncatedNote: `Scanned only ${scannedCount} of ${totalDocs} documents in "${collection}" (${hitPageCap ? `hit the ${MAX_PAGES}-page safety cap` : "the CMS returned no more documents"}) - matchedIds may be missing matches from the rest of the collection.`,
        }
      : {}),
  });
}

export async function searchContent(context: SearchContext, input: SearchInput) {
  const { collection, query, contextChars } = input;
  const ctx = contextChars ?? 150;

  // An empty query never advances the indexOf scan below: a synchronous infinite loop.
  if (!query) return { error: "query must not be empty" };

  if (!context.collectionSlugs.includes(collection)) {
    return {
      error: `Unknown collection "${collection}". Available: ${context.collectionSlugs.join(", ")}`,
    };
  }

  if (!context.io.transports({ collection }).read) {
    return {
      error: `No read access for "${collection}" - enable it in mcpPlugin (or grant the user access) and restart.`,
    };
  }

  const queryLower = query.toLowerCase();
  const scan: SearchScan = {
    matchedIds: [],
    matches: [],
    totalDocs: 0,
    scannedCount: 0,
    hitPageCap: false,
  };
  const failure = await scanCollection(context, input, { query, queryLower, ctx }, scan);

  if (failure) return failure;

  return searchReport(input, scan);
}

export const searchContentInput = z.object({
  collection: z.string().describe("Collection slug to search in."),
  query: z.string().min(1).describe("Text to search for (case-insensitive)"),
  contextChars: z
    .number()
    .int()
    .min(0)
    .max(500)
    .optional()
    .default(150)
    .describe("Characters of context to show around each match"),
  locale: z
    .string()
    .optional()
    .describe(
      "Locale code to search within a specific language's content. Omit for the default locale."
    ),
});

export function createSearchContentTool(io: DocumentIO, schema: SchemaContext) {
  const collectionSlugs = schema.collections.map((collection) => collection.slug);

  return tool({
    description: `Search for text inside document CONTENT - every plain-text and rich-text field, including fields inside blocks, array rows, and groups (same coverage as findReplaceContent). Runs server-side - doesn't bloat the context window. Returns "matchedIds" (every matching document id, up to ${MAX_MATCHED_IDS} - pass these straight to findReplaceContent, or to editContent as its ids, to cover the matches) plus "matches" with snippets for the first few. Available collections: ${collectionSlugs.join(", ")}`,
    inputSchema: searchContentInput,
    execute: (input: SearchInput) => searchContent({ io, schema, collectionSlugs }, input),
    toModelOutput: ({ output }) => ({
      type: "text" as const,
      value: typeof output === "string" ? output : JSON.stringify(output),
    }),
  });
}
