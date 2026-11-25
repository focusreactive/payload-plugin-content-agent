import { wrapLanguageModel } from "ai";
import type { LanguageModel, LanguageModelMiddleware } from "ai";

export const MODEL_CALL_TIMEOUT_MS = 180_000;
/** An embedding call has its own limit: the probe at startup holds every endpoint that waits for
 * memory. */
export const EMBEDDING_CALL_TIMEOUT_MS = 60_000;

export const embeddingTimeLimit = () => ({
  abortSignal: AbortSignal.timeout(EMBEDDING_CALL_TIMEOUT_MS),
});

export class ModelCallTimeoutError extends Error {}

type WrappableModel = Parameters<typeof wrapLanguageModel>[0]["model"];

const isWrappable = (model: LanguageModel | undefined): model is WrappableModel =>
  typeof model === "object" && model !== null && "doGenerate" in model;

/**
 * A call that returns its answer in one piece has no sign of life until the answer comes.
 * A streamed call is not limited here: its chunks show that the model works.
 */
const timeoutMiddleware = (timeoutMs: number): LanguageModelMiddleware => ({
  transformParams: ({ type, params }) => {
    if (type !== "generate") return Promise.resolve(params);
    const timer = AbortSignal.timeout(timeoutMs);

    return Promise.resolve({
      ...params,
      abortSignal: params.abortSignal ? AbortSignal.any([params.abortSignal, timer]) : timer,
    });
  },
  wrapGenerate: async ({ doGenerate, params }) => {
    try {
      return await doGenerate();
    } catch (error) {
      const reason: unknown = params.abortSignal?.reason;

      if (reason instanceof DOMException && reason.name === "TimeoutError")
        throw new ModelCallTimeoutError(
          `The model did not answer in ${Math.round(timeoutMs / 1000)} seconds.`,
          { cause: error }
        );
      throw error;
    }
  },
});

/** The same model, with a time limit on every call that is not streamed. */
export function withCallTimeout<Model extends LanguageModel | undefined>(
  model: Model,
  timeoutMs: number = MODEL_CALL_TIMEOUT_MS
): Model {
  return isWrappable(model)
    ? (wrapLanguageModel({ model, middleware: timeoutMiddleware(timeoutMs) }) as Model)
    : model;
}
