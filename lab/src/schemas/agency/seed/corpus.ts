import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const DIR = path.resolve(process.cwd(), "content", "agency");
const json = (name: string) => JSON.parse(readFileSync(path.join(DIR, name), "utf-8"));

export interface CatalogPost {
  slug: string;
  title: string;
  format: string;
  category: string;
  author: string;
  technologies: string[];
  year?: number;
}
export interface CatalogDoc {
  path: string;
  title: string;
  section: string;
}
export interface CatalogCase {
  slug: string;
  client: string;
  title: string;
  industry: string;
  country: string;
  year: number;
  services: string[];
  technologies: string[];
  results: [string, number, string][];
}
export interface CatalogPage {
  slug: string;
  title: string;
  family: string;
  subject: string;
  blocks: string[];
}
interface Catalog {
  facts: {
    founded: number;
    people: number;
    projects: number;
    offices: string[];
    starter: string;
    starterVersion: string;
    starterPackage: string;
    clutchRating: number;
    clutchReviews: number;
    today: string;
  };
  authors: { slug: string; name: string; role: string }[];
  categories: { slug: string; name: string }[];
  technologies: { slug: string; name: string; kind: string; website: string }[];
  posts: CatalogPost[];
  docs: CatalogDoc[];
  cases: CatalogCase[];
  pages: CatalogPage[];
}

export const brand: { name: string; short: string; domain: string; site: string } =
  json("brand.json");
export const catalog: Catalog = json("catalog.json");

export const fill = (text: string) =>
  text
    .replaceAll("{{brand}}", brand.name)
    .replaceAll("{{short}}", brand.short)
    .replaceAll("{{site}}", brand.site);

export const read = (id: string) => fill(readFileSync(path.join(DIR, `${id}.md`), "utf-8"));

export const SECOND_LOCALE = "es";

// The same id on every run: a row or a block is named by its place, never by a random value.
export const stableId = (key: string) => createHash("sha1").update(key).digest("hex").slice(0, 24);

// Head lines `key: value` at the top of a file, then the body.
export function splitHead(text: string, keys: string[]) {
  const head: Record<string, string> = {};
  let body = text;

  for (const key of keys) {
    const match = new RegExp(`^${key}: (.*)$`, "mu").exec(body);

    if (!match) throw new Error(`[agency seed] the head line "${key}:" is missing`);
    head[key] = match[1].trim();
    body = body.replace(match[0], "");
  }

  return { head, body: body.trim() };
}

// The text of a document in the second locale, with its head lines. Some documents have none.
export function translated(id: string, keys: string[]) {
  const file = path.join(DIR, SECOND_LOCALE, `${id}.md`);

  return existsSync(file) ? splitHead(fill(readFileSync(file, "utf-8")), keys) : null;
}

// The last section `## FAQ` with `### ` questions.
export function splitFaq(body: string) {
  const [text, faq = ""] = body.split(/^## FAQ\s*$/mu);
  const items = faq
    .split(/^### /mu)
    .slice(1)
    .map((part) => {
      const [question, ...answer] = part.trim().split("\n");

      return {
        question: question.trim(),
        answer: answer.join(" ").replace(/\s+/gu, " ").trim(),
      };
    });

  return { text: text.trim(), faq: items };
}

export interface Part {
  slug: string;
  keys: Record<string, string>;
  rows: string[][];
  body: string;
}

const BODY_BLOCKS = new Set(["richTextSection", "imageWithText"]);

// A landing: parts `=== <block slug>` with `key: value` lines, `- a | b | c` rows or a markdown body.
export function splitParts(text: string): Part[] {
  const pieces = text.split(/^=== (\w+)\s*$/mu).slice(1);
  const parts: Part[] = [];

  for (let i = 0; i < pieces.length; i += 2) {
    const slug = pieces[i];
    const lines = pieces[i + 1].trim().split("\n");
    const part: Part = { slug, keys: {}, rows: [], body: "" };
    const end = BODY_BLOCKS.has(slug) ? lines.indexOf("") : lines.length;
    const headLines = end === -1 ? lines : lines.slice(0, end);

    for (const line of headLines) {
      const key = /^(\w+): (.*)$/u.exec(line);

      if (key) part.keys[key[1]] = key[2].trim();
      else if (line.startsWith("- "))
        part.rows.push(
          line
            .slice(2)
            .split("|")
            .map((cell) => cell.trim())
        );
    }

    if (end !== -1) part.body = lines.slice(end).join("\n").trim();
    parts.push(part);
  }

  return parts;
}

export const words = (text: string) => text.split(/\s+/u).filter(Boolean).length;
