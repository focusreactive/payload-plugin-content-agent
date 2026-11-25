import { createFailure, missingRequired } from "./documents/requiredFields.js";
import { IMPORT_ARTICLE_WRITE_ID } from "./writeIds.js";
import { tool } from "ai";
import { z } from "zod";
import { htmlToLexical } from "../subAgents/htmlToLexical.js";
import type { DocumentIO } from "../content/documentIo.js";
import type { SchemaCollection, SchemaContext, SchemaField } from "../../types.js";
import { titleFieldOf } from "../../schema/titleField.js";
import { containsBlocksArray } from "./blockWriteGuard.js";
import { assessUpdateRisk } from "./review.js";
import { simplifyForEditor } from "../content/editorFit.js";
import { countNodes, isEmptyRichText } from "../content/lexicalEngine.js";
import { safeFetch, readTextCapped } from "./web.js";
import type { EditRecordRef } from "../../types.js";

const MAX_IMPORT_BODY_BYTES = 5_000_000;

type RecordEdits = (refs: EditRecordRef[]) => void;

interface ImportContext {
  io: DocumentIO;
  schema: SchemaContext;
  recordEdits?: RecordEdits;
}

interface ImportInput {
  url: string;
  collection: string;
  bodyField?: string;
  excerptField?: string;
  data?: Record<string, unknown>;
}

interface ImportFetchFailure {
  html?: undefined;
  error: string;
  url: string;
}

