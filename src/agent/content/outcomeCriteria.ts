import type { CriterionReport } from "../../types.js";
import { tool } from "ai";

import { isRecord } from "../../borders.js";
import { linksIn } from "./links.js";
import { declareOutcomeInput, readCriteria } from "./outcomeInput.js";
import type { Criterion } from "./outcomeInput.js";
import {
  checkItemRemoved,
  checkItemsAdded,
  containerProblems,
  pathProblems,
  scopeOf,
} from "./outcomeItems.js";
import type { CriterionResult } from "./outcomeItems.js";
import {
  checkAbsent,
  checkCountAtMost,
  checkPresent,
  isTypographicNeedle,
  textOf,
} from "./outcomeText.js";

export type { Criterion } from "./outcomeInput.js";
export { removalRefusal, type CriterionResult } from "./outcomeItems.js";

function renderedText(scope: unknown): string {
  const nodes: string[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isRecord(node)) return;
    if (node.type === "text" && typeof node.text === "string") nodes.push(node.text);
    for (const child of Object.values(node)) if (child && typeof child === "object") walk(child);
  };

  walk(scope);
  const text = nodes.length
    ? nodes.join("")
    : textOf(scope)
        .map((entry) => entry.text)
        .join(" ");

  return text.replace(/\s+/gu, " ").trim();
}

function trimmedJson(scope: unknown): string {
  const walk = (value: unknown): unknown =>
    typeof value === "string"
      ? value.replace(/\s+/gu, " ").trim()
      : Array.isArray(value)
        ? value.map(walk)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]))
          : value;

  return JSON.stringify(walk(scope) ?? null);
}

function checkNonEmpty(criterion: Criterion, scopeAfter: unknown): CriterionResult {
  const { path } = criterion;
  const strings = textOf(scopeAfter);
  const has = strings.some((entry) => entry.text.trim().length > 0);

  return has
    ? { criterion, ok: true, detail: `${path ?? "the document"} has content.` }
    : { criterion, ok: false, detail: `${path ?? "the document"} is empty.` };
}

function checkChange(
  criterion: Criterion,
  want: boolean,
  scopeBefore: unknown,
  scopeAfter: unknown
): CriterionResult {
  const { path } = criterion;
  const beforeJson = JSON.stringify(scopeBefore ?? null);
  const afterJson = JSON.stringify(scopeAfter ?? null);
  // A space moved between neighbouring text nodes changes nothing a reader sees, so
  // `unchanged` holds. Non-text values are still compared exactly.
  const same =
    beforeJson === afterJson ||
    (trimmedJson(scopeBefore) === trimmedJson(scopeAfter) &&
      renderedText(scopeBefore) === renderedText(scopeAfter));

  return same === want
    ? {
        criterion,
        ok: true,
        detail: want
          ? `${path ?? "the document"} is untouched.`
          : `${path ?? "the document"} changed.`,
      }
    : {
        criterion,
        ok: false,
        detail: want
          ? `${path ?? "the document"} was supposed to stay as it was, and it changed.`
          : `${path ?? "the document"} was supposed to change, and it is identical.`,
      };
}

function checkShorter(
  criterion: Criterion,
  scopeBefore: unknown,
  scopeAfter: unknown
): CriterionResult {
  const from = renderedText(scopeBefore).length;
  const to = renderedText(scopeAfter).length;
  const subject = criterion.path ?? "the document";

  return to < from
    ? { criterion, ok: true, detail: `${subject} went from ${from} to ${to} characters.` }
    : {
        criterion,
        ok: false,
        detail: `${subject} was supposed to get shorter, and it has ${to} characters against ${from} before.`,
      };
}

function checkLengthAtMost(
  criterion: Criterion,
  limit: number,
  scopeAfter: unknown
): CriterionResult {
  const { length } = renderedText(scopeAfter);
  const subject = criterion.path ?? "the document";

  return length <= limit
    ? { criterion, ok: true, detail: `${subject} has ${length} characters.` }
    : {
        criterion,
        ok: false,
        detail: `${subject} has ${length} characters, and at most ${limit} were declared: cut ${length - limit} or more.`,
      };
}

function checkLinkCount(
  criterion: Criterion,
  wanted: number,
  scopeAfter: unknown
): CriterionResult {
  const links = linksIn(scopeAfter);
  const subject = criterion.path ?? "the document";

  if (links.length === wanted)
    return { criterion, ok: true, detail: `${subject} has ${wanted} link(s).` };

  const listed = links
    .slice(0, 6)
    .map((link) => `"${link.text}" -> ${link.url ?? "a document"}`)
    .join("; ");

  return {
    criterion,
    ok: false,
    detail: `${subject} has ${links.length} link(s), and exactly ${wanted} were declared${listed ? `: ${listed}` : ""}. To remove a link, view the field in "surgical" mode and replace its node with the same text without the link.`,
  };
}

