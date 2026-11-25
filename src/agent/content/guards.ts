import type { SchemaField } from "../../types.js";
import { collectContentFields } from "./discovery.js";
import { EDITOR_ADVICE } from "./editAdvice.js";

export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/gu, '"')
    .replace(/[\u2013\u2014\u2212]/gu, "-")
    .replace(/\u00A0/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const SHRINK_MIN_CHARS = 300;

export const SHRINK_RATIO = 0.5;

export const TRANSLATION_SHRINK_RATIO = 0.2;

/** The share of its length a text must keep; none when the editor declared a shorter text. */
export function shrinkRatioFor(declaredShorter: boolean, isTranslation = false): number | null {
  if (declaredShorter) return null;

  return isTranslation ? TRANSLATION_SHRINK_RATIO : SHRINK_RATIO;
}

export function shrinkError(
  ref: string,
  before: string,
  after: string,
  ratio: number | null = SHRINK_RATIO
): string | null {
  if (ratio === null) return null;
  if (typeof before !== "string" || before.length < SHRINK_MIN_CHARS) return null;
  if (after.length >= before.length * ratio) return null;

  return (
    `"${ref}" would shrink from ${before.length} to ${after.length} characters - that is content lost, not edited. ` +
    `A rewrite keeps the text and changes the words that need changing; send the FULL text of this entry with your changes in it. ` +
    EDITOR_ADVICE.shorterField
  );
}

/** The same refusal with the next-step sentence of another caller than the content editor. */
export const withAdvice = (refusal: string, advice: string | undefined): string =>
  advice ? refusal.replace(EDITOR_ADVICE.shorterField, advice) : refusal;

export function findShrunkFields(
  fields: SchemaField[],
  before: unknown,
  after: unknown,
  ratio: number | null = SHRINK_RATIO
): { ref: string; from: number; to: number }[] {
  const out: { ref: string; from: number; to: number }[] = [];

  if (ratio === null) return out;
  const beforeValues = new Map(
    collectContentFields(fields, before, { basePath: "", parentLocalized: false, warnings: [] })
      .filter((leaf) => !leaf.richText && typeof leaf.value === "string")
      .map((leaf) => [leaf.ref, leaf.value as string])
  );

  for (const leaf of collectContentFields(fields, after, {
    basePath: "",
    parentLocalized: false,
    warnings: [],
  })) {
    if (leaf.richText || typeof leaf.value !== "string") continue;
    const prev = beforeValues.get(leaf.ref);

    if (prev === undefined || prev.length < 1000) continue;
    if (leaf.value.length < prev.length * ratio)
      out.push({ ref: leaf.ref, from: prev.length, to: leaf.value.length });
  }

  return out;
}

export function allText(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => allText(entry, out));
  else if (value && typeof value === "object")
    for (const entry of Object.values(value)) allText(entry, out);

  return out;
}

// URLs are left out on purpose: a topic rewrite must change them, and links have their own gates.
const EDGE = "[\\p{L}\\p{N}]";
const NUMBER = "\\p{Nd}+(?:[.,]\\p{Nd}+)?";
// Digits, currency signs and percent signs of any script. A letter unit must end the word:
// "3 steps" is not "3 s".
const PROTECTED = [
  new RegExp(`(?<!${EDGE})\\p{Nd}{1,2}:\\p{Nd}{2}(?::\\p{Nd}{2})?(?!${EDGE})`, "gu"),
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gu,
  new RegExp(
    `(?<!${EDGE})${NUMBER}\\s?(?:[%％٪]|\\p{Sc}|(?:ms|s|MB|GB|px)(?!${EDGE}))|\\p{Sc}\\s?${NUMBER}`,
    "gu"
  ),
];

function valueSurvives(value: string, text: string, reformatted: boolean): boolean {
  if (text.includes(value)) return true;
  if (!reformatted) return false;
  const nums = value.match(/\p{Nd}+/gu);

  if (!nums) return false;
  const loose = new RegExp(`(?<!\\p{Nd})${nums.join("\\P{Nd}{1,3}")}(?!\\p{Nd})`, "u");

  return loose.test(text);
}

export function findLostProtectedValues(
  before: unknown,
  after: unknown,
  instruction: string,
  { isTranslation = false }: { isTranslation?: boolean } = {}
): string[] {
  const beforeText = allText(before).join("\n"),
    afterText = allText(after).join("\n");
  const lost: string[] = [];

  for (const pattern of PROTECTED) {
    const seen = new Set<string>();

    for (const match of beforeText.match(pattern) ?? []) {
      if (seen.has(match)) continue;
      seen.add(match);
      if (valueSurvives(match, afterText, isTranslation)) continue;
      if (instruction.includes(match)) continue;
      lost.push(match);
    }
  }

  return lost.slice(0, 12);
}

const longPassages = (text: string) =>
  text
    .split(/\n+/u)
    .map((line) => normalizeForMatch(line))
    .filter((passage) => passage.length >= 80);

function addedPassages(prev: string, next: string): string[] {
  const before = new Set(longPassages(prev));

  return longPassages(next).filter((passage) => !before.has(passage));
}

function passageCounts(doc: unknown): Map<string, number> {
  const counts = new Map<string, number>();

  for (const text of allText(doc))
    for (const line of text.split(/\n+/u)) {
      const passage = normalizeForMatch(line);

      if (passage.length >= 80) counts.set(passage, (counts.get(passage) ?? 0) + 1);
    }

  return counts;
}

const NEIGHBOUR_OVERLAP_CHARS = 12;

const show = (text: string) => JSON.stringify(text.length > 60 ? `${text.slice(0, 60)}…` : text);