async function fetchArticleHtml(
  url: string
): Promise<{ html: string; pageUrl: string } | ImportFetchFailure> {
  let html: string;
  let pageUrl: string;

  try {
    const { res, error, finalUrl } = await safeFetch(url, {
      headers: {
        "User-Agent": "PayloadContentAgent/1.0",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (error || !res) return { error: error ?? "Fetch failed", url };
    if (!res.ok) return { error: `HTTP ${res.status} ${res.statusText}`, url: finalUrl ?? url };
    html = await readTextCapped(res, MAX_IMPORT_BODY_BYTES);
    pageUrl = finalUrl ?? url;
  } catch (err) {
    return { error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`, url };
  }

  return { html, pageUrl };
}

// The HTML parser throws on a body with no element (empty, or plain text).
function readArticle(html: string, pageUrl: string): ReturnType<typeof htmlToLexical> | null {
  try {
    return htmlToLexical(html, pageUrl);
  } catch {
    return null;
  }
}

interface ImportedArticle {
  title: string;
  excerpt: string;
  lexicalContent: unknown;
}

interface ImportTarget {
  bodyField: string;
  titleField?: string;
  excerptField?: string;
}

const writable = (field: SchemaField): boolean => !field.readOnly && !field.unsupported;

const namesOf = (fields: SchemaField[]): string =>
  fields.map((field) => `\`${field.name}\``).join(", ");

function resolveTarget(
  target: SchemaCollection,
  { collection, bodyField, excerptField, data }: ImportInput
): ImportTarget | { error: string } {
  const fields = target.fields.filter(writable);
  const bodies = fields.filter((field) => field.type === "richText");
  const texts = fields.filter((field) => field.type === "text" || field.type === "textarea");
  const unknown = Object.keys(data ?? {}).filter(
    (name) => !target.fields.some((field) => field.name === name)
  );

  if (unknown.length)
    return {
      error: `"${collection}" has no field ${unknown.map((name) => `\`${name}\``).join(", ")} in \`data\`. Fields: ${namesOf(target.fields)}. Call importArticle again with field names of the collection.`,
    };
  if (!bodies.length)
    return {
      error: `Collection "${collection}" has no rich text field the agent can write - an article cannot be imported here. Fields: ${namesOf(target.fields)}. Call importArticle with a collection that has one.`,
    };
  if (bodyField ? !bodies.some((field) => field.name === bodyField) : bodies.length > 1)
    return {
      error: `Pass \`bodyField\` - the rich text field of "${collection}" that receives the article. Valid values: ${namesOf(bodies)}.`,
    };
  if (excerptField && !texts.some((field) => field.name === excerptField))
    return {
      error: `\`excerptField\` "${excerptField}" is not a text field of "${collection}". Valid values: ${namesOf(texts)}.`,
    };
  const titleField = titleFieldOf(target);

  return {
    bodyField: bodyField ?? bodies[0].name,
    excerptField,
    titleField: fields.some((field) => field.name === titleField && field.type === "text")
      ? titleField
      : undefined,
  };
}

function fitBody(fields: SchemaField[], bodyField: string, content: unknown) {
  const body = fields.find((field) => field.name === bodyField);
  const fitted = body ? simplifyForEditor(body, content) : { content, simplified: [] };

  return {
    content: fitted.content,
    warnings: fitted.simplified.length
      ? [
          `The editor of "${bodyField}" has no ${fitted.simplified.join(", ")}: that markup was dropped and its text kept.`,
        ]
      : [],
  };
}

function buildImportData(
  { collection, data: given }: ImportInput,
  { bodyField, titleField, excerptField }: ImportTarget,
  { title, excerpt, lexicalContent }: ImportedArticle
) {
  // No `_status` or `draft` here: DocumentIO.create owns draft semantics,
  // and both are reserved MCP control keys.
  const data: Record<string, unknown> = { ...given, [bodyField]: lexicalContent };
  const warnings: string[] = [];

  if (titleField && title) data[titleField] ??= title;
  else if (titleField && data[titleField] === undefined)
    warnings.push(
      `The page names no title, so "${titleField}" was not set. Ask the person for one and set it on the draft.`
    );
  else if (!titleField)
    warnings.push(
      `"${collection}" has no text field as its title - the title "${title}" was not set.`
    );
  if (excerptField && excerpt) data[excerptField] ??= excerpt;

  return { data, warnings };
}

const importFailure = (error: unknown, fields: SchemaField[], data: Record<string, unknown>) =>
  createFailure(
    error,
    missingRequired(fields, data),
    "Call importArticle again with the same url and a value for each of them in `data`."
  );

function importDataError(
  schemaFields: SchemaField[],
  data: Record<string, unknown>
): { error: string } | null {
  for (const [key, value] of Object.entries(data)) {
    if (containsBlocksArray(value)) {
      return {
        error:
          `Refusing to create with the "${key}" blocks field - create the document WITHOUT blocks, ` +
          `then compose sections via editContent (schema-validated).`,
      };
    }
  }

  const forbidden = assessUpdateRisk(schemaFields, {}, data).filter(
    (risk) => risk.kind === "forbidden"
  );

  if (forbidden.length) {
    return {
      error: `Refused: ${forbidden.map((risk) => risk.reason).join(" ")} Remove the field(s) from data.`,
    };
  }

  return null;
}

const EMPTY_PAGE =
  'Nothing was created: the page gave no text to import (empty content). A page that renders its text in the browser looks like this. Call web with action "fetch" to see what it returns, or tell the person.';

async function importArticle({ io, schema, recordEdits }: ImportContext, input: ImportInput) {
  const { url, collection } = input;
  const collSchema = schema.collections.find((candidate) => candidate.slug === collection);

  if (!collSchema) {
    return {
      error: `Unknown collection "${collection}". Available: ${schema.collections.map((candidate) => candidate.slug).join(", ")}`,
    };
  }

  const schemaFields = collSchema.fields;
  const target = resolveTarget(collSchema, input);

  if ("error" in target) return target;

  const fetched = await fetchArticleHtml(url);

  if (fetched.html === undefined) return fetched;

  const article = readArticle(fetched.html, fetched.pageUrl);

  if (!article) {
    return {
      error:
        'This URL returned no HTML to import (an empty body, or a file that is not a web page). Check the URL, or call web with action "fetch" to see what it returns.',
      url,
    };
  }

  const { title: rawTitle, excerpt } = article;
  const fitted = fitBody(schemaFields, target.bodyField, article.lexicalContent);
  const lexicalContent = fitted.content;
  const title = rawTitle.length > 300 ? rawTitle.slice(0, 300) : rawTitle;
  const nodeCount = countNodes(lexicalContent);

  if (isEmptyRichText(lexicalContent)) {
    return { error: EMPTY_PAGE, url, title };
  }

  if (!io.transports({ collection }).create) {
    return {
      error: `Cannot create documents in "${collection}" - the site gives the agent no way to create there.`,
      url,
      title,
    };
  }

  const { data, warnings } = buildImportData(input, target, { title, excerpt, lexicalContent });
  const dataError = importDataError(schemaFields, data);

  warnings.push(...fitted.warnings);

  if (dataError) return dataError;

  const { doc, error } = await io.create({ collection }, { data, callId: IMPORT_ARTICLE_WRITE_ID });

  if (error) {
    console.error("[importArticle] Create failed:", error);

    return {
      error: importFailure(error, schemaFields, data),
      url,
      title,
      nodeCount,
    };
  }

  const docId: string | undefined = doc?.id != null ? String(doc.id) : undefined;
  const required = missingRequired(schemaFields, data);

  // The Local API create path records nothing by itself.
  if (doc?.id != null)
    recordEdits?.([
      {
        collection,
        id: doc.id,
        op: "create",
        before: {},
        after: doc,
        toolName: "importArticle",
      },
    ]);

  return {
    message: docId
      ? `Created draft "${title}" (#${docId}) with ${nodeCount} content nodes`
      : `Draft creation response could not be parsed - verify in the admin before retrying (do NOT immediately re-import; that may duplicate).`,
    documentId: docId,
    title,
    ...(excerpt && !target.excerptField ? { excerpt } : {}),
    nodeCount,
    url,
    collection,
    created: !!docId,
    ...(warnings.length ? { warnings } : {}),
    ...(required.length ? { requiredStillEmpty: required } : {}),
  };
}

export function createImportArticleTool(
  io: DocumentIO,
  schema: SchemaContext,
  recordEdits?: (refs: EditRecordRef[]) => void
) {
  return tool({
    description:
      "Import an article from a URL and create a draft in the CMS. Programmatically fetches the page, converts ALL content to Lexical JSON (zero truncation), and creates the draft: the page title goes to the collection's title field and the content to its rich text field. Values for every other field go in `data`, under the field names of the schema: find the documents its relationship fields point at first and pass their ids there. The tool creates the draft itself, so call no create tool after it. Several URLs: one call per URL, one after another.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL of the article to import"),
      collection: z.string().describe("Collection slug."),
      bodyField: z
        .string()
        .optional()
        .describe(
          "The rich text field that receives the article. Needed only when the collection has more than one."
        ),
      excerptField: z
        .string()
        .optional()
        .describe("A text field that receives the page's summary. Omit to get the summary back."),
      data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Values for other fields of the collection, by field name: a unique key, ids of related documents, and so on."
        ),
    }),
    execute: (input: ImportInput) => importArticle({ io, schema, recordEdits }, input),
  });
}
