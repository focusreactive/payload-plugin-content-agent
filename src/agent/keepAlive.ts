import { isRecord } from "../borders.js";

export type WaitUntil = (promise: Promise<unknown>) => void;

const REQUEST_CONTEXT_SYMBOLS = [
  Symbol.for("@next/request-context"),
  Symbol.for("@vercel/request-context"),
];

// The request context is visible only inside the request scope: call this when the request starts.
export function captureWaitUntil(): WaitUntil | undefined {
  for (const symbol of REQUEST_CONTEXT_SYMBOLS) {
    try {
      const store = (globalThis as Record<symbol, unknown>)[symbol];
      const context: unknown =
        isRecord(store) && typeof store.get === "function" ? store.get() : undefined;

      if (!isRecord(context)) continue;
      const waitUntil = context.waitUntil;

      if (typeof waitUntil === "function") return (promise) => waitUntil.call(context, promise);
    } catch {
      // A host accessor that fails must not fail the request.
    }
  }

  return undefined;
}
