import { collectStrings } from "./collectStrings.js";
import { normalizeForMatch } from "./guards.js";
import type { Criterion } from "./outcomeInput.js";
import type { CriterionResult } from "./outcomeItems.js";

// The criteria that count a text in the strings of a scope: absent, present and countAtMost.

// A stored number is a value a criterion can name too: the id of a reference, a count, a year.
function numbersAsText(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : value;
  if (Array.isArray(value)) return value.map(numbersAsText);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, numbersAsText(child)])
    );

  return value;
}

export function textOf(value: unknown): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];

  collectStrings(numbersAsText(value), "", out);

  return out;
}

export function isTypographicNeedle(needle: string): boolean {
  const letters = (needle.match(/[\p{L}\p{N}]/gu) ?? []).length;

  return letters < 3 || letters * 2 < needle.length;
}

function occurrences(needle: string, strings: { text: string }[]): { n: number; where: string[] } {
  const exact = isTypographicNeedle(needle);
  const norm = (text: string) => (exact ? text : normalizeForMatch(text)).toLowerCase();
  const query = norm(needle);
  let count = 0;
  const where: string[] = [];

  // An empty needle never advances indexOf, so the loop below would not end.
  if (!query) return { n: count, where };

  for (const entry of strings) {
    const hay = norm(entry.text);
    let i = hay.indexOf(query);

    while (i !== -1) {
      count += 1;
      if (where.length < 6)
        where.push(entry.text.length > 120 ? `${entry.text.slice(0, 120)}…` : entry.text);
      i = hay.indexOf(query, i + query.length);
    }
  }

  return { n: count, where };
}

export function checkAbsent(
  criterion: Criterion,
  text: string,
  scopeAfter: unknown
): CriterionResult {
  const { n: count, where } = occurrences(text, textOf(scopeAfter));

  return count === 0
    ? { criterion, ok: true, detail: `"${text}" does not appear.` }
    : {
        criterion,
        ok: false,
        detail: `"${text}" still appears ${count} time(s): ${where.map((excerpt) => `"${excerpt}"`).join("; ")}`,
      };
}

export function checkPresent(
  criterion: Criterion,
  text: string,
  scopeAfter: unknown
): CriterionResult {
  const { path } = criterion;
  const { n: count } = occurrences(text, textOf(scopeAfter));

  return count > 0
    ? { criterion, ok: true, detail: `"${text}" appears ${count} time(s).` }
    : {
        criterion,
        ok: false,
        detail: `"${text}" does not appear anywhere${path ? ` in ${path}` : ""}.`,
      };
}

export function checkCountAtMost(
  criterion: Criterion,
  check: { text: string; n: number },
  scopeAfter: unknown
): CriterionResult {
  const { n: count, where } = occurrences(check.text, textOf(scopeAfter));

  return count <= check.n
    ? {
        criterion,
        ok: true,
        detail: `"${check.text}" appears ${count} time(s), at most ${check.n} allowed.`,
      }
    : {
        criterion,
        ok: false,
        detail: `"${check.text}" appears ${count} time(s), at most ${check.n} allowed: ${where.map((excerpt) => `"${excerpt}"`).join("; ")}`,
      };
}
