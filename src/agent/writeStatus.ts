import { isRecord } from "../borders.js";
import { mcpWriteError } from "./mcpParse.js";

export const WRITE_STATUSES = [
  "done",
  "needs-confirmation",
  "needs-input",
  "nothing-changed",
  "live-write",
  "failed",
] as const;

/**
 * What a write tool call ended with. The interface and the turn checks read this field;
 * neither reads the words of a result or of the reply.
 */
export type WriteStatus = (typeof WRITE_STATUSES)[number];

const isWriteStatus = (value: unknown): value is WriteStatus =>
  typeof value === "string" && (WRITE_STATUSES as readonly string[]).includes(value);

const count = (value: unknown): number => (typeof value === "number" ? value : 0);

function manyStatus(done: number, failed: number): WriteStatus {
  if (done > 0) return "done";

  return failed > 0 ? "failed" : "nothing-changed";
}

/** A tool that knows its own status sets `writeStatus`; every other result is read by its shape. */
export function writeStatusOf(result: unknown): WriteStatus | undefined {
  if (!isRecord(result)) return undefined;
  if (isWriteStatus(result.writeStatus)) return result.writeStatus;
  if (result.status === "needsInput") return "needs-input";
  if (result.status === "unchanged") return "nothing-changed";
  if (result.error || result.isError === true) return "failed";
  // A tool of the site reports a refused write in its text, with no error flag.
  if (Array.isArray(result.content) && mcpWriteError(result)) return "failed";
  if (result.status === "error" || result.status === "rejected") return "failed";

  if (typeof result.total === "number")
    return manyStatus(count(result.done), count(result.errors) + count(result.rejected));

  if (typeof result.changedDocs === "number")
    return manyStatus(result.changedDocs, count(result.errors));

  return "done";
}

export const withWriteStatus = <Result>(result: Result): Result => {
  const writeStatus = writeStatusOf(result);

  return isRecord(result) && writeStatus ? { ...result, writeStatus } : result;
};
