import { quiet } from "../promises.js";

export const MCP_CALL_TIMEOUT_MS = 60_000;

export class McpCallTimeoutError extends Error {}

const READS = /^(get|find|list|read|search|fetch|query)/iu;

function timeoutMessage(name: string, timeoutMs: number): string {
  const waited = `The tool "${name}" did not answer in ${Math.round(timeoutMs / 1000)} seconds.`;

  return READS.test(name)
    ? `${waited} Call it once more. If it does not answer again, tell the person that its server does not answer.`
    : `${waited} It is not known whether the call changed anything. Read the document or the data it writes before you call "${name}" again: a second call may write twice.`;
}

interface Callable {
  execute?: (input: never, options: never) => unknown;
}

function withCallTimeout<Tool extends Callable>(name: string, tool: Tool, timeoutMs: number): Tool {
  const { execute } = tool;

  if (typeof execute !== "function") return tool;

  const timed = async (input: unknown, options?: { abortSignal?: AbortSignal }) => {
    const timer = AbortSignal.timeout(timeoutMs);
    const abortSignal = options?.abortSignal
      ? AbortSignal.any([options.abortSignal, timer])
      : timer;
    const expired = new Promise<never>((_resolve, reject) => {
      timer.addEventListener(
        "abort",
        () => reject(new McpCallTimeoutError(timeoutMessage(name, timeoutMs))),
        { once: true }
      );
    });
    const call = Promise.resolve(
      (execute as (input: unknown, options: unknown) => unknown)(input, {
        ...options,
        abortSignal,
      })
    );

    void quiet(call);

    return Promise.race([call, expired]);
  };

  return { ...tool, execute: timed };
}

/** Every tool of an MCP server stops waiting after `timeoutMs` and says what to do next. */
export function withCallTimeouts<Tools extends Record<string, Callable>>(
  tools: Tools,
  timeoutMs: number = MCP_CALL_TIMEOUT_MS
): Tools {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, withCallTimeout(name, tool, timeoutMs)])
  ) as Tools;
}