const NEEDS_CONTENT: ReadonlySet<string> = new Set([
  "present",
  "nonEmpty",
  "lengthAtMost",
  "linkCount",
  "itemsAdded",
]);

// A document can leave an unset field out: a check that needs no content reads it as empty.
function emptyScopeResult(criterion: Criterion, scopeAfter: unknown): CriterionResult | null {
  const { path, check } = criterion;

  return path && scopeAfter === undefined && NEEDS_CONTENT.has(check.type)
    ? {
        criterion,
        ok: false,
        detail: `"${path}" holds nothing in the edited document: the field is still empty, or the ref is not a ref of this document. Write the field, or call declareOutcome again with the ref as getEditableContent gives it.`,
      }
    : null;
}

function checkCriterion(criterion: Criterion, before: unknown, after: unknown): CriterionResult {
  const { path, check } = criterion;

  if (check.type === "judgement") return { criterion, ok: true, deferred: true };
  if (check.type === "itemRemoved") return checkItemRemoved(criterion, before, after);

  const scopeAfter = scopeOf(after, path);
  const empty = emptyScopeResult(criterion, scopeAfter);

  if (empty) return empty;

  if (
    (check.type === "absent" || check.type === "present" || check.type === "countAtMost") &&
    /^\s|\s$/u.test(check.text) &&
    !isTypographicNeedle(check.text)
  ) {
    return {
      criterion,
      ok: true,
      detail: `"${check.text}" is about a space at a node boundary, which does not render - not checked.`,
    };
  }

  switch (check.type) {
    case "absent":
      return checkAbsent(criterion, check.text, scopeAfter);
    case "present":
      return checkPresent(criterion, check.text, scopeAfter);
    case "countAtMost":
      return checkCountAtMost(criterion, check, scopeAfter);
    case "nonEmpty":
      return checkNonEmpty(criterion, scopeAfter);
    case "unchanged":
    case "changed":
      return checkChange(criterion, check.type === "unchanged", scopeOf(before, path), scopeAfter);
    case "shorter":
      return checkShorter(criterion, scopeOf(before, path), scopeAfter);
    case "lengthAtMost":
      return checkLengthAtMost(criterion, check.n, scopeAfter);
    case "linkCount":
      return checkLinkCount(criterion, check.n, scopeAfter);
    case "itemsAdded":
      return checkItemsAdded(criterion, check.n, scopeOf(before, path), scopeAfter);
  }
}

export function checkCriteria(
  criteria: Criterion[],
  before: unknown,
  after: unknown
): CriterionResult[] {
  return criteria.map((criterion) => checkCriterion(criterion, before, after));
}

/** The declared outcome as the review panel shows it: one line per criterion with its result. */
export function reportCriteria(results: CriterionResult[]): CriterionReport[] {
  return results.map((result) => {
    const { check, path, why } = result.criterion;
    const stated = check.type === "judgement" ? check.description : check.type;
    const text =
      `${stated}${path ? ` at ${path}` : ""}${why ? ` (${why})` : ""}` +
      (!result.ok && result.detail ? `: ${result.detail}` : "");

    return { text, result: result.deferred ? "not-checked" : result.ok ? "met" : "not-met" };
  });
}

export function describeFailures(results: CriterionResult[]): string {
  return results
    .filter((result) => !result.ok)
    .map((result) => {
      const where = result.criterion.path ? ` at ${result.criterion.path}` : "";
      const why = result.criterion.why ? ` (${result.criterion.why})` : "";

      return `- ${result.criterion.check.type}${where}${why}: ${result.detail}`;
    })
    .join("\n");
}

export function judgementQuestions(results: CriterionResult[]): string[] {
  return results
    .filter((result) => result.deferred && result.criterion.check.type === "judgement")
    .map((result) => {
      const check = result.criterion.check as { type: "judgement"; description: string };

      return result.criterion.path
        ? `${check.description} (${result.criterion.path})`
        : check.description;
    });
}

export interface OutcomeState {
  criteria: Criterion[];
  /** Criteria of an earlier declaration that a later one left out. */
  dropped?: Criterion[];
}

export const declaresShorter = (state: OutcomeState): boolean =>
  state.criteria.some((criterion) => criterion.check.type === "shorter");

/** What the declared link counts say against the document as it was opened: the task removes
 *  links, adds links, or says nothing about them. */
export function linkIntent(state: OutcomeState, original: unknown): "fewer" | "more" | null {
  const changes = state.criteria.flatMap(({ path, check }) =>
    check.type === "linkCount" ? [check.n - linksIn(scopeOf(original, path)).length] : []
  );

  if (changes.some((change) => change < 0)) return "fewer";

  return changes.some((change) => change > 0) ? "more" : null;
}

const criterionKey = ({ path, check }: Criterion): string => JSON.stringify([path ?? "", check]);

