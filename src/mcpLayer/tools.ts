import { z } from "zod";
import type { SchemaContext } from "../types.js";
import type { DocumentIO } from "../agent/content/documentIo.js";
import { collectBlockDefs, renderSchemaForPrompt } from "../schema/introspector.js";
import { schemaInfo } from "../agent/tools/schemaInfo.js";
import { listDocuments, listDocumentsInput } from "../agent/tools/documents/listDocuments.js";
import { readDocument, readDocumentInput } from "../agent/tools/documents/readDocument.js";
import {
  findDocuments,
  findDocumentsInput,
  searchableCollections,
} from "../agent/tools/findDocuments.js";
import { searchContent, searchContentInput } from "../agent/tools/searchContent.js";
import { CHECK_LINKS_DESCRIPTION, checkLinks, checkLinksInput } from "../agent/tools/checkLinks.js";
import type { EditRecordRef } from "../types.js";
import type { McpCallOptions } from "../borders.js";
import type { ToolSurface } from "../agent/toolSurface.js";
import { parseMcpDoc } from "../agent/mcpParse.js";
import { previewUpdate } from "../agent/tools/review.js";
import { gatedMcpWrite } from "../agent/tools/mcp/writeGate.js";
import {
  listAddInput,
  resolveUpdate,
  withListEdits,
} from "../agent/tools/documents/updateDocument.js";
import { createDocument } from "../agent/tools/documents/createDocument.js";
import { stripContent } from "../agent/tools/documents/stripContent.js";
import { findReplaceContent, findReplaceInputSchema } from "../agent/content/findReplace.js";
import { removalRefusal } from "./editChecks.js";
import { fieldsForTarget } from "../agent/content/workspaceTools.js";
import { noDraftsCreateRefusal, noDraftsRefusal } from "../agent/content/draftsOnly.js";
import { validateLocaleArg } from "../agent/content/discovery.js";
import type { LinkProbe } from "../agent/content/links.js";
import type { SanitizedConfig } from "payload";
import { EDIT, EDIT_DESCRIPTION, editDocument, editDocumentInput } from "./editDocument.js";

export type WriteOperation = "create" | "update";

/** What the key may write with one operation. */
export interface LayerWrites {
  schema: SchemaContext;
  io: DocumentIO;
  recordEdits: (refs: EditRecordRef[]) => void;
  /** The config of the site: a rich text value is validated against its editor. */
  config?: SanitizedConfig;
  probeLink?: LinkProbe;
}

export interface LayerContext {
  /** What the key may read. */
  schema: SchemaContext;
  io: DocumentIO;
  writes: (operation: WriteOperation) => LayerWrites;
}

export interface LayerTool {
  name: string;
  description: string;
  input: z.ZodObject;
  run: (context: LayerContext, args: Record<string, unknown>) => unknown;
}

function layerTool<Shape extends z.ZodRawShape>(definition: {
  name: string;
  description: string;
  input: z.ZodObject<Shape>;
  run: (context: LayerContext, input: z.infer<z.ZodObject<Shape>>) => unknown;
}): LayerTool {
  return {
    name: definition.name,
    description: definition.description,
    input: definition.input,
    run: (context, args) => {
      const input = definition.input.parse(args);
      const locale: unknown = "locale" in input ? input.locale : undefined;
      const localeError = validateLocaleArg(
        context.schema,
        typeof locale === "string" ? locale : undefined
      );

      return localeError ? { error: localeError } : definition.run(context, input);
    },
  };
}

// Not `findDocuments`: the MCP plugin gives that name to the find tool of a collection `documents`.
const NAME_SEARCH = "lookupDocuments";

const LOCALE_HINT =
  "To read the content of one language, pass its locale code as `locale` to the tool.";

const NOTHING_TO_READ =
  "This key can read no collection and no global. A person with access to the admin of the site turns on the find permission of a collection or global on the API key; then call getSchemaInfo again.";

const READ_ONLY_WITHOUT_DRAFTS = "Agent access: read only (no drafts)";

function schemaOverview(schema: SchemaContext): string {
  if (!schema.collections.length && !schema.globals.length) return NOTHING_TO_READ;

  return renderSchemaForPrompt(schema, "auto", {
    localeHint: LOCALE_HINT,
    noDraftsNote: READ_ONLY_WITHOUT_DRAFTS,
  }).text;
}

