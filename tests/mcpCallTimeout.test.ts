import { describe, expect, it, vi } from "vitest";

import { McpCallTimeoutError, withCallTimeouts } from "../src/agent/mcpCallTimeout.js";

const never = () => new Promise(() => undefined);

describe("MCP call timeout", () => {
  it("returns the result of a call that answers in time and keeps the other keys", async () => {
    const tools = withCallTimeouts(
      { findThings: { description: "d", execute: async (input: any) => ({ got: input }) } },
      1000
    );

    expect(tools.findThings.description).toBe("d");
    expect(await (tools.findThings.execute as any)({ id: 1 }, {})).toEqual({ got: { id: 1 } });
  });

  it("stops a read that does not answer and says to call it once more", async () => {
    const tools = withCallTimeouts({ findThings: { execute: never } }, 20);
    const call = (tools.findThings.execute as any)({}, {});

    await expect(call).rejects.toBeInstanceOf(McpCallTimeoutError);
    await expect(call).rejects.toThrow(/findThings.*did not answer.*Call it once more/su);
  });

  it("says that a write may have happened and to read before a second call", async () => {
    const tools = withCallTimeouts({ createThings: { execute: never } }, 20);

    await expect((tools.createThings.execute as any)({}, {})).rejects.toThrow(
      /not known whether the call changed anything.*before you call "createThings" again/su
    );
  });

  it("aborts the request of the call and still follows the signal of the caller", async () => {
    const seen: AbortSignal[] = [];
    const tools = withCallTimeouts(
      {
        findThings: {
          execute: (_input: any, options: any) => {
            seen.push(options.abortSignal);

            return never();
          },
        },
      },
      20
    );

    await expect((tools.findThings.execute as any)({}, {})).rejects.toThrow();
    expect(seen[0].aborted).toBe(true);

    const caller = new AbortController();
    const onAbort = vi.fn();

    void (async () => {
      try {
        await (tools.findThings.execute as any)({}, { abortSignal: caller.signal });
      } catch (error) {
        onAbort(error);
      }
    })();

    seen[1].addEventListener("abort", onAbort);
    caller.abort();
    expect(seen[1].aborted).toBe(true);
  });

  it("leaves a tool without execute as it is", () => {
    const tool: { description: string; execute?: () => unknown } = { description: "d" };

    expect(withCallTimeouts({ plain: tool }).plain).toBe(tool);
  });
});
