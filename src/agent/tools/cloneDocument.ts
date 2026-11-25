import { z } from "zod";
import { tool } from "ai";
import { isRecord } from "../../borders.js";
import type { PayloadDoc } from "../../borders.js";
import type { EditRecordRef, SchemaCollection, SchemaContext, SchemaField } from "../../types.js";
import { keyFields } from "../../schema/docLabel.js";
import type { DocumentIO } from "../content/documentIo.js";
import { isObjectLike } from "../content/discovery.js";
import { documentOutline } from "../content/outline.js";
import { healEmptyRichTextDeep } from "../content/schemaValues.js";
import { documentNotFoundError } from "../toolErrors.js";
import { containsBlocksArray } from "./blockWriteGuard.js";
import { assessUpdateRisk } from "./review.js";
import { CLONE_CREATE_WRITE_ID } from "./writeIds.js";
import { capMcpToolOutput, stringifyCapped } from "./outputCap.js";
import { unknownFieldsError } from "../toolErrors.js";

const MANAGED_KEYS = new Set(["id", "createdAt", "updatedAt", "_status"]);

const MAX_CLONE_DEPTH = 20;

// Rows lose their `id`: Payload assigns new ones, and a reused id can collide.
// richText is copied as is: the ids inside it are part of the node shape.
export function cloneFieldValue(value: unknown, field?: SchemaField, depth = 0): unknown {
  if (!isObjectLike(value) || depth > MAX_CLONE_DEPTH) return value;
  if (field?.type === "richText" || (isObjectLike(value.root) && value.root.children))
    return structuredClone(value);

  if (Array.isArray(value)) {
    return value.map((row: unknown) => {
      if (!isRecord(row)) return cloneFieldValue(row, undefined, depth + 1);
      const rowFields =
        field?.type === "blocks"
          ? field.blocks?.find((block) => block.slug === row.blockType)?.fields
          : field?.fields;

      return cloneObject(row, rowFields, depth + 1, true);
    });
  }

  return cloneObject(value, field?.fields, depth + 1, false);
}

function cloneObject(
  obj: Record<string, unknown>,
  fields: SchemaField[] | undefined,
  depth: number,
  dropRowId: boolean
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    if (dropRowId && key === "id") continue;
    out[key] = cloneFieldValue(
      val,
      fields?.find((field) => field.name === key),
      depth
    );
  }

  return out;
}

export function buildClonePayload(
  fields: SchemaField[],
  source: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(source ?? {})) {
    if (MANAGED_KEYS.has(key)) continue;
    const field = fields.find((candidate) => candidate.name === key);

    if (field?.readOnly) continue;
    payload[key] = cloneFieldValue(val, field, 0);
  }

  return payload;
}

type RecordEdits = (refs: EditRecordRef[]) => void;

interface CloneContext {
  io: DocumentIO;
  schema: SchemaContext;
  recordEdits?: RecordEdits;
}

interface CloneInput {
  collection: string;
  sourceId: string | number;
  data: Record<string, unknown>;
  locale?: string;
}

function cloneInputError(
  { slug, fields }: SchemaCollection,
  sourceId: string | number,
  data: Record<string, unknown>
): { error: string } | null {
  if (sourceId === undefined || sourceId === null || String(sourceId).trim() === "")
    return {
      error:
        "A `sourceId` is required - clone copies an existing document. Take the id from a listDocuments or findDocuments result.",
    };
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0)
    return {
      error:
        "Pass the new document's own identity in `data` (a new value for the title field and for every unique field) - a clone with no overrides would just duplicate the source verbatim.",
    };

  // Only the model-authored overrides are guarded:
  // the cloned blocks are copied from a document that already validated.
  for (const [key, val] of Object.entries(data)) {
    if (containsBlocksArray(val))
      return {
        error:
          `Refusing the "${key}" blocks field in \`data\` - the clone already carries the source's sections. ` +
          `Clone first, then adjust sections with editContent.`,
      };
  }

  const forbidden = assessUpdateRisk(fields, {}, data).filter((risk) => risk.kind === "forbidden");

  if (forbidden.length)
    return {
      error: `Refused: ${forbidden.map((risk) => risk.reason).join(" ")} Remove the field(s) from \`data\`.`,
    };
  const unknown = unknownFieldsError(slug, fields, data);

  return unknown ? { error: unknown } : null;
}

