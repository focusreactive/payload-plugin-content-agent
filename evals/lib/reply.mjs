// Readers for the reply of the agent. A question scenario has no other proof than the reply.

const spelled = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[–—]/gu, "-");

// One spelling for a text: letter case, quote marks, dashes, emphasis marks and white space.
export const fold = (text) => spelled(text).replace(/[*`]/gu, "").replace(/\s+/gu, " ").trim();

// The same spelling with the emphasis marks and the lines kept: they show how a name stands.
const marked = (text) =>
  spelled(text)
    .replace(/[^\S\n]+/gu, " ")
    .trim();

export const holds = (text, phrase) => fold(text).includes(fold(phrase));

// A word counts only as a whole, alone or with a plural "s": "graph" is not in "photograph".
export const holdsWord = (text, word) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}s?(?![\\p{L}\\p{N}])`,
    "u"
  ).test(fold(text));

// The sentences of a reply: a line break or the end mark of a sentence ends one.
export const sentences = (text) =>
  spelled(text)
    .split(/\n+|(?<=[.!?])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);

const DENIAL =
  /\b(no|not|0|zero|none|nothing|never|cannot|can't|does(?: not|n't)|did(?: not|n't)|could(?: not|n't)|is(?: not|n't)|are(?: not|n't)|was(?: not|n't)|were(?: not|n't))\b/iu;
const CHANGE_TOLD = /\b(replaced|changed|updated|edited|rewrote|rewritten|now reads|now says)\b/iu;

// A reply that says nothing changed: one sentence denies, and no sentence without a denial names
// the new text or tells of a change. "No other text was changed" next to a claim does not count.
export function deniesChange(text, newText) {
  const parts = sentences(text);
  const claims = parts.some(
    (part) => !DENIAL.test(part) && (holds(part, newText) || CHANGE_TOLD.test(part))
  );

  return parts.some((part) => DENIAL.test(part)) && !claims;
}

const REQUEST =
  /^(?:please|give|send|share|tell|provide|let me know)\b|\b(?:please|send me|give me|tell me|let me know)\b/u;

// A reply that hands a value back to the person: a sentence asks a question or makes a request.
// "Please share the URL." asks as much as "Which URL?" does.
export function asksPerson(text) {
  return sentences(text).some(
    (part) => /\?[^\p{L}\p{N}]*$/u.test(part) || REQUEST.test(part.replace(/^[^\p{L}]+/u, ""))
  );
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const EDGE = "[\\p{L}\\p{N}-]";

const ONE_WORD = /^[\p{L}\p{N}]+$/u;
const OPENS = /(?:(?:^|\n)[^\p{L}\p{N}\n]*|[*`"'[]|\| ?)$/u;
const CLOSES = /^(?:[^\p{L}\p{N}\n]*(?:\n|$)|[*`"'\]]| ?\|)/u;

// The keys of the candidates that a text names. A candidate is `{ key, names }`.
// A name counts only as a whole: "guide" is not named by "guides" or by "guide-2".
// The longest name takes its place first, so a title that is the start of a longer title
// is named only where it stands alone.
// Two options make the reading narrow, for the names a reply must not hold:
// `addresses: false`: a name that stands next to "/" is a part of an address, not a name.
// `setOff: true`: a name of one word counts only where the reply sets it off: with emphasis,
// code or quote marks, in a table cell, alone on a line or, with addresses, next to "/".
// A word like "about" in a sentence then names no document.
export function named(text, candidates, { addresses = true, setOff = false } = {}) {
  const keysOf = new Map();

  for (const { key, names } of candidates)
    for (const name of names.map(fold).filter(Boolean))
      keysOf.set(name, [...(keysOf.get(name) ?? []), key]);

  const narrow = setOff || !addresses;
  const found = new Set();
  let rest = narrow ? marked(text) : fold(text);

  for (const name of [...keysOf.keys()].sort((a, b) => b.length - a.length)) {
    const whole = new RegExp(`(?<!${EDGE})${escaped(name)}(?!${EDGE})`, "gu");
    const counts = [...rest.matchAll(whole)].some(({ index }) => {
      if (!narrow) return true;
      const left = rest.slice(0, index);
      const right = rest.slice(index + name.length);
      const glued = left.endsWith("/") || right.startsWith("/");

      if (glued) return addresses;
      if (!setOff || !ONE_WORD.test(name)) return true;

      return OPENS.test(left) && CLOSES.test(right);
    });

    if (counts) for (const key of keysOf.get(name)) found.add(key);
    rest = rest.replace(whole, "\u0000");
  }

  return found;
}
