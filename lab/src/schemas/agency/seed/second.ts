// The second locale of every text that has no file of its own: a dictionary from the English
// string to its translation, frozen in git. The seed calls no model.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Field } from "payload";
import { richTextBlocks } from "../blocks";
import { brand, DIR, fill, SECOND_LOCALE } from "./corpus";
import { textNode } from "./markdown";

type Data = Record<string, any>;
type Node = Record<string, any>;
type Translator = (text: string) => string;

const LIST = path.join(DIR, "strings.json");
const TRANSLATED = path.join(DIR, SECOND_LOCALE, "strings.json");
const PROSE = /\p{L}{2}/u;
const ADDRESS = /^(?:(?:https?:\/\/|mailto:|\/)\S*|\S+@\S+)$/u;
const CODE = 16;

const withMarks = (text: string) =>
  text
    .replaceAll(brand.site, "{{site}}")
    .replaceAll(brand.name, "{{brand}}")
    .replaceAll(brand.short, "{{short}}");

export function dictionary() {
  const known: Record<string, string> = existsSync(TRANSLATED)
    ? JSON.parse(readFileSync(TRANSLATED, "utf-8"))
    : {};
  const used = new Set<string>();

  return {
    // A text with no words, or an address, stays as it is.
    t(text: string) {
      const core = text.trim();

      if (!PROSE.test(core) || ADDRESS.test(core)) return text;

      const key = withMarks(core);

      used.add(key);

      return text.replace(core, () => fill(known[key] ?? key));
    },

    // `strings.json` lists every string the seed asked for. `LAB_WRITE_STRINGS=1` writes the list;
    // without it a string with no translation stops the seed.
    finish() {
      const list = [...used].sort();
      const missing = list.filter((key) => !(key in known));

      if (process.env.LAB_WRITE_STRINGS) {
        writeFileSync(LIST, `${JSON.stringify(list, null, 2)}\n`);
        console.log(`[lab] agency: ${list.length} strings, ${missing.length} with no translation`);
      } else if (missing.length)
        throw new Error(
          `[agency seed] ${missing.length} strings have no translation, the first is "${missing[0]}". Start again with --fresh and LAB_WRITE_STRINGS=1, then run: node lab/scripts/generateCorpus.mjs --translate ${SECOND_LOCALE} --strings`
        );
    },
  };
}

const INLINE = new Set(["text", "link", "autolink", "linebreak", "tab", "inlineBlock"]);
const TAG = /\[\[(\d+)\]\]([\s\S]*?)\[\[\/\1\]\]|\[\[(\d+)\/\]\]/gu;
const plain = (node: Node): string =>
  node.type === "text" ? node.text : (node.children ?? []).map(plain).join("");

// One run of inline nodes is one string: a node with a format or a link is a numbered tag around
// its text, a node with no text of its own is a tag that stands alone.
function translatedRun(children: Node[], t: Translator): Node[] {
  const source = children
    .map((child, n) => {
      if (child.type === "text" && !child.format) return child.text;
      if (child.type === "text" && !(child.format & CODE)) return `[[${n}]]${child.text}[[/${n}]]`;
      if (child.type === "link" || child.type === "autolink")
        return `[[${n}]]${plain(child)}[[/${n}]]`;

      return `[[${n}/]]`;
    })
    .join("");
  const translated = t(source);

  if (translated === source) return children;

  const base = children.find((child) => child.type === "text" && !child.format) ?? textNode("");
  const text = (value: string, like: Node = base) => ({ ...like, text: value });
  const nodes: Node[] = [];
  let at = 0;

  for (const match of translated.matchAll(TAG)) {
    const child = children[Number(match[1] ?? match[3])];

    if (match.index > at) nodes.push(text(translated.slice(at, match.index)));
    if (match[3] !== undefined) nodes.push(child);
    else if (child.type === "text") nodes.push(text(match[2], child));
    else
      nodes.push({
        ...child,
        children: [
          text(
            match[2],
            child.children.find((node: Node) => node.type === "text")
          ),
        ],
      });
    at = match.index + match[0].length;
  }

  if (at < translated.length) nodes.push(text(translated.slice(at)));

  return nodes;
}

const blocks = new Map(richTextBlocks.map((block) => [block.slug, block.fields]));