const criterionLabel = ({ path, check }: Criterion): string => {
  const subject =
    "text" in check ? ` "${check.text}"` : "description" in check ? ` "${check.description}"` : "";
  const limit =
    check.type === "countAtMost" || check.type === "lengthAtMost"
      ? ` at most ${check.n}`
      : check.type === "linkCount" || check.type === "itemsAdded"
        ? ` exactly ${check.n}`
        : "";

  return `${check.type}${subject}${limit}${path ? ` at ${path}` : ""}`;
};

/** The criteria that left the contract after they were declared and that the document does not
 *  meet (or that no check can decide): reported with the saved draft as a fact. */
export function describeDropped(dropped: Criterion[], before: unknown, after: unknown): string[] {
  return checkCriteria(dropped, before, after)
    .filter((result) => !result.ok || result.deferred)
    .map(
      (result) =>
        `${criterionLabel(result.criterion)}${result.ok ? "" : `: ${result.detail ?? "not met"}`}`
    );
}

function redeclare(state: OutcomeState, criteria: Criterion[]) {
  const declaredNow = new Set(criteria.map(criterionKey));
  const declaredBefore = new Set(state.criteria.map(criterionKey));
  const added = criteria.filter((criterion) => !declaredBefore.has(criterionKey(criterion)));
  const dropped = state.criteria.filter((criterion) => !declaredNow.has(criterionKey(criterion)));

  state.dropped = [...(state.dropped ?? []), ...dropped].filter(
    (criterion) => !declaredNow.has(criterionKey(criterion))
  );

  return { added: added.map(criterionLabel), dropped: dropped.map(criterionLabel) };
}

function countsNow(criteria: Criterion[], document: unknown): string[] {
  const counted = criteria.filter((criterion) => criterion.check.type === "countAtMost");

  return checkCriteria(counted, document, document)
    .filter((result) => !result.ok)
    .map((result) => `${result.detail}`);
}

const spacedText = ({ check }: Criterion): boolean =>
  (check.type === "absent" || check.type === "present" || check.type === "countAtMost") &&
  /^\s|\s$/u.test(check.text) &&
  !isTypographicNeedle(check.text);

export interface OutcomeDocument {
  current: () => unknown;
  /** True when the path is a field or an item of the document by its schema. */
  resolves?: (path: string) => boolean;
}

function declareOutcome(state: OutcomeState, criteria: Criterion[], document?: OutcomeDocument) {
  const currentDocument = document?.current;
  const problems = currentDocument
    ? [
        ...containerProblems(criteria, currentDocument()),
        ...(document.resolves ? pathProblems(criteria, currentDocument(), document.resolves) : []),
      ]
    : [];

  if (problems.length)
    return {
      error: `Nothing was declared. ${problems.join(" ")} Call declareOutcome again with every criterion that still holds.`,
    };

  const changed = state.criteria.length ? redeclare(state, criteria) : null;

  state.criteria = criteria;
  const machine = criteria.filter((criterion) => criterion.check.type !== "judgement").length;
  const overLimit = currentDocument ? countsNow(criteria, currentDocument()) : [];
  const spaced = criteria.filter(spacedText).map(criterionLabel);

  return {
    ok: true,
    declared: criteria.length,
    checkedMechanically: machine,
    ...(changed ? { added: changed.added, dropped: changed.dropped } : {}),
    ...(overLimit.length ? { overLimitNow: overLimit } : {}),
    ...(spaced.length ? { notChecked: spaced } : {}),
    note:
      `${machine} of ${criteria.length} will be checked against the document itself; the rest go to the reviewer as specific questions. ` +
      "Edit now - these are verified after you finish, and an unmet criterion sends the work back with the reason." +
      (changed?.dropped.length
        ? ` You dropped ${changed.dropped.length} criterion(s) declared earlier: each one the saved document does not meet is reported to the person with the draft, so say in your summary why it was wrong for the task.`
        : "") +
      (overLimit.length
        ? " The counts in overLimitNow are the document as it is now: keep such a criterion only if the task asks to remove or rewrite those occurrences, otherwise declare again with the limit the task means."
        : "") +
      (spaced.length
        ? " The criteria in notChecked have a `text` that starts or ends with a space, and such a text is not checked: declare again with the text without that space."
        : ""),
  };
}

export function createOutcomeTools(
  state: OutcomeState,
  currentDocument?: () => unknown,
  resolves?: (path: string) => boolean
) {
  const document = currentDocument ? { current: currentDocument, resolves } : undefined;

  return {
    declareOutcome: tool({
      description:
        "State what must be TRUE of the document when this task is done, BEFORE editing it. Each criterion is checked mechanically against the saved result and a failure sends the edit back with the specific reason - so declare what the task actually asks for, not what is easy to satisfy. Worth doing for any edit with more than one field in play (a rewrite, a rename, a translation, a cleanup); skip it for a single obvious field change. Use `judgement` only for something no check could decide. A second call replaces the whole list of the first: send every criterion that still holds again.",
      inputSchema: declareOutcomeInput,
      execute: async (input: unknown) => {
        const read = readCriteria(input);

        return "error" in read ? read : declareOutcome(state, read.criteria, document);
      },
    }),
  };
}
