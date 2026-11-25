import { isRecord } from "../../../borders.js";
import type { TurnContext } from "../../../borders.js";
import type { ContentEditorDeps } from "../editorDeps.js";
import { resolveBulkWhere } from "../editorBulk.js";
import { writeStatusOf } from "../../writeStatus.js";
import { createAgentCallbacks } from "../../telemetry.js";
import type { EditorRunOptions, EditorRunResult } from "./state.js";

/** The telemetry and the token count of one editor run. */
export const editorCallbacks = ({ deps, parentToolCallId }: EditorRunOptions) =>
  createAgentCallbacks("content-editor", deps.conversationId, deps.telemetry, {
    model: deps.model,
    parentToolCallId,
    budget: deps.budget,
  });

export const BULK_LLM_JITTER_MS = 300;

const isMissingId = (id: unknown): boolean =>
  id === undefined || id === null || String(id).trim() === "";

/** The AI SDK reconciles data parts by id: without a stable `id` every event appends a new part. */
export function emitProgress(
  ctx: TurnContext | undefined,
  data: Record<string, unknown>,
  id?: string
) {
  try {
    ctx?.writer?.write?.({ type: "data-content-ops", ...(id ? { id } : {}), data });
  } catch {}
}

const MAX_SHOWN_FACTS = 20;

/** The last event of one document: its status and the facts, which the chat shows as a card. */
export const doneEvent = (
  target: { op: string; collection: string; id: string | number },
  result: EditorRunResult
): Record<string, unknown> => ({
  ...target,
  phase: "done",
  status: result.status,
  writeStatus: writeStatusOf(result),
  ...(result.changes?.length
    ? { changes: result.changes.slice(0, MAX_SHOWN_FACTS), changesTotal: result.changes.length }
    : {}),
  ...(result.changeClass ? { changeClass: result.changeClass } : {}),
  ...(result.issues?.length ? { issues: result.issues } : {}),
  ...(result.question ? { question: result.question } : {}),
  ...(result.error ? { error: result.error } : {}),
});

const MAX_SESSIONS_PER_DOC = 2;

export function sessionCap(
  ctx: TurnContext | undefined,
  key: string,
  toolName = "editContent"
): string | null {
  const runs = ctx?.contentEditorRuns;

  if (!runs) return null;
  runs[key] = (runs[key] ?? 0) + 1;
  if (runs[key] <= MAX_SESSIONS_PER_DOC) return null;

  return (
    `Refused: this is ${toolName} session #${runs[key]} on ${key} in one turn; the limit is ${MAX_SESSIONS_PER_DOC} (the task, plus one follow-up for leftovers). ` +
    "Do not try again in this turn. Report to the user what the draft contains, what its checks still list, and the draft id - the review panel is the next step."
  );
}

export const outputFields = (output: unknown): Record<string, unknown> =>
  isRecord(output) ? output : {};

export type Target = { collection?: string; global?: string; id?: string | number };

export const targetError = (
  { collection, global, id }: Target,
  ids?: (string | number)[],
  where?: string
): string | null => {
  if (!!collection === !!global)
    return "Provide exactly ONE of `collection` (+ `id`, `ids` or `where`) or `global`.";
  if (global && (ids?.length || where))
    return "A global is a singleton - pass `global` alone, without `ids`/`where`.";
  if (collection && isMissingId(id) && !ids?.length && !where)
    return "With `collection`, pass `id` (one document), `ids` (several) or `where` (a selection).";
  if ([!isMissingId(id), !!ids?.length, !!where].filter(Boolean).length > 1)
    return "Pass ONE of `id` (one document), `ids` (several) or `where` (a selection), not two of them: the call would run on only one.";

  return null;
};

const changedLines = (output: Record<string, unknown>) =>
  Array.isArray(output.changes) && output.changes.length
    ? `\nChanged in the document (report these to the user, they are the facts):\n${output.changes.map((change: unknown) => `- ${change}`).join("\n")}`
    : "";