export const READ_TOOLS: LayerTool[] = [
  layerTool({
    name: "getSchemaInfo",
    description:
      "Start here. Without `target` it returns the overview of the content this key can read: every collection and global with its fields, their types, which of them are required, their options, and the locales of the site. With `target` it returns the full schema of one collection, global or block by slug; use it for a block that the overview lists by slug only. The other tools take their slugs and field names from this overview, so read it before the first call of another tool.",
    input: z.object({
      target: z
        .string()
        .optional()
        .describe("The slug of one collection, global or block. Omit it for the overview."),
    }),
    run: ({ schema }, { target }) =>
      target ? schemaInfo(schema, collectBlockDefs(schema), target) : schemaOverview(schema),
  }),
  layerTool({
    name: "listDocuments",
    description:
      "Lists the documents of one collection, paged, as draft versions. Each row is a document with its rich text and blocks summarized. The result holds the exact total (`totalDocs`) and `ids`, every id of the page, kept whole also when the rows are cut for size. To filter or to count by a field, pass a Payload `where` clause and read `totalDocs`; do not page through a collection to count. To find a document by its name use lookupDocuments. To find a text inside the content use searchContent.",
    input: listDocumentsInput,
    run: ({ io, schema }, input) => listDocuments(io, schema, input),
  }),
  layerTool({
    name: NAME_SEARCH,
    description:
      "Finds documents by name across the collections in one call, for when you know what a document is called and not where it lives. It matches the words of `query` against the title-like fields of each collection (case-insensitive, every word must appear) and returns the hits by collection, with ids. It does not look into the body of a document: searchContent does that.",
    input: findDocumentsInput,
    run: ({ io, schema }, input) =>
      findDocuments({ io, schema, searchable: searchableCollections(schema) }, input),
  }),
  layerTool({
    name: "searchContent",
    description:
      "Searches for a text inside the content of one collection: every plain text and rich text field, also inside blocks, array rows and groups. The match is literal and case-insensitive. It returns `matchedIds`, the ids of the documents that hold the text, and `matches`, with snippets and the field of each snippet for the first documents.",
    input: searchContentInput,
    run: ({ io, schema }, input) =>
      searchContent(
        { io, schema, collectionSlugs: schema.collections.map((collection) => collection.slug) },
        input
      ),
  }),
  layerTool({
    name: "checkLinks",
    description: CHECK_LINKS_DESCRIPTION,
    input: checkLinksInput,
    // No probe: a key from outside does not make the site send requests.
    run: ({ io, schema }, input) => checkLinks({ io, schema }, input),
  }),
  layerTool({
    name: "readDocument",
    description:
      "Reads one document by id as its draft version, or a global by slug. The view decides what comes back. The default view gives the fields with rich text and blocks summarized. The view `outline` gives the section structure: the block types in order with the stable id of each block, the fields each block carries, the row counts of its nested arrays, and the ids of the documents that its relationship and upload fields point to. The view `text` gives all readable content as plain lines, paged: when the result has `next`, call again with `cursor` set to that value until no `next` comes back. The view `links` gives every link of the document with its anchor text, target, kind and field, and the count. `path` gives the raw value of one field or section; an array row is addressed by its id in brackets, taken from the view `outline`.",
    input: readDocumentInput,
    run: ({ io, schema }, input) => readDocument(io, schema, input, NAME_SEARCH),
  }),
];

const UPDATE = "patchDocument";
const CREATE = "addDocument";
const REPLACE = "replaceText";
const REPLACE_CONCURRENCY = 5;

const BY_A_PERSON =
  "A person makes this change in the admin panel of the site, by hand or in the content agent chat there.";

const LAYER_SURFACE: ToolSurface = {
  update: UPDATE,
  create: CREATE,
  edit: EDIT,
  nameSearch: NAME_SEARCH,
  destructiveRefusal: (reasons) =>
    `Refused, nothing was written: this update removes or shrinks what the document holds. ${reasons} No content agent tool makes such an update with any input, so do not send it again. Tell the person what would be lost. ${BY_A_PERSON}`,
  blocksUpdateRefusal: (field) =>
    `Refused, nothing was written: ${UPDATE} does not write the "${field}" blocks field. Send the update without that field, and change the blocks with ${EDIT}: its operations insertItem and moveItem add and reorder blocks, and set writes a field of one block.`,
  richTextUpdateRefusal: (field) =>
    `Refused, nothing was written: ${UPDATE} does not write the "${field}" rich text field. Send the update without that field, and change its text with ${EDIT}.`,
  blocksCreateRefusal: (field) =>
    `Refused, nothing was created: ${CREATE} does not write the "${field}" blocks field. Create the document without that field, then add its blocks with the insertItem operation of ${EDIT}.`,
  destructivePreviewNote: `This update removes or shrinks existing content, so ${UPDATE} refuses it: no content agent tool makes such an update. ${BY_A_PERSON}`,
  noDraftsRefusal: (label) =>
    `${label} has no drafts, so the content agent tools do not write to it: a write would go live at once. Nothing was written. No content agent tool writes this target, so do not try another one of them. Tell the person the two ways out: make this change by hand in the admin panel, or ask a developer to enable drafts (versions.drafts) for it. Reading it still works.`,
  noDraftsCreateRefusal: (label) =>
    `${label} has no drafts, so the content agent tools create no document in it: it would be live at once. Nothing was created. No content agent tool creates one there, so do not try another one of them. Tell the person the two ways out: create the document by hand in the admin panel, or ask a developer to enable drafts (versions.drafts) for it. Reading it still works.`,
};

