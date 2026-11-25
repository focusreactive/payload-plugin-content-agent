import { p, richText } from "../../../seedHelpers";
import { brand, stableId } from "./corpus";
import type { Part } from "./corpus";
import { TECH_FACTS } from "./data";
import type { Labels } from "./data";
import type { ToLexical } from "./markdown";

export type Id = number | string;

export interface Refs {
  contact: Id;
  pages: Map<string, Id>;
  posts: {
    id: Id;
    slug: string;
    title: string;
    excerpt: string;
    cover: Id;
    technologies: string[];
  }[];
  cases: { id: Id; slug: string; country: string; industry: string; technologies: string[] }[];
  reviews: Id[];
  partners: Id[];
  awards: Id[];
  faqs: Id[];
  technologies: Map<string, Id>;
  sections: Map<string, Id>;
  backgrounds: Id[];
  pictures: Id[];
  toLexical: ToLexical;
  labels: Labels;
}

export const ref = (relationTo: string, value: Id) => ({ relationTo, value });
export const internal = (relationTo: string, value: Id, label: string) => ({
  type: "internal",
  reference: ref(relationTo, value),
  label,
});
export const custom = (url: string, label: string) => ({ type: "custom", url, label });
export const para = (text: string) => richText(p(text));

// A fixed walk through a list: the same picks on every run.
export const cycle = <T>(list: T[], start: number, count: number): T[] =>
  Array.from(
    { length: Math.min(count, list.length) },
    (_, i) => list[(start + i) % list.length] as T
  );

const ICONS = ["speed", "shield", "layers", "globe", "code"];
const UNITS = new Set(["%", "x", "+", "ms", "months", "pages"]);
const PERIODS = new Set(["month", "year", "project"]);
const TONES = new Set(["note", "tip", "warning"]);

const oneOf = (allowed: Set<string>, value: string, what: string) => {
  if (!allowed.has(value)) throw new Error(`[agency seed] ${what} "${value}" is not an option`);

  return value;
};

const number = (value: string, what: string) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed))
    throw new TypeError(`[agency seed] ${what} "${value}" is not a number`);

  return parsed;
};

// Every array row and block gets an id from its place, so a second seed gives the same rows.
export function withIds<T>(value: T, key: string): T {
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (item && typeof item === "object") {
        item.id ??= stableId(`${key}/${i}`);
        withIds(item, `${key}/${i}`);
      }
    });
  } else if (value && typeof value === "object" && !("root" in value)) {
    for (const [name, child] of Object.entries(value)) withIds(child, `${key}/${name}`);
  }

  return value;
}

export const statsBlock = (heading: string, items: [number, string, string][]) => ({
  blockType: "stats",
  heading,
  items: items.map(([value, unit, label]) => ({ value, ...(unit ? { unit } : {}), label })),
});

export const tableBlock = (heading: string, columns: string[], rows: string[][]) => ({
  blockType: "comparisonTable",
  heading,
  columns: columns.map((label) => ({ label })),
  rows: rows.map(([label, ...cells]) => ({ label, cells: cells.map((value) => ({ value })) })),
});

export const articlesBlock = (heading: string, posts: Refs["posts"]) => ({
  blockType: "relatedArticles",
  heading,
  articles: posts.map((post) => ({
    post: post.id,
    title: post.title,
    description: post.excerpt,
    cover: post.cover,
  })),
});

