import { isRecord } from "../../borders.js";
import { withWriteStatus, writeStatusOf } from "../writeStatus.js";
import type { WriteTracker } from "./scope.js";

const CONTENT_WRITE_TOOLS = new Set([
  "editContent",
  "translateContent",
  "findReplaceContent",
  "copyBlock",
  "cloneDocument",
  "createDocument",
  "importArticle",
]);

export const isWriteTool = (name: string): boolean =>
  CONTENT_WRITE_TOOLS.has(name) || /^(?:create|update)/iu.test(name);

/**
 * A write tool call that was refused or failed. A call that waits for the person, asks them
 * a question or found nothing to change is not a failure.
 */
export const reportsFailedWrite = (result: unknown): boolean => writeStatusOf(result) === "failed";

type Executable = { execute?: (...args: never[]) => unknown };

export function countFailedWrites<Tools extends Record<string, unknown>>(
  tools: Tools,
  writeTracker: WriteTracker
): Tools {
  const out: Record<string, unknown> = { ...tools };

  for (const [name, tool] of Object.entries(tools)) {
    const execute = isRecord(tool) ? (tool as Executable).execute : undefined;

    if (!isWriteTool(name) || typeof execute !== "function") continue;
    out[name] = {
      ...(tool as object),
      execute: async (...args: never[]) => {
        let result: unknown;

        try {
          result = withWriteStatus(await execute(...args));
        } catch (error) {
          // A write that timed out may still have saved: the count only says the call failed.
          writeTracker.failed += 1;
          throw error;
        }

        if (reportsFailedWrite(result)) writeTracker.failed += 1;

        return result;
      },
    };
  }

  return out as Tools;
}
