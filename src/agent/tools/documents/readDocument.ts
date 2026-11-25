import { tool } from "ai";
import { z } from "zod";
import type { PayloadDoc } from "../../../borders.js";
import type { SchemaContext, SchemaField } from "../../../types.js";
import type { DocumentIO } from "../../content/documentIo.js";
import {
  formatPath,
  parsePath,
  resolveFieldAtPath,
  validateLocaleArg,
} from "../../content/discovery.js";
import { documentText, pageSections } from "../../content/documentText.js";
import { documentOutline } from "../../content/outline.js";
import { linkInventory } from "../listLinks.js";
import { documentNotFoundError, unknownTargetError } from "../../toolErrors.js";
import { capMcpToolOutput, stringifyCapped } from "../outputCap.js";
import { stripContent } from "./stripContent.js";
import { historyView } from "./historyView.js";

export interface ReadInput {
  collection?: string;
  global?: string;
  id?: string | number;
  locale?: string;
  view?: string;
  cursor?: string;
  path?: string;
  draft?: boolean;
}

interface ReadDocument {
  fields: SchemaField[];
  doc: PayloadDoc;
  where: { global: string } | { collection: string | undefined; id: string | number | undefined };
}

function targetError({ collection, global, id }: ReadInput): { error: string } | null {
  if (!!collection === !!global)
    return {
      error:
        "Provide exactly ONE of `collection` (with `id`) or `global`. The slugs are in the schema; the id of a document comes from a listDocuments or findDocuments result.",
    };
  if (collection && (id === undefined || id === null || String(id).trim() === ""))
    return {
      error:
        "An `id` is required with `collection`. Take it from a listDocuments or findDocuments result.",
    };

  return null;
}

function sectionView(
  { fields, doc, where }: ReadDocument,
  { collection, global, id, locale }: ReadInput,
  path: string
) {
  const parsed = parsePath(path);
  const res = resolveFieldAtPath(fields, doc, parsed);

  if (!res)
    return {
      error:
        `Path "${path}" does not resolve in this document. Arrays are addressed by the row id in [brackets] ` +
        `(shown by the outline view), not by position - call readDocument({ ${global ? `global: "${global}"` : `collection: "${collection}", id: "${id}"`}, view: "outline" }) and copy the id from there.`,
    };

  return capMcpToolOutput({
    ...where,
    ...(locale ? { locale } : {}),
    path: formatPath(parsed),
    ...(res.field?.type ? { fieldType: res.field.type } : {}),
    value: res.value ?? null,
  });
}

function textView({ fields, doc, where }: ReadDocument, { locale, cursor }: ReadInput) {
  if (cursor !== undefined && !/^\d+(:\d+)?$/u.test(cursor.trim()))
    return {
      error: `cursor "${cursor}" is not a \`next\` value of this document. Call readDocument with view "text" and no \`cursor\` for the first page, then pass the \`next\` of each result unchanged.`,
    };

  const all = documentText(fields, doc);
  const page = pageSections(all, cursor);
  const chars = all.reduce((sum, section) => sum + section.text.length, 0);

  return {
    ...where,
    ...(locale ? { locale } : {}),
    view: "text",
    totalChars: chars,
    sections: page.sections,
    sectionsShown: `${page.from + 1}-${page.to} of ${page.total}`,
    ...(page.next
      ? {
          next: page.next,
          note: `More content follows: call readDocument again with cursor: "${page.next}" (same document, same view) until no \`next\` is returned. Do not stop here and do not ask which part to read.`,
        }
      : { complete: true }),
  };
}

function outlineView({ fields, doc, where }: ReadDocument, { locale }: ReadInput) {
  const outline = documentOutline(fields, doc);

  return capMcpToolOutput({
    ...where,
    ...(locale ? { locale } : {}),
    structure: outline,
    ...(outline.length === 0
      ? {
          note: "This document has no blocks or array content - its structure is flat fields only.",
        }
      : {}),
  });
}

function linksView({ fields, doc }: ReadDocument, { collection, global, id }: ReadInput) {
  return capMcpToolOutput(linkInventory(fields, doc, global ?? `${collection}/${id}`));
}

const VIEWS: Record<string, (read: ReadDocument, input: ReadInput) => unknown> = {
  text: textView,
  outline: outlineView,
  links: linksView,
};

const CALL_IDS: Record<string, string> = {
  text: "read-text",
  outline: "outline",
  links: "list-links",
};

function inputError(schema: SchemaContext, input: ReadInput): { error: string } | null {
  const invalid = targetError(input);

  if (invalid) return invalid;
  const localeError = input.view === "links" ? validateLocaleArg(schema, input.locale) : null;

  return localeError ? { error: localeError } : null;
}

const wantsHistory = ({ view, path }: ReadInput): boolean => view === "history" && !path?.trim();

