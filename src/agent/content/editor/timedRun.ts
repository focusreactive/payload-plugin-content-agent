import type { EditorRunOptions } from "./state.js";
import { runContentEditor } from "./session.js";
import { quiet } from "../../../promises.js";

/** Lower than the single-document budget: a bulk document is also bound by
 *  DEFAULT_DOC_TIMEOUT_MS, and a document that times out before its save saves nothing. */
const BULK_DOC_MAX_STEPS = 60;

interface TimedRunOptions extends EditorRunOptions {
  id: string | number;
  timeoutMs: number;
}

export async function runWithTimeout(options: TimedRunOptions) {
  const { id, timeoutMs, signal: parentSignal, ...run } = options;
  const abortController = new AbortController();
  let timedOut = false;
  let saving = false;
  const onParentAbort = () => abortController.abort();

  if (parentSignal?.aborted) abortController.abort();
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  const abortLabel = () =>
    timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : "aborted by user";

  const work = (async () => {
    try {
      const result = await runContentEditor({
        ...run,
        id,
        signal: abortController.signal,
        maxSteps: BULK_DOC_MAX_STEPS,
        onSaveStart: () => {
          saving = true;
        },
      });

      if (abortController.signal.aborted && result.status === "error") {
        return { ...result, status: "error" as const, error: abortLabel() };
      }

      const { status } = result;

      if (status === "needsInput")
        return {
          id,
          status: "error" as const,
          error: `stopped with a question: ${result.question}`,
        };

      return { ...result, status };
    } catch (err) {
      return {
        id,
        status: "error" as const,
        error: abortController.signal.aborted
          ? abortLabel()
          : `Editor crashed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  })();

  // Only an LLM call observes the abort signal; a stuck read or write never returns, so a deadline
  // frees the pool slot. The session checks the signal right before it saves, so a save follows
  // only when it had started before the abort: the answer then says it may still land.
  let deadlineTimer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<{ id: string | number; status: "error"; error: string }>(
    (resolve) => {
      deadlineTimer = setTimeout(
        () =>
          resolve({
            id,
            status: "error",
            error: saving
              ? `${abortLabel()} while its draft was being saved: the save may still land. Read the document before running this task on it again, or the change is made twice.`
              : `${abortLabel()} (the underlying operation is still running in the background and was not saved)`,
          }),
        timeoutMs + 5_000
      );
    }
  );

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    clearTimeout(deadlineTimer!);
    parentSignal?.removeEventListener("abort", onParentAbort);
    void quiet(work);
  }
}