function sameKeyError(
  target: SchemaCollection,
  source: PayloadDoc,
  data: Record<string, unknown>
): { error: string } | null {
  const copied = keyFields(target).filter((name) => {
    const original = source[name];
    const override = data[name];

    return (
      typeof original === "string" &&
      original !== "" &&
      (typeof override !== "string" || override.trim() === "" || override === original)
    );
  });

  if (!copied.length) return null;

  return {
    error:
      `Pass a NEW value in \`data\` for ${copied.map((name) => `\`${name}\` (the source has "${String(source[name])}")`).join(", ")} - ` +
      `the collection allows each value of a unique field once. Derive it from the new topic.`,
  };
}

async function cloneFailure(
  io: DocumentIO,
  target: SchemaCollection,
  data: Record<string, unknown>,
  error: string
) {
  for (const field of keyFields(target)) {
    const value = data[field];

    if (typeof value !== "string" || value === "") continue;
    const existing = await io.list(target.slug, {
      where: { [field]: { equals: value } },
      limit: 1,
      callId: "clone-key-check",
    });
    const taken = existing?.docs?.[0];

    if (taken?.id == null) continue;

    return {
      error:
        `Clone failed: \`${field}\` "${value}" is already in use in "${target.slug}" by document ${taken.id}. ` +
        `Either edit that document instead of cloning a second one with the same value, or retry the clone ` +
        `with a different \`${field}\` derived from the new topic.`,
      taken: { field, value },
      existingId: taken.id,
    };
  }

  return { error: `Clone failed: ${error}` };
}

async function cloneDocument(
  { io, schema, recordEdits }: CloneContext,
  { collection, sourceId, data, locale }: CloneInput
) {
  const target = schema.collections.find((candidate) => candidate.slug === collection);

  if (!target)
    return {
      error: `Unknown collection "${collection}". Available: ${schema.collections.map((candidate) => candidate.slug).join(", ")}`,
    };
  const inputError = cloneInputError(target, sourceId, data);

  if (inputError) return inputError;

  const { doc: source, error: readError } = await io.read(
    { collection },
    { id: sourceId, locale, callId: "clone-read" }
  );

  if (readError) return { error: `Could not read the source document: ${readError}` };
  if (!source) return { error: documentNotFoundError(`Source document ${collection}/${sourceId}`) };

  const keyError = sameKeyError(target, source, data);

  if (keyError) return keyError;

  const payload = { ...buildClonePayload(target.fields, source), ...data };

  healEmptyRichTextDeep(payload);

  const { doc, error } = await io.create(
    { collection },
    { data: payload, locale, callId: CLONE_CREATE_WRITE_ID }
  );

  if (error) return cloneFailure(io, target, data, error);
  if (doc?.id == null)
    return {
      ok: true,
      collection,
      note: `Created, but the id of the new document could not be read. Do not clone again: call listDocuments({ collection: "${collection}", sort: "-createdAt", limit: 5 }) and find it there.`,
    };

  recordEdits?.([
    {
      collection,
      id: doc.id,
      op: "clone",
      before: {},
      after: doc,
      locale,
      toolName: "cloneDocument",
    },
  ]);

  const outline = documentOutline(target.fields, doc);

  return capMcpToolOutput({
    ok: true,
    collection,
    id: doc.id,
    clonedFrom: sourceId,
    ...(locale ? { locale } : {}),
    structure: outline,
    next:
      `The clone is a verbatim copy - same sections, same referenced documents and media. Now call ` +
      `editContent({ collection: "${collection}", id: "${doc.id}", instruction }) to rewrite its copy for the new topic. ` +
      `Tell the editor to REWRITE TEXT IN PLACE and keep every section: it must not remove or re-create blocks unless the user asked for a structural change.`,
  });
}

export function createCloneDocumentTool(
  io: DocumentIO,
  schema: SchemaContext,
  recordEdits?: RecordEdits
) {
  return tool({
    description:
      "Clone an EXISTING document into a NEW draft, copying its content verbatim - the whole layout/blocks structure, every nested array row, and every relationship and upload id. " +
      "Use this whenever the user wants a new document modelled on an existing one: the same structure, other content. " +
      "Pass the new identity in `data` - a new value for every unique field of the collection is REQUIRED. " +
      "AFTER cloning, call editContent on the returned id to rewrite the copy for its new topic: the sections, media and references are already in place, so that is a text rewrite, not a rebuild. " +
      "Do NOT use this to compose a brand-new structure from scratch - for that, create the shell with createDocument and use editContent.",
    inputSchema: z.object({
      collection: z
        .string()
        .describe("Collection slug. The clone is created in the SAME collection as the source."),
      sourceId: z
        .union([z.string(), z.number()])
        .describe("Id of the document to copy the structure from."),
      data: z
        .record(z.string(), z.unknown())
        .describe(
          "Overrides for the new document - its own identity. At minimum a new value for the title field and for every unique field. Never an array of blocks."
        ),
      locale: z
        .string()
        .optional()
        .describe(
          "Locale to read the source in AND write the clone to. Localized fields of OTHER locales are not copied - clone the default locale, then translateContent."
        ),
    }),
    execute: (input: CloneInput) => cloneDocument({ io, schema, recordEdits }, input),
    toModelOutput: ({ output }) => ({
      type: "text" as const,
      value: typeof output === "string" ? output : stringifyCapped(output),
    }),
  });
}