export const singleResult = (operation: string, output: Record<string, unknown>) =>
  output.status === "error" || (output.error && !output.status)
    ? `${operation}${output.id !== undefined ? ` ${output.id}` : ""}: error - ${output.error}`
    : output.status === "needsInput"
      ? `${operation} ${output.id}: NOTHING was saved. The editor stopped with a question only the person can answer:\n"""\n${output.question}\n"""\nPut this question to the person in their language and end your turn; do not answer it yourself and do not call ${operation} again in this turn. When the person answers, call ${operation} with the task and their answer in \`instruction\`.`
      : output.status === "unchanged"
        ? `${operation} ${output.id}: NOTHING was changed and nothing was saved. ${Array.isArray(output.issues) && output.issues.length ? "The final checks took back what the editor changed; the reasons come first in the account" : "The editor went through the document and left it as it is"}. Its account:\n"""\n${(typeof output.summary === "string" ? output.summary : "").slice(0, 1000)}\n"""\nTell the person that the document was not changed and why. Do not call ${operation} again with the same task: the editor reads the same document and ends the same way. A second call is right only when the account names something it lacked and you can give it now.`
        : output.status === "rejected"
          ? `${operation} ${output.id}: rejected by review - ${output.reviewReason}`
          : Array.isArray(output.issues) && output.issues.length
            ? `${operation} ${output.id}: done, saved with ${output.issues.length} open issue(s) - tell the user each one verbatim:\n${output.issues.map((issue: unknown) => `- ${issue}`).join("\n")}${changedLines(output)}\nThe draft is saved and the person sees these issues next to the diff. Do NOT start another edit to fix them on your own: a second pass on a judgement call has undone correct work before. Report, and let the person decide.`
            : `${operation} ${output.id}: done. ${(typeof output.summary === "string" ? output.summary : "").slice(0, 200)}${changedLines(output)}`;
const UNCHANGED_ACCOUNTS_SHOWN = 5;

const unchangedLines = (output: Record<string, unknown>): string => {
  if (typeof output.unchanged !== "number" || output.unchanged <= 0) return "";
  const accounts = (Array.isArray(output.results) ? output.results : [])
    .filter(
      (result: unknown): result is Record<string, unknown> =>
        isRecord(result) &&
        result.status === "unchanged" &&
        typeof result.summary === "string" &&
        !!result.summary.trim()
    )
    .slice(0, UNCHANGED_ACCOUNTS_SHOWN)
    .map(
      (result) =>
        `- ${result.id}: ${String(result.summary).replace(/\s+/gu, " ").trim().slice(0, 300)}`
    );
  const head = `\n${output.unchanged} document(s) were left unchanged and nothing was saved in them. They are not errors; do not run them again.`;

  return accounts.length
    ? `${head} The editors' own accounts of why (${accounts.length} of ${output.unchanged}):\n${accounts.join("\n")}\nTell the person the reason these accounts give. Do not put a reason of your own in its place.`
    : `${head} The editors gave no account of why: tell the person that the reason is not known.`;
};

export const bulkResult = (operation: string, output: Record<string, unknown>) =>
  output.error
    ? `${operation}: ${output.error}`
    : `${operation}${output.to ? ` → ${output.to}` : ""}: ${output.done} done, ${output.rejected} rejected, ${output.errors} errors out of ${output.total} documents` +
      (typeof output.note === "string" && output.note ? `\n${output.note}` : "") +
      unchangedLines(output) +
      (typeof output.errors === "number" && output.errors > 0 && Array.isArray(output.results)
        ? (() => {
            const errs = output.results.filter(
              (result: unknown): result is Record<string, unknown> =>
                isRecord(result) && result.status === "error" && !!result.error
            );
            const first = errs[0]?.error ?? "";
            const same = errs.filter((result) => result.error === first).length;
            const ids = errs.map((result) => result.id).slice(0, 40);

            return first
              ? `\nfirst error (${same} of ${errs.length} identical): ${String(first).slice(0, 300)}\nfailed ids (not retried automatically - tell the user, re-run them with ids if asked): ${JSON.stringify(ids)}`
              : "";
          })()
        : "") +
      (output.stoppedForTime ? `\n${output.next}` : "");

export interface ManySelection {
  collection: string;
  givenIds: (string | number)[] | undefined;
  where: string | undefined;
  locale: string | undefined;
  signal?: AbortSignal;
}

export const resolveMany = async (
  deps: ContentEditorDeps,
  { collection, givenIds, where, locale, signal }: ManySelection
) => {
  let ids = givenIds ?? [];

  if (!ids.length) {
    if (!where) return { error: "Pass `where` (a filter selecting the documents) or `ids`." };
    const resolved = await resolveBulkWhere(deps, collection, where, { locale, signal });

    if ("error" in resolved) return { error: resolved.error };
    ids = resolved.ids;
  }

  return { ids };
};
