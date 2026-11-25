import { randomUUID } from "node:crypto";
import { withDocumentLock, documentLockKey } from "./documentLock.js";
import { z } from "zod";
import { tool } from "ai";
import { turnContextSchema } from "../../borders.js";
import type { PayloadDoc, TurnContext } from "../../borders.js";
import type { EditRecordRef, SchemaContext, SchemaField } from "../../types.js";
import type { DocumentIO } from "./documentIo.js";
import {
  TEXT_TYPES,
  collectContentFields,
  getByPath,
  setByPath,
  parsePath,
  validateLocaleArg,
} from "./discovery.js";
import { replaceTextInLexical } from "../subAgents/programmaticOps.js";
import { buildChangedFields } from "./schemaValues.js";
import { askPerson, personApproved } from "../approvals.js";
import type { ApprovalPolicy, TurnApprovals } from "../approvals.js";
import { approvalReason } from "../../approvalRequest.js";
import { shownDocuments } from "./approvalDocuments.js";
import { runBulk, needsPerson, unapprovedBulkRefusal } from "./bulk.js";
import { bulkCount, confirmDocuments } from "./manyDocuments.js";
import type { BulkDocResult } from "./bulk.js";
import { hasNoDrafts, noDraftsRefusal } from "./draftsOnly.js";
import { CHAT_SURFACE } from "../toolSurface.js";
import { unknownTargetError } from "../toolErrors.js";
import { FIND_REPLACE_SAVE_ID } from "../tools/writeIds.js";

export const findReplaceInputSchema = z.object({
  collection: z.string().describe("Collection slug"),
  find: z.string().min(1).describe("Exact string to find (case-sensitive)"),
  replace: z
    .string()
    .describe("Replacement string. An empty string deletes every occurrence of `find`."),
  ids: z
    .array(z.union([z.string(), z.number()]))
    .min(1)
    .describe("Document ids to process (get them from searchContent - use its matchedIds)"),
  locale: z
    .string()
    .optional()
    .describe(
      "Locale code to replace within a specific language's localized fields. In a locale other than the default one, a match in a field shared by every locale is left as it is and counted in `sharedSkipped`, because a change there changes every locale. Omit for the default locale, where shared fields change too."
    ),
});

export type FindReplaceInput = z.infer<typeof findReplaceInputSchema>;

interface FindReplaceDeps {
  io: DocumentIO;
  schema: SchemaContext;
  concurrency: number;
  recordEdits?: (refs: EditRecordRef[]) => void;
  approvals?: TurnApprovals;
  /** Refuses a run on too many documents. Without it: the chat asks the person. */
  bulkRefusal?: (count: number) => { error: string } | null;
  /** Refuses the change of one document before it is written. */
  documentRefusal?: (before: PayloadDoc, after: PayloadDoc) => string | null;
}

interface DocReplaceJob {
  collection: string;
  find: string;
  replace: string;
  locale?: string;
  fields: SchemaField[];
  /** A write to a locale other than the default leaves the fields shared by every locale. */
  keepShared: boolean;
}

function replaceInFields(doc: PayloadDoc, job: DocReplaceJob) {
  const { find, replace } = job;
  let docCount = 0;
  let sharedSkipped = 0;

  for (const leaf of collectContentFields(job.fields, doc)) {
    const path = parsePath(leaf.ref);
    const keep = job.keepShared && !leaf.localized;

    if (leaf.richText) {
      const value = getByPath(doc, path);
      const { content, count } = replaceTextInLexical(value, find, replace);

      if (count > 0 && keep) sharedSkipped += count;
      else if (count > 0) {
        setByPath(doc, path, content);
        docCount += count;
      }
    } else if (
      TEXT_TYPES.has(leaf.type) &&
      typeof leaf.value === "string" &&
      leaf.value.includes(find)
    ) {
      const count = leaf.value.split(find).length - 1;

      if (keep) sharedSkipped += count;
      else {
        setByPath(doc, path, leaf.value.split(find).join(replace));
        docCount += count;
      }
    }
  }

  return { docCount, sharedSkipped };
}

