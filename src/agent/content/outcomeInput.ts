import { jsonSchema } from "ai";
import type { JSONSchema7 } from "ai";
import { z } from "zod";

import { isRecord } from "../../borders.js";

const CHECK_TYPES = [
  "absent",
  "present",
  "countAtMost",
  "nonEmpty",
  "unchanged",
  "changed",
  "shorter",
  "lengthAtMost",
  "linkCount",
  "itemRemoved",
  "itemsAdded",
  "judgement",
] as const;

type CheckType = (typeof CHECK_TYPES)[number];

export type Check =
  | { type: "absent" | "present"; text: string }
  | { type: "countAtMost"; text: string; n: number }
  | { type: "linkCount" | "itemsAdded" | "lengthAtMost"; n: number }
  | { type: "nonEmpty" | "unchanged" | "changed" | "shorter" | "itemRemoved" }
  | { type: "judgement"; description: string };

export interface Criterion {
  path?: string;
  check: Check;
  why?: string;
}

const MAX_CRITERIA = 20;

const criterionShape = z.object({
  type: z
    .enum(CHECK_TYPES)
    .describe(
      "What is checked. `absent`: `text` must NOT appear. `present`: `text` must appear. `countAtMost`: `text` appears at most `n` times. `nonEmpty`: there is content here. `unchanged`: this stays exactly as it was. `changed`: this ends different from what it was. `shorter`: the text here ends shorter than it was. Declare it when the task asks for a shorter text: without it, an edit that drops most of a text is refused as lost content. `lengthAtMost`: the text here ends with at most `n` characters. Declare it when the task sets a limit on the length of a text: the check counts the characters, and no reader counts them right. `linkCount`: exactly `n` links are here at the end (0 when the task removes every link). Declare it when the task removes or adds links: without it, an edit that drops a link is refused as lost content, and a change of where an existing link points is taken as asked for. `itemRemoved`: the block or array row at `path` is gone at the end; `path` is the ref of the item, the path of its container and then its id in brackets, as in `structure`. Declare one for each item the task removes: once one is declared, removeItem refuses every other item. `itemsAdded`: the blocks or array field at `path` ends with exactly `n` more items than it had. Declare it when the task adds a section, a block or a row. `judgement`: something only a reader can decide, put as a question in `description`."
    ),
  path: z
    .string()
    .optional()
    .describe(
      'Field ref this applies to, e.g. "<field>" or "<blocksField>[<blockId>].<arrayField>[<rowId>].<field>". Omit for the whole document. Required for `lengthAtMost`, `itemsAdded` and `itemRemoved`.'
    ),
  text: z
    .string()
    .optional()
    .describe("The literal text. Required for `absent`, `present` and `countAtMost`."),
  n: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Required for `countAtMost` (maximum number of occurrences allowed), for `lengthAtMost` (the maximum number of characters), for `linkCount` (the exact number of links) and for `itemsAdded` (the exact number of new items)."
    ),
  description: z
    .string()
    .optional()
    .describe(
      "Something only a reader can decide - handed to the reviewer as a specific question. Required for `judgement`."
    ),
  why: z.string().optional().describe("One line: what would be wrong if this failed."),
});

const inputShape = z.object({
  criteria: z
    .array(criterionShape)
    .min(1)
    .max(MAX_CRITERIA)
    .describe(
      "What must hold when the work is finished: the WHOLE list. A later call replaces the list of the call before it, so send every criterion that still holds again."
    ),
});

// The schema only describes the shape to the model. The input is checked in `readCriteria`, so
// a wrong shape gets a refusal that names the valid one in place of a validation error.
export const declareOutcomeInput = jsonSchema<unknown>(
  z.toJSONSchema(inputShape, { target: "draft-7", io: "input" }) as JSONSchema7
);

const TYPE_LIST = CHECK_TYPES.map((type) => `"${type}"`).join(", ");

const VALID_SHAPE = `{"type": one of ${TYPE_LIST}, "path": "<field ref, omit for the whole document>", "text": "<literal text, for absent, present and countAtMost>", "n": <number, for countAtMost, lengthAtMost, linkCount and itemsAdded>, "description": "<question, for judgement>", "why": "<one line>"}`;

const isCheckType = (value: unknown): value is CheckType =>
  CHECK_TYPES.some((type) => type === value);

const isFilled = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const ITEM_REF = /\[[^\]]+\]$/u;

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const NEEDS_PATH = {
  lengthAtMost: '"lengthAtMost" needs "path", the field whose text has the limit',
  itemsAdded: '"itemsAdded" needs "path", the blocks or array field that gets the new items',
};

function readCounted(
  type: "lengthAtMost" | "linkCount" | "itemsAdded",
  n: unknown,
  path: unknown
): Check | string {
  if (type !== "linkCount" && !isFilled(path)) return NEEDS_PATH[type];
  if (isCount(n)) return { type, n };
  const needsCount = `"${type}" needs "n", a whole number of 0 or more`;

  return type === "linkCount"
    ? `${needsCount}: the exact number of links at the end. To keep every link, declare no "linkCount": an edit that drops a link is refused without it`
    : needsCount;
}

function readCheck(item: Record<string, unknown>): Check | string {
  const { type, text, n, description, path } = item;

  if (type === undefined)
    return `"type" is missing (the keys sent: ${Object.keys(item).join(", ") || "none"})`;
  if (!isCheckType(type))
    return `"type" is ${JSON.stringify(type)}, it must be one of ${TYPE_LIST}`;

  const needsText = `"${type}" needs "text", the literal text to look for`;
  const needsCount = `"${type}" needs "n", a whole number of 0 or more`;

  switch (type) {
    case "absent":
    case "present":
      return isFilled(text) ? { type, text } : needsText;
    case "countAtMost":
      if (!isFilled(text)) return needsText;

      return isCount(n) ? { type, text, n } : needsCount;
    case "lengthAtMost":
    case "linkCount":
    case "itemsAdded":
      return readCounted(type, n, path);
    case "itemRemoved":
      return isFilled(path) && ITEM_REF.test(path)
        ? { type }
        : '"itemRemoved" needs "path", the ref of the block or row that goes, with its id in brackets at the end, as in "<blocksField>[<id>]"';
    case "judgement":
      return isFilled(description)
        ? { type, description }
        : '"judgement" needs "description", the question for the reviewer';
    default:
      return { type };
  }
}

function readCriterion(item: unknown): Criterion | string {
  if (!isRecord(item)) return "it is not an object";

  const check = readCheck(item);

  if (typeof check === "string") return check;

  const { path, why } = item;

  if (path !== undefined && path !== null && typeof path !== "string")
    return '"path" must be a field ref as text';

  return { ...(path ? { path } : {}), check, ...(isFilled(why) ? { why } : {}) };
}

const refusal = (problems: string[]): string =>
  `Nothing was declared. ${problems.join(" ")} Call declareOutcome again with every criterion as one flat object: ${VALID_SHAPE}.`;

export function readCriteria(input: unknown): { criteria: Criterion[] } | { error: string } {
  const list = isRecord(input) ? input.criteria : undefined;

  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_CRITERIA)
    return { error: refusal([`"criteria" must be a list of 1 to ${MAX_CRITERIA} criteria.`]) };

  const read = list.map(readCriterion);
  const problems = read.flatMap((result, index) =>
    typeof result === "string" ? [`criteria[${index}]: ${result}.`] : []
  );

  if (problems.length) return { error: refusal(problems) };

  return { criteria: read.filter((result) => typeof result !== "string") };
}
