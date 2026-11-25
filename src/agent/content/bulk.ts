import type { TurnBudget } from "../turnBudget.js";
import type { WriteStatus } from "../writeStatus.js";
import { runPool } from "./pool.js";

export const BULK_CONFIRM_THRESHOLD = 5;

export const needsPerson = (count: number): boolean => count > BULK_CONFIRM_THRESHOLD;

/** `approved` comes from the person's click in the chat, never from the tool input. */
export function unapprovedBulkRefusal(
  count: number,
  approved: boolean,
  tool: string
): { error: string; writeStatus: WriteStatus } | null {
  if (approved || !needsPerson(count)) return null;

  return {
    writeStatus: "needs-confirmation",
    error: `Nothing was written: with this run the request changes ${count} documents, and a request changes more than ${BULK_CONFIRM_THRESHOLD} documents only after the person confirms it in the chat. This call has no confirmation. Call ${tool} again with the same input: the chat then asks the person.`,
  };
}

export interface BulkDocResult {
  id: string | number;
  status: "done" | "unchanged" | "rejected" | "error" | "skipped";
  [key: string]: unknown;
}

export interface RunBulkOptions {
  op: string;
  collection: string;
  concurrency: number;
  emit?: (data: Record<string, unknown>) => void;
  meta?: Record<string, unknown>;
  jitterMs?: number;
  signal?: AbortSignal;
  deadline?: number;
  budget?: TurnBudget;
}

export interface RunBulkSummary {
  results: BulkDocResult[];
  remaining: (string | number)[];
  done: number;
  unchanged: number;
  rejected: number;
  errors: number;
  skipped: number;
}

interface BulkRun {
  opts: RunBulkOptions;
  total: number;
  active: (string | number)[];
  uiResults: { id: string | number; status: string }[];
  remaining: (string | number)[];
  completed: number;
  done: number;
  unchanged: number;
  rejected: number;
  errors: number;
  skipped: number;
}

// Keyed by String(id): 1 and "1" are one document, and two workers on one document
// overwrite each other.
function dedupeIds(ids: (string | number)[]): (string | number)[] {
  const seenIds = new Set<string>();
  const dedupedIds: (string | number)[] = [];

  for (const id of ids) {
    const key = String(id);

    if (seenIds.has(key)) continue;
    seenIds.add(key);
    dedupedIds.push(id);
  }

  return dedupedIds;
}

function emitBulk(run: BulkRun, extra: Record<string, unknown>): void {
  run.opts.emit?.({
    op: run.opts.op,
    collection: run.opts.collection,
    total: run.total,
    ...(run.opts.meta ?? {}),
    ...extra,
  });
}

function emitBulkProgress(run: BulkRun): void {
  emitBulk(run, {
    phase: "processing",
    completed: run.completed,
    active: [...run.active],
    currentId: run.active[0],
    done: run.done,
    unchanged: run.unchanged,
    rejected: run.rejected,
    errors: run.errors,
    results: run.uiResults.slice(-60),
  });
}

function countResult(run: BulkRun, result: BulkDocResult): void {
  if (result.status === "done") run.done++;
  else if (result.status === "unchanged") run.unchanged++;
  else if (result.status === "rejected") run.rejected++;
  else if (result.status === "skipped") run.skipped++;
  else run.errors++;
}

async function runBulkDoc(
  run: BulkRun,
  worker: (id: string | number) => Promise<BulkDocResult>,
  id: string | number
): Promise<BulkDocResult> {
  const { opts } = run;

  if (opts.signal?.aborted) {
    const aborted: BulkDocResult = { id, status: "error", error: "aborted by user" };

    run.errors++;
    run.completed++;
    run.uiResults.push({ id, status: aborted.status });

    return aborted;
  }

  if (opts.deadline && Date.now() >= opts.deadline) {
    run.remaining.push(id);

    return { id, status: "skipped", error: "not started: request time budget reached" };
  }

  if (opts.budget?.exceeded()) {
    run.remaining.push(id);

    return { id, status: "skipped", error: "not started: request token budget reached" };
  }

  const jitterMs = opts.jitterMs ?? 0;

  if (jitterMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.random() * jitterMs));
  run.active.push(id);
  emitBulkProgress(run);
  let result: BulkDocResult;

  try {
    result = await worker(id);
  } catch (err) {
    result = { id, status: "error", error: err instanceof Error ? err.message : String(err) };
  }

  const activeIndex = run.active.indexOf(id);

  if (activeIndex !== -1) run.active.splice(activeIndex, 1);
  countResult(run, result);
  run.completed++;
  run.uiResults.push({ id: result.id, status: result.status });
  emitBulkProgress(run);

  return result;
}

export async function runBulk(
  ids: (string | number)[],
  worker: (id: string | number) => Promise<BulkDocResult>,
  opts: RunBulkOptions
): Promise<RunBulkSummary> {
  const dedupedIds = dedupeIds(ids);
  const concurrency = Math.max(1, opts.concurrency || 5);
  const run: BulkRun = {
    opts,
    total: dedupedIds.length,
    active: [],
    uiResults: [],
    remaining: [],
    completed: 0,
    done: 0,
    unchanged: 0,
    rejected: 0,
    errors: 0,
    skipped: 0,
  };

  emitBulk(run, {
    phase: "started",
    completed: 0,
    concurrency: Math.min(concurrency, run.total),
  });

  const results = await runPool(dedupedIds, concurrency, (id) => runBulkDoc(run, worker, id));

  emitBulk(run, {
    phase: "done",
    completed: run.done,
    unchanged: run.unchanged,
    rejected: run.rejected,
    errors: run.errors,
    skipped: run.skipped,
    remaining: run.remaining.length,
    results: run.uiResults.slice(-60),
  });

  return {
    results: results.filter((result) => !run.remaining.includes(result.id)),
    done: run.done,
    unchanged: run.unchanged,
    rejected: run.rejected,
    errors: run.errors,
    skipped: run.skipped,
    remaining: run.remaining,
  };
}