function translatedRichText(
  state: Node,
  t: Translator,
  second: (fields: Field[], data: Data) => Data
) {
  const copy = structuredClone(state);

  const visit = (node: Node) => {
    const fields = node.fields && blocks.get(node.fields.blockType);

    if (fields) node.fields = { ...node.fields, ...second(fields, node.fields) };

    const children: Node[] | undefined = node.children;

    if (!Array.isArray(children) || !children.length) return;
    if (node.type !== "root" && children.every((child) => INLINE.has(child.type))) {
      for (const child of children) if (child.type === "inlineBlock") visit(child);
      node.children = translatedRun(children, t);
    } else children.forEach(visit);
  };

  visit(copy.root);

  return copy;
}

const hasLocalized = (fields: Field[]): boolean =>
  fields.some((field) => {
    if ("localized" in field && field.localized) return true;
    if (field.type === "tabs") return field.tabs.some((tab) => hasLocalized(tab.fields));
    if (field.type === "blocks") return field.blocks.some((block) => hasLocalized(block.fields));

    return "fields" in field && hasLocalized(field.fields);
  });

const isGroup = (value: unknown): value is Data =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !("root" in (value as Data));

// The fields of `over` win; a group takes the fields of both.
export function merged(under: Data, over: Data): Data {
  const out: Data = { ...under };

  for (const [name, value] of Object.entries(over)) {
    out[name] = isGroup(out[name]) && isGroup(value) ? merged(out[name], value) : value;
  }

  return out;
}

// The data of a document for the second locale. Outside a localized field it holds only what the
// second locale needs: the localized fields, and every row of an array that has one, with the id of
// the row. Inside a localized field (`whole`) it holds every field, every text translated, and no
// row id: the rows of a second locale are rows of their own.
export function secondOf(fields: Field[], data: Data, t: Translator, whole = false): Data {
  const out: Data = {};
  const group = (inner: Field[], value: Data, localized: boolean) =>
    secondOf(inner, value, t, whole || localized);

  // A row of an array with no locales of its own: every value as it is, the localized ones translated.
  const keptRow = (inner: Field[], row: Data): Data => {
    const { id: _id, ...rest } = row;

    return merged(rest, secondOf(inner, row, t));
  };

  for (const field of fields) {
    if (field.type === "tabs") {
      for (const tab of field.tabs) {
        if (!("name" in tab && tab.name)) Object.assign(out, secondOf(tab.fields, data, t, whole));
        else if (data[tab.name]) {
          const value = group(tab.fields, data[tab.name], Boolean(tab.localized));

          if (whole || Object.keys(value).length) out[tab.name] = value;
        }
      }

      continue;
    }

    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(out, secondOf(field.fields, data, t, whole));
      continue;
    }

    if (!("name" in field) || field.name === "id") continue;

    const value = data[field.name];
    const localized = whole || Boolean("localized" in field && field.localized);

    if (value === undefined || value === null) continue;

    if (field.type === "text" || field.type === "textarea") {
      if (localized && typeof value === "string") out[field.name] = t(value);
      else if (whole) out[field.name] = value;
    } else if (field.type === "richText") {
      if (localized)
        out[field.name] = translatedRichText(value, t, (blockFields, blockData) =>
          secondOf(blockFields, blockData, t, true)
        );
    } else if (field.type === "group") {
      const inner = group(field.fields, value, localized);

      if (whole || Object.keys(inner).length) out[field.name] = inner;
    } else if (field.type === "array" || field.type === "blocks") {
      const fieldsOf = (row: Data) =>
        field.type === "array"
          ? field.fields
          : (field.blocks.find((block) => block.slug === row.blockType)?.fields ?? []);
      const kind = (row: Data) => (field.type === "blocks" ? { blockType: row.blockType } : {});

      if (localized)
        out[field.name] = value.map((row: Data) => ({
          ...kind(row),
          ...secondOf(fieldsOf(row), row, t, true),
        }));
      else if (value.some((row: Data) => hasLocalized(fieldsOf(row))))
        out[field.name] = value.map((row: Data) => ({
          ...keptRow(fieldsOf(row), row),
          ...kind(row),
          id: row.id,
        }));
    } else if (whole) out[field.name] = value;
  }

  return out;
}

// `data` with no field that `over` gives: a file translates it, the dictionary must not.
export function without(data: Data, over: Data): Data {
  const out: Data = { ...data };

  for (const [name, value] of Object.entries(over)) {
    if (isGroup(out[name]) && isGroup(value)) out[name] = without(out[name], value);
    else Reflect.deleteProperty(out, name);
  }

  return out;
}