export function neighbourOverlapError(
  label: string,
  before: string,
  after: string,
  neighbours: { prev?: string; next?: string } = {}
): string | null {
  const { prev, next } = neighbours;
  const normalAfter = normalizeForMatch(after);
  const normalBefore = normalizeForMatch(before);

  const overlap = (side: "start" | "end", neighbour: string): number => {
    const normalNeighbour = normalizeForMatch(neighbour);

    if (normalNeighbour.length < 3 || !/[\p{L}\p{N}]/u.test(normalNeighbour)) return 0;
    const whole =
      side === "start"
        ? normalAfter.startsWith(normalNeighbour) && !normalBefore.startsWith(normalNeighbour)
        : normalAfter.endsWith(normalNeighbour) && !normalBefore.endsWith(normalNeighbour);

    if (whole) return normalNeighbour.length;
    const max = Math.min(normalAfter.length, normalNeighbour.length);

    for (let size = max; size >= NEIGHBOUR_OVERLAP_CHARS; size -= 1) {
      const hit =
        side === "start"
          ? normalAfter.slice(0, size) === normalNeighbour.slice(normalNeighbour.length - size)
          : normalAfter.slice(normalAfter.length - size) === normalNeighbour.slice(0, size);

      if (!hit) continue;
      const had =
        side === "start"
          ? normalBefore.slice(0, size) === normalNeighbour.slice(normalNeighbour.length - size)
          : normalBefore.slice(normalBefore.length - size) === normalNeighbour.slice(0, size);

      return had ? 0 : size;
    }

    return 0;
  };

  const fromPrev = prev ? overlap("start", prev) : 0;

  if (fromPrev) {
    return `${label} starts with the text of the segment before it ("${normalizeForMatch(prev!).slice(-40)}") - that text is already there, the page would show it twice. ${label} is ${show(before)}. If you meant to put a space between the two, send exactly ${show(` ${before.replace(/^\s+/u, "")}`)} (this entry with one leading space) and nothing of the neighbour.`;
  }

  const fromNext = next ? overlap("end", next) : 0;

  if (fromNext) {
    return `${label} ends with the text of the segment after it ("${normalizeForMatch(next!).slice(0, 40)}") - that text is already there, the page would show it twice. ${label} is ${show(before)}. If you meant to put a space between the two, send exactly ${show(`${before.replace(/\s+$/u, "")} `)} (this entry with one trailing space) and nothing of the neighbour.`;
  }

  return null;
}

const SHIFTED_EXACT_MIN_CHARS = 12;
const SHIFTED_CONTAIN_MIN_CHARS = 40;

export function shiftedEntryError(
  label: string,
  before: string,
  after: string,
  others: Iterable<{ n: string | number; text: string }>
): string | null {
  const normalAfter = normalizeForMatch(after);
  const normalBefore = normalizeForMatch(before);

  if (normalAfter === normalBefore) return null;

  for (const other of others) {
    const otherText = normalizeForMatch(other.text);

    if (otherText.length < SHIFTED_EXACT_MIN_CHARS || !/[\p{L}\p{N}]/u.test(otherText)) continue;
    if (normalBefore === otherText || normalBefore.includes(otherText)) continue;
    const own = `${label} is "${normalBefore.slice(0, 60)}${normalBefore.length > 60 ? "…" : ""}": send each entry under its own number, with ITS words changed, and leave entries you are not changing out.`;

    if (normalAfter === otherText) {
      return `${label} is exactly the text of entry ${other.n} ("${otherText.slice(0, 60)}${otherText.length > 60 ? "…" : ""}") - the numbers are shifted, and writing it here would put entry ${other.n}'s words in place of ${label.toLowerCase()}'s. ${own}`;
    }

    if (otherText.length >= SHIFTED_CONTAIN_MIN_CHARS && normalAfter.includes(otherText)) {
      return `${label} contains the whole text of entry ${other.n} ("${otherText.slice(0, 60)}…") - that text is already on the page under its own number; writing it here would show it twice and lose ${label.toLowerCase()}'s own words. ${own}`;
    }
  }

  return null;
}

export function duplicatePassage(
  doc: unknown,
  prev: string,
  next: string,
  original?: unknown
): string | null {
  const docText = normalizeForMatch(allText(doc).join("\n"));
  const added = addedPassages(prev, next);

  if (!added.length) return null;

  if (original !== undefined) {
    const mirrored = passageCounts(original);
    const removed = addedPassages(next, prev);

    if (removed.some((passage) => (mirrored.get(passage) ?? 0) > 1)) return null;
  }

  for (const passage of added) if (docText.includes(passage)) return passage;

  return null;
}

export function duplicateAfterInsert(
  doc: unknown,
  fieldBefore: unknown,
  fieldAfter: unknown,
  inserted: string[]
): string | null {
  const whole = passageCounts(doc),
    before = passageCounts(fieldBefore),
    after = passageCounts(fieldAfter);

  for (const text of inserted) {
    for (const line of text.split(/\n+/u)) {
      const passage = normalizeForMatch(line);

      if (passage.length < 80) continue;
      // A formatted paragraph splits into several text nodes and is not found as one string: it
      // still counts once.
      const copies =
        (whole.get(passage) ?? 0) -
        (before.get(passage) ?? 0) +
        Math.max(1, after.get(passage) ?? 0);

      if (copies > 1) return passage;
    }
  }

  return null;
}

const extra = (counts: Map<string, number>) =>
  [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);

export function findNewDuplicates(before: unknown, after: unknown): string[] {
  const beforeCounts = passageCounts(before),
    afterCounts = passageCounts(after);

  if (extra(afterCounts) <= extra(beforeCounts)) return [];
  const out: string[] = [];

  for (const [passage, count] of afterCounts)
    if (count > 1 && (beforeCounts.get(passage) ?? 0) < count) out.push(passage.slice(0, 90));

  return out.slice(0, 5);
}
