import { PENDING_BULK_TTL_MS } from "../../memory/storage/pendingBulk.js";
import type { PendingBulk } from "../../memory/storage/pendingBulk.js";
import type { TurnContext, Where } from "../../borders.js";
import { asksForPublished, readWhere, WHERE_FORMAT } from "./whereClause.js";
import type { ContentEditorDeps } from "./editorDeps.js";

export const DEFAULT_DOC_TIMEOUT_MS = 120_000;

export function bulkDeadline(
  deps: ContentEditorDeps,
  ctx: TurnContext | undefined
): number | undefined {
  const budget = deps.bulkTimeBudgetMs ?? 0;

  if (!budget) return undefined;
  const startedAt = typeof ctx?.requestStartedAt === "number" ? ctx.requestStartedAt : Date.now();

  return startedAt + budget;
}

const BULK_WHERE_CAP = 1000;

export async function emptySelectionNote(
  deps: ContentEditorDeps,
  collection: string,
  where: string | undefined
): Promise<string> {
  const all = await deps.io
    .list(collection, { page: 1, limit: 1, callId: "bulk-count", select: { id: true } })
    .catch(() => null);
  const total =
    all && !all.error ? ` The collection "${collection}" has ${all.totalDocs} document(s).` : "";

  return (
    `The selection matches no documents.${where ? ` Filter: ${where}.` : ""}${total} ` +
    `${WHERE_FORMAT} "%", "*", "^" and "$" are matched as plain characters. ` +
    'For "ends with" or "starts with", use contains with the fixed part. To select every document of the collection, pass where "{}". ' +
    "When you already know the documents, pass their ids in `ids` (find them with findDocuments or searchContent)."
  );
}

export async function resolveBulkWhere(
  deps: ContentEditorDeps,
  collection: string,
  where: string,
  { locale, signal }: { locale?: string; signal?: AbortSignal } = {}
): Promise<{ ids: (string | number)[]; total: number } | { error: string }> {
  const read = readWhere(
    where,
    deps.schema.collections.find((entry) => entry.slug === collection)
  );

  if ("error" in read) return read;
  const whereObj: Where = read.where;

  const wantsPublished = asksForPublished(whereObj);
  const ids: (string | number)[] = [];
  let total = 0;

  for (let page = 1; ; page++) {
    if (signal?.aborted)
      return { error: "The request was stopped before the documents were selected." };
    const { docs, totalDocs, totalPages, error } = await deps.io.list(collection, {
      page,
      limit: 100,
      where: whereObj,
      locale,
      callId: "bulk-where",
      select: { id: true },
      ...(wantsPublished ? { draft: false } : {}),
    });

    if (error) return { error: `Could not list ${collection}: ${error}` };
    total = totalDocs;
    for (const doc of docs) if (doc?.id != null) ids.push(doc.id);
    if (page >= totalPages || !docs.length) break;
    if (ids.length >= BULK_WHERE_CAP)
      return {
        error: `The filter matches ${totalDocs} documents - more than ${BULK_WHERE_CAP}. Narrow the where clause and run it in parts.`,
      };
  }

  return { ids, total };
}

/**
 * Nothing is kept without a conversation id: a shared key lets one user resume another user's bulk.
 */
export interface PendingBulkStore {
  get: (conversationId: string, tool: string, collection: string) => Promise<PendingBulk | null>;
  set: (
    conversationId: string,
    tool: string,
    collection: string,
    value: PendingBulk | null
  ) => Promise<void>;
}
const pendingBulk = new Map<string, PendingBulk>();
const pendingKey = (conversationId: string, tool: string, collection: string) =>
  `${conversationId}|${tool}|${collection}`;

export async function getPending(
  deps: ContentEditorDeps,
  tool: string,
  collection: string
): Promise<PendingBulk | null> {
  if (!deps.conversationId) return null;

  if (deps.pendingStore) {
    try {
      return await deps.pendingStore.get(deps.conversationId, tool, collection);
    } catch (err) {
      console.warn(
        "[content-agent] pending bulk read failed, using the in-process copy:",
        (err as Error)?.message
      );
    }
  }

  const pending = pendingBulk.get(pendingKey(deps.conversationId, tool, collection));

  return pending && Date.now() - pending.at <= PENDING_BULK_TTL_MS ? pending : null;
}

export async function setPending(
  deps: ContentEditorDeps,
  tool: string,
  collection: string,
  value: PendingBulk | null
): Promise<void> {
  if (!deps.conversationId) return;
  for (const [storedKey, pending] of pendingBulk)
    if (Date.now() - pending.at > PENDING_BULK_TTL_MS) pendingBulk.delete(storedKey);
  const key = pendingKey(deps.conversationId, tool, collection);

  if (value) pendingBulk.set(key, value);
  else pendingBulk.delete(key);

  if (deps.pendingStore) {
    await deps.pendingStore.set(deps.conversationId, tool, collection, value).catch((err) => {
      console.warn(
        "[content-agent] pending bulk write failed, kept in process only:",
        (err as Error)?.message
      );
    });
  }
}

type Ids = (string | number)[];

const scopeTool = (tool: string) => `${tool}:asked`;

/**
 * The documents of one tool call. The first read fixes them: the person confirms that set,
 * and the run after the click covers exactly it, also on another server instance.
 */
export async function askedScope(
  deps: ContentEditorDeps,
  tool: string,
  toolCallId: string | undefined,
  resolve: () => Promise<{ ids: Ids } | { error: string }>
): Promise<{ ids: Ids } | { error: string }> {
  if (!toolCallId) return resolve();
  const kept =
    deps.approvals?.scopes.get(toolCallId) ??
    (await getPending(deps, scopeTool(tool), toolCallId))?.ids;

  if (kept) return { ids: kept };
  const resolved = await resolve();

  if (!("error" in resolved)) deps.approvals?.scopes.set(toolCallId, resolved.ids);

  return resolved;
}

export const keepAskedScope = (
  deps: ContentEditorDeps,
  tool: string,
  toolCallId: string,
  ids: Ids | null
): Promise<void> =>
  setPending(
    deps,
    scopeTool(tool),
    toolCallId,
    ids ? { ids, instruction: "", at: Date.now() } : null
  );

export interface ContinuationProgress {
  remaining: (string | number)[];
  done: number;
  total: number;
  resumable?: boolean;
}

export function continuation(
  tool: string,
  progress: ContinuationProgress
): Record<string, unknown> {
  const { remaining, done, total, resumable = true } = progress;

  if (!remaining.length) return {};

  if (!resumable) {
    return {
      remainingCount: remaining.length,
      stoppedForTime: true,
      remaining,
      next:
        `This request's time budget is spent: ${done} of ${total} documents are done, ${remaining.length} were NOT started. ` +
        `Do NOT call ${tool} again in this turn. Tell the user these numbers (${done} of ${total} done, ${remaining.length} remaining) and ask whether to go on; ` +
        `when they agree, call ${tool} with the same instruction and \`ids\` set to the \`remaining\` list above, copied exactly.`,
    };
  }

  return {
    remainingCount: remaining.length,
    stoppedForTime: true,
    next:
      `This request's time budget is spent: ${done} of ${total} documents are done, ${remaining.length} were NOT started. ` +
      `Do NOT call ${tool} again in this turn - the platform would cut the request off. Tell the user these numbers (${done} of ${total} done, ` +
      `${remaining.length} remaining) and ask whether to go on; when they agree, call ${tool}({ collection, continue: true }) - ` +
      `the remaining documents and the instruction are kept for you, do NOT pass ids or retype them.`,
  };
}
