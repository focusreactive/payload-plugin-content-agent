import { randomUUID } from "node:crypto";
import type { TurnContext } from "../../../borders.js";
import type { PendingBulk } from "../../../memory/storage/pendingBulk.js";
import { approvalReason } from "../../../approvalRequest.js";
import type { ApprovalDocument, ApprovalRequest } from "../../../approvalRequest.js";
import { askPerson, personApproved } from "../../approvals.js";
import type { ApprovalPolicy } from "../../approvals.js";
import { CHAT_SURFACE } from "../../toolSurface.js";
import { shownDocuments } from "../approvalDocuments.js";
import { runBulk, needsPerson, unapprovedBulkRefusal } from "../bulk.js";
import { hasNoDrafts, noDraftsRefusal } from "../draftsOnly.js";
import { bulkCount, confirmDocuments, manyDocumentsRefusal } from "../manyDocuments.js";
import type { ContentEditorDeps } from "../editorDeps.js";
import {
  DEFAULT_DOC_TIMEOUT_MS,
  askedScope,
  bulkDeadline,
  continuation,
  emptySelectionNote,
  getPending,
  keepAskedScope,
  setPending,
} from "../editorBulk.js";
import type { EditorRunOptions } from "./state.js";
import { runWithTimeout } from "./timedRun.js";
import { BULK_LLM_JITTER_MS, emitProgress, resolveMany } from "./shared.js";
import type { Target } from "./shared.js";

// The plan, the write gate, the run of many documents and the approval of editContent and
// translateContent. One copy: a change to a gate reaches both tools.

export type EditorTool = "editContent" | "translateContent";

export interface ToolCallOptions {
  context?: TurnContext;
  abortSignal?: AbortSignal;
  toolCallId?: string;
}

type Ids = (string | number)[];

/** The documents a request names: one document has neither. */
export interface Selection {
  givenIds: Ids | undefined;
  where: string | undefined;
}

export interface ManyPlan<R> {
  kind: "many";
  collection: string;
  request: R;
  ids: Ids;
}

/** What the call covers. The approval check and the run read the same plan. */
export type Plan<R> =
  | { kind: "refused"; result: Record<string, unknown> }
  | { kind: "one"; request: R }
  | ManyPlan<R>;

export const refusedResult = ({ id, global }: Target, error: string) => ({
  id: id ?? global ?? "?",
  status: "error" as const,
  error,
});

/** The run that `continue` resumes. */
export async function storedRun(
  deps: ContentEditorDeps,
  tool: EditorTool,
  collection: string | undefined,
  missing: string
): Promise<{ error: string } | { pending: PendingBulk }> {
  if (!collection) return { error: "Pass `collection` with `continue: true`." };
  const pending = await getPending(deps, tool, collection);

  return pending ? { pending } : { error: missing };
}

export interface Scope<R> {
  tool: EditorTool;
  target: Target;
  request: R;
  /** The locale the selection is read in. */
  locale: string | undefined;
  toolCallId: string | undefined;
  signal?: AbortSignal;
}

export async function planScope<R extends Selection>(
  deps: ContentEditorDeps,
  { tool, target: { collection, global }, request, locale, toolCallId, signal }: Scope<R>
): Promise<Plan<R>> {
  const { givenIds, where } = request;

  if (global || !collection || (!givenIds?.length && !where)) return { kind: "one", request };
  const resolved = await askedScope(deps, tool, toolCallId, () =>
    resolveMany(deps, { collection, givenIds, where, locale, signal })
  );

  if ("error" in resolved) return { kind: "refused", result: { error: resolved.error } };

  return { kind: "many", collection, request, ids: resolved.ids };
}

/** Every write passes the drafts gate; one document also passes the document limit. */
export async function runPlan<R, One, Many>(
  deps: ContentEditorDeps,
  { target, plan, toolCallId }: { target: Target; plan: Plan<R>; toolCallId: string | undefined },
  run: { one: (request: R) => Promise<One>; many: (plan: ManyPlan<R>) => Promise<Many> }
) {
  if (plan.kind === "refused") return plan.result;
  const { collection, global, id } = target;
  const gate = {
    approvals: deps.approvals,
    toolCallId,
    ids: plan.kind === "many" ? plan.ids : id === undefined ? [] : [id],
  };
  const refusal =
    noDraftsRefusal(deps.schema, { collection, global }, CHAT_SURFACE, gate) ??
    (plan.kind === "one" ? manyDocumentsRefusal({ collection, global }, gate) : null);

  if (refusal) return refusedResult(target, refusal);

  return plan.kind === "one" ? run.one(plan.request) : run.many(plan);
}