// One block of a landing from its part of the file. `n` moves the picks of the references.
export function blockFrom(part: Part, refs: Refs, n: number, key: string): Record<string, any> {
  const { keys, rows } = part;
  const base = { blockType: part.slug, ...(keys.heading ? { heading: keys.heading } : {}) };

  switch (part.slug) {
    case "hero":
      return {
        ...base,
        eyebrow: keys.eyebrow,
        subheading: keys.subheading,
        background: refs.backgrounds[n % refs.backgrounds.length],
        actions: rows.map(([label], i) => ({
          link:
            i === 0 ? internal("pages", refs.contact, label) : custom(`${brand.site}/blog/`, label),
        })),
      };
    case "logoCloud":
      return { ...base, partners: cycle(refs.partners, n, 6) };
    case "featureGrid":
      return {
        ...base,
        intro: keys.intro,
        items: rows.map(([title, text], i) => ({ icon: ICONS[i % ICONS.length], title, text })),
      };
    case "richTextSection":
      return { ...base, body: refs.toLexical(part.body, key) };
    case "twoColumnText":
      return { ...base, left: para(keys.left), right: para(keys.right) };
    case "imageWithText":
      return {
        ...base,
        body: refs.toLexical(part.body, key),
        image: refs.pictures[n % refs.pictures.length],
        imageSide: n % 2 ? "left" : "right",
      };
    case "stats":
      return statsBlock(
        keys.heading,
        rows.map(([value, unit, label]) => [
          number(value, "the stat"),
          UNITS.has(unit) ? unit : "",
          label,
        ])
      );
    case "steps":
      return {
        ...base,
        intro: keys.intro,
        steps: rows.map(([title, duration, body, deliverables = ""]) => ({
          title,
          duration,
          body: para(body),
          deliverables: deliverables
            .split(";")
            .map((item) => ({ item: item.trim() }))
            .filter((row) => row.item),
        })),
      };
    case "caseStudyCards":
      return {
        ...base,
        intro: keys.intro,
        highlighted: refs.cases[n % refs.cases.length].id,
        cases: cycle(refs.cases, n, 3).map((study) => study.id),
      };
    case "comparisonTable":
      return tableBlock(
        keys.heading,
        keys.columns.split("|").map((label) => label.trim()),
        rows
      );
    case "technologyGrid":
      return {
        ...base,
        items: cycle([...refs.technologies], n * 3, 6).map(([slug, id]) => ({
          technology: id,
          summary: TECH_FACTS[slug].summary,
        })),
      };
    case "reviewSlider":
      return { ...base, reviews: cycle(refs.reviews, n * 5, 4) };
    case "awardsStrip":
      return { ...base, awards: cycle(refs.awards, n, 4) };
    case "relatedArticles":
      return articlesBlock(keys.heading, cycle(refs.posts, n * 7, 3));
    case "quote":
      return { ...base, quote: keys.quote, person: keys.person, role: keys.role };
    case "callout":
      return {
        ...base,
        tone: oneOf(TONES, keys.tone, "the tone"),
        title: keys.title,
        text: keys.text,
      };
    case "timeline":
      return {
        ...base,
        entries: rows.map(([date, title, text]) => ({
          date: `${date}T12:00:00.000Z`,
          title,
          text,
        })),
      };
    case "pricingTable":
      return {
        ...base,
        plans: rows.map(([name, price, period, features = ""], i) => ({
          name,
          price: number(price, "the price"),
          period: oneOf(PERIODS, period, "the period"),
          highlighted: i === 1,
          features: features.split(";").map((text) => ({ text: text.trim(), included: true })),
          link: internal("pages", refs.contact, refs.labels.talk),
        })),
      };
    case "faqList":
      return {
        ...base,
        library: cycle(refs.faqs, n * 2, 2),
        items: rows.map(([question, ...answer]) => ({
          question,
          answer: para(answer.join(" | ")),
        })),
      };
    case "cta":
      return {
        ...base,
        text: keys.text,
        primary: internal("pages", refs.contact, rows[0]?.[0] ?? refs.labels.contact),
        secondary: custom(`${brand.site}/blog/`, rows[1]?.[0] ?? refs.labels.blog),
      };
    case "contactForm":
      return { ...base, intro: keys.intro, form: n % 3 === 0 ? "estimate" : "contact" };
    default:
      throw new Error(`[agency seed] no builder for the block "${part.slug}"`);
  }
}