async function replaceInDocument(
  deps: FindReplaceDeps,
  job: DocReplaceJob,
  id: string | number
): Promise<BulkDocResult> {
  const { io } = deps;
  const { collection, locale } = job;
  // No locale fallback: a match inside fallback text would be written back as an
  // override for this locale.
  const { doc, error: readErr } = await io.read(
    { collection },
    { id, locale, fallbackLocale: locale ? false : undefined, callId: "fr-find" }
  );

  if (readErr) return { id, status: "error", error: readErr, replacements: 0 };
  if (!doc?.id) return { id, status: "error", error: "not found", replacements: 0 };
  const original = structuredClone(doc);
  const { docCount, sharedSkipped } = replaceInFields(doc, job);
  const shared = sharedSkipped ? { sharedSkipped } : {};

  if (docCount === 0) return { id, status: "skipped", replacements: 0, ...shared };
  const refused = deps.documentRefusal?.(original, doc);

  if (refused) return { id, status: "error", error: refused, replacements: 0 };
  const { patch } = buildChangedFields(original, doc);
  const { error: writeErr } = await io.write(
    { collection },
    { id: doc.id, patch, locale, callId: FIND_REPLACE_SAVE_ID }
  );

  if (writeErr) return { id, status: "error", error: writeErr, replacements: 0 };
  deps.recordEdits?.([
    {
      collection,
      id,
      op: "findReplace",
      before: original,
      after: structuredClone(doc),
      locale,
    },
  ]);

  return { id, status: "done", replacements: docCount, ...shared };
}

// A search can find a string that this literal replace does not match. The note says why, so a
// document with no match does not read as a document with nothing to change.
function noMatchNote(ids: (string | number)[], locale: string | undefined): string {
  return (
    `${ids.length} document(s) had no match and were not changed (ids: ${ids.join(", ")}). ` +
    "The replace is literal: it matches the exact case, in text and rich text fields, and inside one run of formatting, " +
    "so a string that goes across the edge of a bold run or of a link has no match" +
    (locale
      ? `; it reads the text stored for "${locale}", not the text that this locale shows from its fallback locale. `
      : ". ") +
    "A search matches more loosely than this. If one of these documents must change, edit that document itself."
  );
}

function sharedReport(results: BulkDocResult[], locale: string | undefined) {
  const sharedSkipped = results.reduce(
    (total, result) =>
      total + (typeof result.sharedSkipped === "number" ? result.sharedSkipped : 0),
    0
  );

  return sharedSkipped
    ? {
        sharedSkipped,
        sharedNote: `${sharedSkipped} match(es) are in fields shared by every locale and were left as they are: a change there changes every locale, not only "${locale}". Tell the person. To change them for every locale, call again without \`locale\`.`,
      }
    : {};
}

/** A document with no match and a document that the run never reached are told apart. */
function skippedReport(results: BulkDocResult[], locale: string | undefined) {
  const skipped = results.filter((result) => result.status === "skipped");
  const noMatchIds = skipped
    .filter((result) => !result.error && !result.sharedSkipped)
    .map((result) => result.id);
  const notStarted = skipped.filter((result) => result.error);
  const notStartedIds = notStarted.map((result) => result.id);

  return {
    skipped: skipped.length,
    ...(noMatchIds.length ? { noMatchIds, noMatchNote: noMatchNote(noMatchIds, locale) } : {}),
    ...(notStarted.length
      ? {
          notStartedIds,
          notStartedNote: `${notStarted.length} document(s) were not read at all (${notStarted[0].error}; ids: ${notStartedIds.join(", ")}). Call again with these ids.`,
        }
      : {}),
  };
}

