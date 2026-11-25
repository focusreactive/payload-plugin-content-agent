import { describe, it, expect, vi, afterEach } from "vitest";
import { captureWaitUntil } from "../src/agent/keepAlive.js";

const NEXT = Symbol.for("@next/request-context");
const VERCEL = Symbol.for("@vercel/request-context");
const g = globalThis as Record<symbol, any>;

describe("captureWaitUntil", () => {
  afterEach(() => {
    Reflect.deleteProperty(g, NEXT);
    Reflect.deleteProperty(g, VERCEL);
  });

  it("returns nothing outside a serverless request context", () => {
    expect(captureWaitUntil()).toBeUndefined();
  });

  it("hands work to the request context waitUntil (Next.js)", () => {
    const waitUntil = vi.fn();

    g[NEXT] = { get: () => ({ waitUntil }) };
    const work = Promise.resolve();

    captureWaitUntil()!(work);
    expect(waitUntil).toHaveBeenCalledWith(work);
  });

  it("falls back to the Vercel request context", () => {
    const waitUntil = vi.fn();

    g[VERCEL] = { get: () => ({ waitUntil }) };
    captureWaitUntil()!(Promise.resolve());
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it("ignores a context accessor that throws", () => {
    g[NEXT] = {
      get: () => {
        throw new Error("outside request scope");
      },
    };
    expect(captureWaitUntil()).toBeUndefined();
  });
});