export async function readDocument(
  io: DocumentIO,
  schema: SchemaContext,
  input: ReadInput,
  nameSearch?: string
) {
  const { collection, global, id, locale, view, path, draft } = input;
  const invalid = inputError(schema, input);

  if (invalid) return invalid;
  const fields = global
    ? schema.globals.find((candidate) => candidate.slug === global)?.fields
    : schema.collections.find((candidate) => candidate.slug === collection)?.fields;

  if (!fields) return { error: unknownTargetError(schema, { collection, global }) };
  if (wantsHistory(input)) return historyView(io, input);
  const { doc, error } = await io.read(global ? { global } : { collection }, {
    id,
    locale,
    draft: draft !== false,
    callId: path ? "read-section" : ((view && CALL_IDS[view]) ?? "read-document"),
  });

  if (error) return { error };
  if (!doc) return { error: documentNotFoundError(global ?? `${collection}/${id}`, nameSearch) };
  const where = global ? { global } : { collection, id };

  if (path && path.trim()) return sectionView({ fields, doc, where }, input, path);

  const render = view ? VIEWS[view] : undefined;

  if (render) return render({ fields, doc, where }, input);

  return capMcpToolOutput({ doc: stripContent(doc) });
}

export const readDocumentInput = z.object({
  collection: z
    .string()
    .optional()
    .describe("Collection slug (with `id`). Omit when reading a global."),
  global: z
    .string()
    .optional()
    .describe("Global slug. Provide EITHER `global` OR `collection`+`id`."),
  id: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Document id (required with `collection`)"),
  locale: z.string().optional().describe("Locale code. Omit for the default locale."),
  draft: z
    .boolean()
    .optional()
    .describe(
      "Omit it: the draft version is read. Pass false only when the person asks for the published version."
    ),
  view: z
    .enum(["fields", "outline", "text", "links", "history"])
    .optional()
    .describe(
      '"outline" = section structure and block ids; "text" = the full readable content, paged (follow `next`); "links" = every link with a count; "history" = the saved versions with their dates and what each changed, the oldest 200 at most, for a collection or global that keeps versions. Default "fields".'
    ),
  cursor: z
    .string()
    .optional()
    .describe('With view "text": the `next` value of the previous page.'),
  path: z
    .string()
    .optional()
    .describe(
      'Read ONE field/section raw, by path; arrays addressed by row id: "<blocksField>[<blockId>].<field>". Take the field names and the row ids from view "outline". With `path` the `view` is ignored.'
    ),
});

export function createReadDocumentTool(io: DocumentIO, schema: SchemaContext) {
  const collectionSlugs = schema.collections.map((collection) => collection.slug);
  const globalSlugs = schema.globals.map((global) => global.slug);

  return tool({
    description:
      `Read ONE document by id (draft version), or a GLOBAL by slug - works for every collection and global of the schema. Pick the view by the job: ` +
      `(default) the document's fields with rich text and blocks summarized (a blocks array shows as "[15 blocks]"); ` +
      `view "outline" = the SECTION STRUCTURE - ordered block types with the stable id of each block in [brackets], which fields each carries, how many rows its nested arrays hold, and relationship/upload fields with their REAL document ids (e.g. \`<field>: → <collection> [3, 2, 5, 8]\`). No rich text bodies, so it is the cheap first look at a page: use it whenever the structure itself matters - modelling a new page on an existing one, auditing which sections a page uses, checking a page came out as intended, or reading WHICH documents a page references so you can pass those ids literally in an editContent instruction. For a new document with the SAME structure prefer cloneDocument; ` +
      `view "text" = ALL of its readable content - every text field and rich text body, flattened to plain lines, paged: when the result carries \`next\`, call again with \`cursor: next\` for the rest until there is no \`next\`. This is how you read, quote, summarize, proofread or check the full content of a page; never stop at one page and never ask the user to pick a way of reading it; ` +
      `view "links" = EVERY hyperlink of the document in a single call, with the count: Lexical link nodes in rich text, Markdown [text](url) links, bare URLs and URL-valued fields, across all fields (groups, arrays, blocks included), each with its anchor text, target, kind and the exact field it is in. Use it for any question about the links of one document (find, list, count, audit, check) - never read fields one by one hoping to find the body; for the links of a whole collection call checkLinks once, do not read its documents one by one; ` +
      `view "history" = the saved versions of the document, the oldest first: when each was saved, its status (draft or published), the date of the first published version, and what each save changed against the one before it (plain values such as a title or a slug with their old and new value, other fields by name). Use it for any question about when a document was created, published or changed, and what its address or title was before. ` +
      `\`path\` = the RAW value of ONE field or section, e.g. "<blocksField>[<blockId>].<field>" (ids from view "outline") - for copying a section's rows to another document. ` +
      `Collections: ${collectionSlugs.join(", ")}${globalSlugs.length ? `. Globals: ${globalSlugs.join(", ")}` : ""}`,
    inputSchema: readDocumentInput,
    execute: (input: ReadInput) => readDocument(io, schema, input),
    toModelOutput: ({ output }) => ({
      type: "text" as const,
      value: typeof output === "string" ? output : stringifyCapped(output),
    }),
  });
}