export async function findReplaceContent(
  deps: FindReplaceDeps,
  { collection, find, replace, ids, locale }: FindReplaceInput,
  options?: { context?: TurnContext; abortSignal?: AbortSignal; toolCallId?: string }
) {
  const { io, schema } = deps;
  const turnContext = options?.context;
  const abortSignal = options?.abortSignal;
  const localeErr = validateLocaleArg(schema, locale);

  if (localeErr) return { error: localeErr };
  const draftsRefusal = noDraftsRefusal(schema, { collection }, CHAT_SURFACE, {
    approvals: deps.approvals,
    toolCallId: options?.toolCallId,
    ids,
  });

  if (draftsRefusal) return { error: draftsRefusal };
  const collSchema = schema.collections.find((candidate) => candidate.slug === collection);

  if (!collSchema) return { error: unknownTargetError(schema, { collection }) };
  const approved = personApproved(deps.approvals, options?.toolCallId);
  const refusal = deps.bulkRefusal
    ? deps.bulkRefusal(ids.length)
    : unapprovedBulkRefusal(
        bulkCount(deps.approvals, collection, ids),
        approved,
        "findReplaceContent"
      );

  if (refusal) return refusal;
  if (approved) confirmDocuments(deps.approvals, { collection }, ids);
  const { read, write } = io.transports({ collection });

  if (!read || !write) return { error: `No read/write access for "${collection}"` };
  const job: DocReplaceJob = {
    collection,
    find,
    replace,
    locale,
    fields: collSchema?.fields ?? [],
    keepShared: locale !== undefined && locale !== schema.defaultLocale,
  };

  const replaceInDoc = (id: string | number): Promise<BulkDocResult> =>
    withDocumentLock(documentLockKey({ collection }, id), (): Promise<BulkDocResult> =>
      replaceInDocument(deps, job, id)
    );

  const opId = randomUUID();
  const { results, done } = await runBulk(ids, replaceInDoc, {
    op: "findReplace",
    collection,
    concurrency: deps.concurrency,
    emit: (data) => {
      try {
        turnContext?.writer?.write?.({ type: "data-content-ops", id: opId, data });
      } catch {}
    },
    meta: { find, replace },
    signal: abortSignal,
  });

  const totalReplacements = results.reduce(
    (total, result) => total + (typeof result.replacements === "number" ? result.replacements : 0),
    0
  );
  const errored = results.filter((result) => result.status === "error");
  const persistedAs = collSchema?.hasDrafts
    ? "saved as drafts"
    : "published immediately - this collection has no drafts";

  return {
    collection,
    find,
    replace,
    changedDocs: done,
    totalReplacements,
    errors: errored.length,
    ...skippedReport(results, locale),
    ...sharedReport(results, locale),
    failedIds: errored.map((result) => result.id),
    ...(errored[0]?.error ? { firstError: errored[0].error } : {}),
    results,
    persistedAs,
  };
}

const findReplaceApproval =
  ({
    io,
    schema,
    approvals,
  }: Pick<FindReplaceDeps, "io" | "schema" | "approvals">): ApprovalPolicy =>
  async (input) => {
    const { collection, find, replace, ids, locale } = findReplaceInputSchema.parse(input);
    const count = bulkCount(approvals, collection, ids);

    if (!needsPerson(count) && !hasNoDrafts(schema, { collection })) return undefined;

    return askPerson(
      approvalReason({
        kind: "replace",
        collection,
        count: ids.length,
        documents: await shownDocuments({ io, schema, collection, ids, locale }),
        find,
        replace,
      })
    );
  };

export function createFindReplaceTool(
  io: DocumentIO,
  schema: SchemaContext,
  { concurrency = 5, recordEdits, approvals }: Partial<Omit<FindReplaceDeps, "io" | "schema">> = {}
) {
  const deps: FindReplaceDeps = { io, schema, concurrency, recordEdits, approvals };

  approvals?.policies.set("findReplaceContent", findReplaceApproval(deps));

  return {
    findReplaceContent: tool({
      description:
        'Literally replace one string with another across documents - DETERMINISTIC, fast, and LOSSLESS (no LLM, never drops content). Use this for mechanical replacements like changing "2025" to "2026" everywhere, OR normalizing a link URL (<old address> to <new address>). It replaces the exact string in plain-text, rich-text prose, AND rich-text link URLs (link/autolink node targets) - exactly what searchContent surfaces - preserving all structure. Get the document ids first with searchContent. Prefer this over editContent for literal find/replace. Note: it is literal and case-sensitive, so it WILL also hit any other occurrence of the string - scope with the right ids. When only some of the occurrences should change and that takes judgement, use editContent with a precise instruction.',
      contextSchema: turnContextSchema,
      inputSchema: findReplaceInputSchema,
      execute: (input, options) => findReplaceContent(deps, input, options),
      toModelOutput: ({ output }) =>
        "error" in output
          ? { type: "text" as const, value: `findReplaceContent: ${output.error}` }
          : {
              type: "text" as const,
              value:
                `findReplaceContent: replaced "${output.find}"→"${output.replace}" ${output.totalReplacements} times across ${output.changedDocs} document(s) (${output.persistedAs})` +
                (output.noMatchNote ? `; ${output.noMatchNote}` : "") +
                (output.notStartedNote ? ` ${output.notStartedNote}` : "") +
                (output.sharedNote ? ` ${output.sharedNote}` : "") +
                (output.errors
                  ? `; ${output.errors} FAILED (ids: ${(output.failedIds ?? []).join(", ")}${output.firstError ? `; the first error: ${output.firstError}` : ""}) - these were NOT changed, tell the user`
                  : ""),
            },
    }),
  };
}
