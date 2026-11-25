import { tool } from "ai";
import { z } from "zod";
import type { EditRecordRef, SchemaContext } from "../../../types.js";
import type { DocumentIO } from "../../content/documentIo.js";
import { healEmptyRichTextDeep } from "../../content/schemaValues.js";
import { containsBlocksArray } from "../blockWriteGuard.js";
import { assessUpdateRisk } from "../review.js";
import { createFailure, fillRequiredRichText, missingRequired } from "./requiredFields.js";
import { stripContent } from "./stripContent.js";
import { CREATE_DOCUMENT_WRITE_ID } from "../writeIds.js";
import { CHAT_SURFACE } from "../../toolSurface.js";
import type { ToolSurface } from "../../toolSurface.js";
import { unknownFieldsError } from "../../toolErrors.js";
import { hasNoDrafts } from "../../content/draftsOnly.js";

interface CreateContext {
  io: DocumentIO;
  schema: SchemaContext;
  recordEdits?: (refs: EditRecordRef[]) => void;
  surface?: ToolSurface;
}

export interface CreateInput {
  collection: string;
  data: Record<string, unknown>;
  locale?: string;
}

export async function createDocument(
  { io, schema, recordEdits, surface = CHAT_SURFACE }: CreateContext,
  { collection, data, locale }: CreateInput
) {
  const fields = schema.collections.find((candidate) => candidate.slug === collection)?.fields;

  if (!fields)
    return {
      error: `Unknown collection "${collection}". Available: ${schema.collections.map((candidate) => candidate.slug).join(", ")}`,
    };
  if (!data || typeof data !== "object" || Array.isArray(data))
    return {
      error: "`data` must be an object that maps field names of the collection to their values.",
    };

  for (const [key, value] of Object.entries(data)) {
    if (containsBlocksArray(value)) {
      return { error: surface.blocksCreateRefusal(key) };
    }
  }

  const unknown = unknownFieldsError(collection, fields, data);

  if (unknown) return { error: unknown };
  const forbidden = assessUpdateRisk(fields, {}, data).filter((risk) => risk.kind === "forbidden");

  if (forbidden.length) {
    return {
      error: `Refused: ${forbidden.map((risk) => risk.reason).join(" ")} Remove the field(s) from data.`,
    };
  }

  healEmptyRichTextDeep(data);
  const missing = missingRequired(fields, data);
  const createdEmpty = fillRequiredRichText(fields, data);
  const { doc, error } = await io.create(
    { collection },
    { data, locale, callId: CREATE_DOCUMENT_WRITE_ID }
  );

  if (error)
    return {
      error: createFailure(
        error,
        missing.filter((name) => !createdEmpty.includes(name)),
        `Call ${surface.create} again with a value for each of them in \`data\`.`
      ),
    };

  if (doc?.id == null) {
    return {
      ok: true,
      collection,
      note: `Created, but the id of the new document could not be read. Do not create it again: call listDocuments({ collection: "${collection}", sort: "-createdAt", limit: 5 }) and find it there.`,
    };
  }

  recordEdits?.([
    {
      collection,
      id: doc.id,
      op: "create",
      before: {},
      after: doc,
      locale,
      toolName: surface.create,
    },
  ]);

  return {
    ok: true,
    collection,
    id: doc.id,
    doc: stripContent(doc),
    ...(createdEmpty.length
      ? {
          createdEmpty,
          note: `Created with no text in ${createdEmpty.map((name) => `"${name}"`).join(", ")}: the field is required and \`data\` had no value for it. Write it with ${surface.edit} on this id.`,
        }
      : {}),
  };
}

/** The collections that take a new document: they have drafts, and the site can create in them. */
export const creatableCollections = (io: DocumentIO, schema: SchemaContext): string[] =>
  schema.collections
    .filter(
      ({ slug }) =>
        !hasNoDrafts(schema, { collection: slug }) &&
        io.transports({ collection: slug }).create !== null
    )
    .map(({ slug }) => slug);

export function createCreateDocumentTool(
  io: DocumentIO,
  schema: SchemaContext,
  recordEdits?: (refs: EditRecordRef[]) => void
) {
  const collections = creatableCollections(io, schema);

  return tool({
    description: `Create a new document, always as a draft, in one of these collections: ${collections.join(", ")}. Send the fields in \`data\` under the field names of the schema overview; the required ones are marked there. Never send a blocks field: create the document without it and compose its sections afterwards with editContent.`,
    inputSchema: z.object({
      collection: z.string().describe(`Collection slug. One of: ${collections.join(", ")}.`),
      data: z
        .record(z.string(), z.unknown())
        .describe(
          "The fields of the new document, by the field names of the schema. No blocks field."
        ),
      locale: z
        .string()
        .optional()
        .describe("Locale for localized fields. Omit for the default locale."),
    }),
    execute: (input: CreateInput) => createDocument({ io, schema, recordEdits }, input),
  });
}