export interface ManyRun {
  tool: EditorTool;
  op: string;
  /** What the editor of each document gets besides the document. */
  editor: Pick<EditorRunOptions, "instruction" | "modelDocument" | "locale" | "writeLocale">;
  /** What `continue` needs to resume the run. */
  stored: Omit<PendingBulk, "ids" | "at">;
  /** Shown with the progress and the result. */
  shown?: Record<string, unknown>;
}

export async function runMany<R extends Selection>(
  deps: ContentEditorDeps,
  { collection, request, ids }: ManyPlan<R>,
  { tool, op, editor, stored, shown }: ManyRun,
  { context, abortSignal, toolCallId }: ToolCallOptions
) {
  if (!ids.length)
    return {
      collection,
      ...shown,
      total: 0,
      done: 0,
      rejected: 0,
      errors: 0,
      results: [],
      note: await emptySelectionNote(deps, collection, request.where),
    };
  const approved = personApproved(deps.approvals, toolCallId);
  const refusal = unapprovedBulkRefusal(bulkCount(deps.approvals, collection, ids), approved, tool);

  if (refusal) return refusal;
  if (approved) confirmDocuments(deps.approvals, { collection }, ids);
  if (approved && toolCallId) await keepAskedScope(deps, tool, toolCallId, null);
  const opId = randomUUID();
  const { results, done, unchanged, rejected, errors, remaining } = await runBulk(
    ids,
    (docId) =>
      runWithTimeout({
        ...editor,
        deps,
        target: { collection },
        id: docId,
        timeoutMs: DEFAULT_DOC_TIMEOUT_MS,
        signal: abortSignal,
        parentToolCallId: toolCallId,
      }),
    {
      op,
      collection,
      concurrency: deps.concurrency,
      emit: (data) => emitProgress(context, data, opId),
      jitterMs: BULK_LLM_JITTER_MS,
      ...(shown ? { meta: shown } : {}),
      signal: abortSignal,
      deadline: bulkDeadline(deps, context),
      budget: deps.budget,
    }
  );
  const total = results.length + remaining.length;

  await setPending(
    deps,
    tool,
    collection,
    remaining.length ? { ...stored, ids: remaining, at: Date.now() } : null
  );

  return {
    collection,
    ...shown,
    total,
    done,
    ...(unchanged ? { unchanged } : {}),
    rejected,
    errors,
    concurrency: deps.concurrency,
    results,
    ...continuation(tool, { remaining, done, total, resumable: !!deps.conversationId }),
  };
}

export interface ManyApproval<R> {
  tool: EditorTool;
  plan: (input: unknown, toolCallId: string, signal?: AbortSignal) => Promise<Plan<R>>;
  /** The locale the documents are shown in. */
  locale: (request: R) => string | undefined;
  request: (plan: ManyPlan<R>, documents: ApprovalDocument[]) => ApprovalRequest;
}

/** The person confirms a run above the limit, and any run on a collection without drafts. */
export function manyApproval<R>(
  deps: ContentEditorDeps,
  { tool, plan, locale, request }: ManyApproval<R>
): ApprovalPolicy {
  return async (input, toolCallId, signal) => {
    const planned = await plan(input, toolCallId, signal);

    if (planned.kind !== "many") return undefined;
    const { collection, ids } = planned;
    const live = hasNoDrafts(deps.schema, { collection });

    if (!needsPerson(bulkCount(deps.approvals, collection, ids)) && !live) return undefined;
    await keepAskedScope(deps, tool, toolCallId, ids);
    const documents = await shownDocuments({
      io: deps.io,
      schema: deps.schema,
      collection,
      ids,
      locale: locale(planned.request),
    });

    return askPerson(approvalReason(request(planned, documents)));
  };
}
