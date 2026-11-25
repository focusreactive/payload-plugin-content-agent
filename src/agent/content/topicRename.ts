import { collectStrings } from "./collectStrings.js";

export interface Leftover {
  path: string;
  text: string;
}

export interface IncompleteRename {
  from: string;
  to: string;
  beforeCount: number;
  afterCount: number;
  leftovers: Leftover[];
}

const TERM = /(?<![\p{L}\p{N}])(\p{Lu}[\p{L}\p{N}]{2,}(?:\.[\p{Ll}]{2,})?)(?![\p{L}\p{N}])/gu;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>)]+/giu;
// No `g` flag: a global regex keeps `lastIndex` between `.test()` calls and answers false on every
// other call.
const HAS_URL = /\bhttps?:\/\/[^\s"'<>)]+/iu;

function occurrences(term: string, strings: { text: string }[]): number {
  const needle = term.toLowerCase();
  let count = 0;

  // An empty needle never advances indexOf.
  if (!needle) return 0;

  for (const { text } of strings) {
    const hay = text.toLowerCase();
    let i = hay.indexOf(needle);

    while (i !== -1) {
      count += 1;
      i = hay.indexOf(needle, i + needle.length);
    }
  }

  return count;
}

function countTerms(strings: { text: string }[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const { text } of strings) {
    for (const match of text.matchAll(TERM)) {
      const term = match[1];

      counts.set(term, (counts.get(term) ?? 0) + 1);
    }

    for (const urlMatch of text.matchAll(URL_IN_TEXT)) {
      const host = urlMatch[0]
        .replace(/^https?:\/\//iu, "")
        .split(/[/?#]/u)[0]
        .replace(/^www\./iu, "");
      const label = host.split(".")[0];

      if (label.length >= 3) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  return counts;
}

// A term is letters and digits with at most one dot, so the dot is the only character to escape.
const wholeWord = (term: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/\./gu, "\\.")}(?![\\p{L}\\p{N}])`, "gu");

/** A name keeps its capital wherever it stands. A word of the language has one at the start of a
 * sentence only, and appears more often in lowercase. */
function isName(term: string, strings: { text: string }[]): boolean {
  const lower = term.toLowerCase();

  if (lower === term) return true;
  let capital = 0;
  let small = 0;

  for (const { text } of strings) {
    const prose = text.replace(URL_IN_TEXT, " ");

    capital += prose.match(wholeWord(term))?.length ?? 0;
    small += prose.match(wholeWord(lower))?.length ?? 0;
  }

  return capital > small;
}

const textLength = (strings: { text: string }[]) =>
  strings.reduce((total, { text }) => total + text.length, 0);

const isUrl = (entry: { text: string }) => HAS_URL.test(entry.text);

export function findIncompleteRename(
  before: unknown,
  after: unknown,
  opts: { isTranslation?: boolean } = {}
): IncompleteRename | null {
  if (opts.isTranslation) return null;

  const beforeStrings: { path: string; text: string }[] = [];
  const afterStrings: { path: string; text: string }[] = [];

  collectStrings(before, "", beforeStrings);
  collectStrings(after, "", afterStrings);
  if (!beforeStrings.length || !afterStrings.length) return null;

  const beforeCounts = countTerms(beforeStrings);
  const afterCounts = countTerms(afterStrings);

  const arrived = [...afterCounts.entries()]
    .filter(
      ([term, count]) =>
        count >= 10 && (beforeCounts.get(term) ?? 0) <= 2 && isName(term, afterStrings)
    )
    .sort((left, right) => right[1] - left[1])[0];

  if (!arrived) return null;

  const candidates = [...beforeCounts.keys()].filter(
    (term) =>
      term !== arrived[0] && (beforeCounts.get(term) ?? 0) >= 10 && isName(term, beforeStrings)
  );
  // A term that falls only as much as the whole text did was shortened with it, not renamed.
  const kept = Math.min(1, textLength(afterStrings) / textLength(beforeStrings));
  const departed = candidates
    .map((term) => ({
      t: term,
      was: occurrences(term, beforeStrings),
      now: occurrences(term, afterStrings),
    }))
    .filter(
      (candidate) =>
        candidate.was >= 10 && candidate.now >= 1 && candidate.now <= (candidate.was * kept) / 2
    )
    .sort((left, right) => right.now - left.now)[0];

  if (!departed) return null;

  const from = departed.t;
  const beforeCount = departed.was;
  const needle = from.toLowerCase();
  const hits = afterStrings.filter((entry) => entry.text.toLowerCase().includes(needle));
  const leftovers = [...hits.filter(isUrl), ...hits.filter((entry) => !isUrl(entry))]
    .slice(0, 25)
    .map((entry) => ({
      path: entry.path,
      text: entry.text.length > 160 ? `${entry.text.slice(0, 160)}…` : entry.text,
    }));

  return { from, to: arrived[0], beforeCount, afterCount: departed.now, leftovers };
}

export function describeLeftover(leftover: Leftover): string {
  return `${leftover.path} - "${leftover.text}"`;
}
