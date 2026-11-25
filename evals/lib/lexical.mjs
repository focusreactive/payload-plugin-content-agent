const isLink = (n) => n?.type === "link" || n?.type === "autolink";
const linkText = (n) => (n.children ?? []).map((c) => c?.text ?? "").join("");

// Segments in document order: ['text', text] or ['link', url, text].
export function flat(value) {
  const out = [];

  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;

    if (n.type === "text") out.push(["text", n.text ?? ""]);
    else if (isLink(n)) {
      out.push(["link", n.fields?.url ?? null, linkText(n)]);

      return;
    }

    Object.values(n).forEach(walk);
  };

  walk(value);

  return out;
}

export const joined = (value) =>
  flat(value)
    .map((s) => (s[0] === "text" ? s[1] : s[2]))
    .join("");

export const links = (value) =>
  flat(value)
    .filter((s) => s[0] === "link")
    .map((s) => [s[1], s[2]]);

export const paragraphs = (value) => (value?.root?.children ?? []).map((n) => joined(n));

const TEXT_BLOCKS = new Set(["paragraph", "heading", "listitem", "quote"]);

// The text of every paragraph, heading, list item and quote, in document order.
export function textBlocks(value) {
  const out = [];

  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    if (TEXT_BLOCKS.has(n.type)) return out.push(joined(n));
    Object.values(n).forEach(walk);
  };

  walk(value);

  return out;
}

// Inline boundaries that join two words with no space, for example "a" + link "style guide".
// Each one as the two texts that meet.
export function gluedPlaces(value) {
  const out = [];

  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;

    if (TEXT_BLOCKS.has(n.type)) {
      const texts = (n.children ?? [])
        .map((c) =>
          c?.type === "text"
            ? (c.text ?? "")
            : isLink(c)
              ? linkText(c)
              : c?.type === "linebreak"
                ? "\n"
                : null
        )
        .filter(Boolean);

      for (let i = 1; i < texts.length; i++)
        if (/\w$/u.test(texts[i - 1]) && /^\w/u.test(texts[i])) out.push([texts[i - 1], texts[i]]);

      return;
    }

    Object.values(n).forEach(walk);
  };

  walk(value);

  return out;
}

export const gluedBoundaries = (value) => gluedPlaces(value).length;

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;

  return JSON.stringify(v) ?? "null";
}

export const same = (a, b) => canonical(a) === canonical(b);

// The places where two lists differ, as [index, expected, actual]. The first `limit` of them.
export function differences(expected, actual, limit = 10) {
  const out = [];

  for (let i = 0; i < Math.max(expected.length, actual.length) && out.length < limit; i++)
    if (!same(expected[i], actual[i])) out.push([i, expected[i] ?? null, actual[i] ?? null]);

  return out;
}
