import { InvalidToolInputError } from "ai";
import type { ToolCallRepairFunction, ToolSet } from "ai";
import { isRecord } from "../borders.js";

interface TooBigIssue {
  path: (string | number)[];
  maximum: number;
}

function issuesOf(error: unknown, depth = 0): unknown[] {
  if (!isRecord(error) || depth > 3) return [];
  if (Array.isArray(error.issues)) return error.issues;

  return issuesOf(error.cause, depth + 1);
}

function tooBig(issue: unknown): TooBigIssue | null {
  if (!isRecord(issue) || issue.code !== "too_big" || issue.origin !== "number") return null;
  if (typeof issue.maximum !== "number" || !Array.isArray(issue.path)) return null;

  return { path: issue.path as (string | number)[], maximum: issue.maximum };
}

/**
 * A number above the maximum of its parameter is lowered to the maximum, and the call runs.
 * Any other invalid input stays invalid: the model reads the error and sends the call again.
 */
export const lowerNumbersToMaximum: ToolCallRepairFunction<ToolSet> = async ({
  toolCall,
  error,
}) => {
  if (!InvalidToolInputError.isInstance(error)) return null;
  const issues = issuesOf(error);
  const fixes = issues.map(tooBig);

  if (!fixes.length || fixes.some((fix) => fix === null)) return null;
  let input: unknown;

  try {
    input = JSON.parse(toolCall.input);
  } catch {
    return null;
  }

  for (const fix of fixes as TooBigIssue[]) {
    const parent = fix.path
      .slice(0, -1)
      .reduce<unknown>(
        (value, key) => (isRecord(value) || Array.isArray(value) ? (value as never)[key] : null),
        input
      );
    const last = fix.path.at(-1);

    if ((!isRecord(parent) && !Array.isArray(parent)) || last === undefined) return null;
    (parent as Record<string | number, unknown>)[last] = fix.maximum;
  }

  return { ...toolCall, input: JSON.stringify(input) };
};