// The gate reads only the call id, and this one is not an internal save.
const GATE_CALL = { toolCallId: "mcp-layer", messages: [] } as unknown as McpCallOptions;

const quoted = (slugs: string[]): string => slugs.map((slug) => `"${slug}"`).join(", ") || "none";

const writable = (entries: Array<{ slug: string; hasDrafts: boolean }>): string =>
  quoted(entries.filter((entry) => entry.hasDrafts).map((entry) => entry.slug));

function permissionError(
  { schema }: LayerWrites,
  operation: WriteOperation,
  target: { collection?: string; global?: string }
): string | null {
  const collections = schema.collections.map((collection) => collection.slug);
  const globals = schema.globals.map((global) => global.slug);
  const allowed = target.global
    ? globals.includes(target.global)
    : !target.collection || collections.includes(target.collection);

  if (target.collection && target.global) return null;
  if (allowed)
    return operation === "create"
      ? noDraftsCreateRefusal(schema, target, LAYER_SURFACE)
      : noDraftsRefusal(schema, target, LAYER_SURFACE);
  const named = target.global ? `global "${target.global}"` : `collection "${target.collection}"`;
  const open =
    operation === "create"
      ? `Collections: ${writable(schema.collections)}.`
      : `Collections: ${writable(schema.collections)}. Globals: ${writable(schema.globals)}.`;

  return `This key cannot ${operation} the ${named}. What it can ${operation}: ${open} A person with access to the admin of the site turns on the ${operation} permission on the API key.`;
}

function savedResult(result: unknown, target: { collection?: string; global?: string }): unknown {
  if (typeof result === "object" && result !== null && "error" in result)
    return { error: result.error };
  const doc = parseMcpDoc(result);

  return {
    ok: true,
    ...(target.global ? { global: target.global } : { collection: target.collection, id: doc?.id }),
    savedAs: "draft",
    doc: stripContent(doc),
  };
}

/** A rich text value sent whole can blank its text with the same nodes, which no removal check
 *  sees: rich text changes only through the operations of editDocument. */
function richTextRefusal(
  schema: SchemaContext,
  {
    collection,
    global,
    data,
  }: { collection?: string; global?: string; data: Record<string, unknown> }
): string | null {
  const fields = fieldsForTarget(schema, global ? { global } : { collection });
  const names = Object.keys(data).filter((key) =>
    fields.some((field) => field.name === key && field.type === "richText")
  );

  return names.length
    ? `Refused, nothing was written: ${UPDATE} does not write rich text (${names.map((name) => `"${name}"`).join(", ")}). Send the other fields without it, and change the rich text with ${EDIT}: its operations replaceText, insertText and replacePart change the text and keep the rest.`
    : null;
}

// An agent from outside has no person to ask, and the endpoint sets no limit of its own.
const noBulkLimit = (): null => null;

export const WRITE_TOOLS: LayerTool[] = [
  layerTool({
    name: UPDATE,
    description: `Sets fields of one existing document or global and saves the result as a draft; it publishes nothing. Every field you send replaces the stored value, and a field you omit stays as it is, so send only the fields that change. Take the field names, types and options from getSchemaInfo. An array field is replaced whole: send its complete new value. A field with many values (hasMany) in \`data\` is replaced whole too; to put entries into its list, leave it out of \`data\` and name only the new entries in \`add\`: every entry it holds stays, so you never write them again. A blocks field is refused, and a rich text field is not changed here: ${EDIT} changes blocks, array rows and rich text. An update that removes or empties what the document holds is refused: the content agent tools make no destructive update. A document that a person edits in the admin at the moment, and a collection or global without drafts, are refused too. With \`preview: true\` nothing is written: the call reads the current draft, compares it with the fields in \`data\` and the lists that \`add\` gives, and returns { fieldsChanged, diff, warnings, safe }; use it when you are not sure what a change removes. When the site keeps a history of the content agent, a person can review and discard the change in the admin.`,
    input: z.object({
      collection: z.string().optional().describe("Collection slug. Pass it with `id`."),
      global: z.string().optional().describe("Global slug, in place of `collection` and `id`."),
      id: z.union([z.string(), z.number()]).optional().describe("The document id."),
      data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "The fields to set, by the field names of the schema. Leave it out when `add` carries the whole change."
        ),
      add: listAddInput,
      locale: z
        .string()
        .optional()
        .describe("Locale code of the localized fields. Omit it for the default locale."),
      preview: z
        .boolean()
        .optional()
        .describe(
          "true = write nothing and return what this exact call would change. Pass the same input you plan to send."
        ),
    }),
    run: async (context, input) => {
      const writes = context.writes("update");
      const denied = permissionError(writes, "update", input);

      if (denied) return { error: denied };
      const { schema, io, recordEdits } = writes;
      const targets = [
        ...schema.collections.map((collection) => ({ collection: collection.slug })),
        ...schema.globals.map((global) => ({ global: global.slug })),
      ];
      const found = resolveUpdate(schema, targets, input, LAYER_SURFACE);

      if ("error" in found) return { error: found.error };
      const richText = richTextRefusal(schema, { ...input, data: found.data });

      if (richText) return { error: richText };
      const resolved = await withListEdits({ io, schema, surface: LAYER_SURFACE }, found, input);

      if ("error" in resolved) return { error: resolved.error };
      if (input.preview)
        return previewUpdate(
          { io, schema, surface: LAYER_SURFACE },
          { ...input, data: resolved.data }
        );
      const gate = { schema, documentIo: () => io, recordEdits, surface: LAYER_SURFACE };

      return savedResult(
        await gatedMcpWrite(gate, resolved.target, resolved.params, GATE_CALL),
        input
      );
    },
  }),
  layerTool({
    name: CREATE,
    description: `Creates a new document in one collection, always as a draft. Send the fields in \`data\` under the field names from getSchemaInfo; the required ones are marked there. Check first with ${NAME_SEARCH} that the document does not exist yet: a second call with the same data makes a second document. A blocks field is refused: create the document without it, then add the blocks with ${EDIT}. When the site keeps a history of the content agent, a person can review the new document in the admin.`,
    input: z.object({
      collection: z.string().describe("Collection slug"),
      data: z
        .record(z.string(), z.unknown())
        .describe(
          "The fields of the new document, by the field names of the schema. No blocks field."
        ),
      locale: z
        .string()
        .optional()
        .describe("Locale code of the localized fields. Omit it for the default locale."),
    }),
    run: (context, input) => {
      const writes = context.writes("create");
      const denied = permissionError(writes, "create", input);

      return denied
        ? { error: denied }
        : createDocument({ ...writes, surface: LAYER_SURFACE }, input);
    },
  }),
  layerTool({
    name: EDIT,
    description: EDIT_DESCRIPTION,
    input: editDocumentInput,
    run: (context, input) => {
      const writes = context.writes("update");
      const denied = permissionError(writes, "update", input);

      return denied ? { error: denied } : editDocument(writes, LAYER_SURFACE, input);
    },
  }),
  layerTool({
    name: REPLACE,
    description: `Replaces one exact string with another in the documents you name. No model takes part: the match is literal and case-sensitive, and nothing else in the document changes. It replaces the string in plain text fields, in rich text prose and in the targets of rich text links, and keeps the structure. Get the ids from searchContent (its \`matchedIds\`). It changes every occurrence of the string in those documents, so name only the documents that should change. The documents are saved as drafts. A document whose change would empty a field or cut most of its text is not written and is listed as failed. The result gives the number of replacements, the documents without a match and the ids that failed.`,
    input: findReplaceInputSchema,
    run: (context, input) => {
      const writes = context.writes("update");
      const denied = permissionError(writes, "update", input);

      return denied
        ? { error: denied }
        : findReplaceContent(
            {
              ...writes,
              concurrency: REPLACE_CONCURRENCY,
              bulkRefusal: noBulkLimit,
              documentRefusal: (before, after) =>
                removalRefusal(
                  {
                    schema: writes.schema,
                    surface: LAYER_SURFACE,
                    target: { collection: input.collection },
                    tool: REPLACE,
                  },
                  before,
                  after
                ),
            },
            input
          );
    },
  }),
];

export const LAYER_TOOLS: LayerTool[] = [...READ_TOOLS, ...WRITE_TOOLS];
