import type { Created } from "../../../seedHelpers";
import { brand, catalog, read, translated } from "./corpus";
import {
  AGENDA,
  AWARDS,
  CHANGES,
  COMPANIES,
  COUNTRY_FACTS,
  EVENT_TOPICS,
  FAQS,
  FIRST_NAMES,
  FORM_MESSAGES,
  GLOSSARY,
  LAST_NAMES,
  PARTNERS,
  REVIEW_CLOSERS,
  REVIEW_OPENERS,
  ROLES,
  SPAM_MESSAGES,
  TAGS,
  TECH_FACTS,
} from "./data";
import { para, ref } from "./layout";
import type { Id } from "./layout";
import type { AddMedia } from "./media";

// `second` holds the fields of the second locale that come from a file; `false` leaves the second
// locale of the document empty. Every other localized field is translated by the dictionary.
export type Create = (
  collection: string,
  data: object,
  second?: object | false
) => Promise<Created>;
const DAY = 86_400_000;

export const day = (base: string, offset: number, time = "09:00") =>
  new Date(Date.parse(`${base}T${time}:00.000Z`) + offset * DAY).toISOString();
export const slugOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

const person = (a: number, b: number) =>
  `${FIRST_NAMES[a % FIRST_NAMES.length]} ${LAST_NAMES[b % LAST_NAMES.length]}`;

export async function seedTaxonomy(create: Create, addMedia: AddMedia) {
  const authors = new Map<string, Id>();
  const categories = new Map<string, Id>();
  const technologies = new Map<string, Id>();
  const logos = new Map<string, Id>();
  const tags: Id[] = [];
  const partners: Id[] = [];
  const awards: Id[] = [];
  const glossary: Id[] = [];
  const faqs: Id[] = [];

  for (const [i, author] of catalog.authors.entries()) {
    const photo = await addMedia(`author-${author.slug}`, "photo", `Portrait of ${author.name}`);
    const { id } = await create("authors", {
      ...author,
      bio: `${author.name} is ${author.role} at ${brand.name} and has worked at the agency since ${catalog.facts.founded + i}.`,
      email: `${author.slug.replace("-", ".")}@${brand.domain}`,
      photo,
      socials: [
        { network: "linkedin", url: `https://www.linkedin.com/in/${author.slug}` },
        ...(i % 2 ? [] : [{ network: "github", url: `https://github.com/${author.slug}` }]),
      ],
    });

    authors.set(author.slug, id);
  }

  const parents: Record<string, string> = { migration: "cms", performance: "engineering" };

  for (const category of catalog.categories) {
    const { id } = await create("categories", {
      ...category,
      description: `Articles of ${brand.name} about ${category.name.toLowerCase()}.`,
      ...(parents[category.slug] ? { parent: categories.get(parents[category.slug]) } : {}),
    });

    categories.set(category.slug, id);
  }

  for (const name of TAGS) tags.push((await create("tags", { name, slug: slugOf(name) })).id);

  for (const technology of catalog.technologies) {
    const logo = await addMedia(`logo-${technology.slug}`, "logo", `Logo of ${technology.name}`);
    const { id } = await create("technologies", {
      ...technology,
      ...TECH_FACTS[technology.slug],
      logo,
    });

    logos.set(technology.slug, logo);
    technologies.set(technology.slug, id);
  }

  for (const [i, slug] of PARTNERS.entries()) {
    const technology = catalog.technologies.find((t) => t.slug === slug);
    const { id } = await create("partners", {
      name: technology?.name,
      tier: ["official", "certified", "community"][i % 3],
      since: day("2017-03-01", i * 211),
      url: technology?.website,
      technology: technologies.get(slug),
      logo: logos.get(slug),
    });

    partners.push(id);
  }

  for (const [i, [title, issuer, year]] of AWARDS.entries()) {
    const badge = await addMedia(`award-${i + 1}`, "badge", `${issuer} badge: ${title} ${year}`);
    const url =
      issuer === "Clutch"
        ? "https://clutch.co"
        : issuer === "G2"
          ? "https://www.g2.com"
          : `${brand.site}/about/`;

    awards.push((await create("awards", { title, issuer, year, url, badge })).id);
  }

  for (const [i, [term, definition, technology]] of GLOSSARY.entries()) {
    const { id } = await create("glossary", {
      term,
      definition,
      ...(technology ? { technology: technologies.get(technology) } : {}),
      seeAlso: [glossary[i - 1], glossary[i - 5]].filter((item) => item !== undefined),
    });

    glossary.push(id);
  }

  for (const [topic, question, answer] of FAQS) {
    faqs.push((await create("faqs", { question, answer: para(answer), topic })).id);
  }

  return { authors, categories, technologies, logos, tags, partners, awards, glossary, faqs };
}

const VERSIONS = [
  "1.0.0",
  "1.0.1",
  "1.1.0",
  "1.1.1",
  "1.2.0",
  "1.3.0",
  "1.3.1",
  "1.4.0",
  "1.4.1",
  "2.0.0",
  "2.0.1",
  "2.0.2",
  "2.1.0",
  "2.2.0",
  "2.2.1",
  "2.3.0",
  "2.4.0",
  "3.0.0",
  "3.0.1",
  "3.0.2",
  "3.1.0",
  "3.1.1",
  "3.1.2",
  "3.2.0",
];

export async function seedDocs(create: Create, update: (id: Id, data: object) => Promise<unknown>) {
  const docs = new Map<string, Id>();

  for (const [i, version] of VERSIONS.entries()) {
    const [, minor, patch] = version.split(".").map(Number);
    const kind = patch ? "patch" : minor ? "minor" : "major";

    await create("changelog", {
      version,
      releasedOn: day("2021-04-26", i * 80),
      kind,
      breaking: kind === "major" && i > 0,
      notes: `${CHANGES[i % CHANGES.length]}. ${CHANGES[(i * 5 + 3) % CHANGES.length]}.`,
    });
  }

  for (const [i, doc] of catalog.docs.entries()) {
    const file = doc.path.replace("/", "-");
    const second = translated(`docs/${file}`, ["title"]);
    const { id } = await create(
      "docs",
      {
        ...doc,
        order: catalog.docs.filter((d, n) => d.section === doc.section && n < i).length + 1,
        versions: doc.path.includes("upgrading") ? ["2.x", "3.x"] : ["3.x"],
        body: read(`docs/${file}`),
      },
      second ? { title: second.head.title, body: second.body } : false
    );

    docs.set(doc.path, id);
  }

  const ids = [...docs.values()];

  for (const [i, id] of ids.entries()) {
    await update(id, {
      ...(i > 0 ? { previous: ids[i - 1] } : {}),
      ...(i < ids.length - 1 ? { next: ids[i + 1] } : {}),
    });
  }

  return docs;
}

export const REVIEW_COUNT = 60;

export async function seedReviews(
  create: Create,
  addMedia: AddMedia,
  cases: { id: Id; client: string }[]
) {
  const reviews: Id[] = [];

  for (let i = 0; i < REVIEW_COUNT; i++) {
    const name = person(i, i * 7);
    const study = cases[i];
    const photo =
      i % 3 === 0 ? await addMedia(`review-${i + 1}`, "photo", `Portrait of ${name}`) : undefined;
    const { id } = await create("reviews", {
      person: name,
      role: ROLES[i % ROLES.length],
      company: study?.client ?? COMPANIES[i % COMPANIES.length],
      quote: `${REVIEW_OPENERS[i % REVIEW_OPENERS.length]} ${REVIEW_CLOSERS[(i * 3) % REVIEW_CLOSERS.length]}`,
      rating: i % 6 === 5 ? 4 : 5,
      source: ["clutch", "g2", "linkedin", "direct"][i % 4],
      receivedOn: day("2023-02-06", i * 19),
      ...(study ? { caseStudy: study.id } : {}),
      ...(photo ? { photo } : {}),
    });

    reviews.push(id);
  }

  return reviews;
}

export const EVENT_COUNT = 30;

export async function seedEvents(create: Create, authors: Id[]) {
  for (let i = 0; i < EVENT_COUNT; i++) {
    const topic = EVENT_TOPICS[i % EVENT_TOPICS.length];
    const country = COUNTRY_FACTS[(i * 5) % COUNTRY_FACTS.length];
    const format = ["online", "in-person", "hybrid"][i % 3];
    const startsAt = day("2023-03-14", i * 38, "17:00");
    const year = startsAt.slice(0, 4);
    const title =
      format === "online" ? `${topic} online, ${year}` : `${topic}, ${country.city} ${year}`;
    const slug = `${slugOf(title)}-${i + 1}`;

    await create("events", {
      title,
      slug,
      startsAt,
      endsAt: day("2023-03-14", i * 38, "19:00"),
      format,
      ...(format === "online"
        ? {}
        : {
            venue: {
              name: `${country.city} Content Hub`,
              city: country.city,
              country: country.code,
              geo: { lat: country.lat, lng: country.lng },
            },
          }),
      agenda: ["18:00", "18:30", "19:15"].map((time, k) => ({
        time,
        title: AGENDA[(i + k * 2) % AGENDA.length],
        speaker: authors[(i + k) % authors.length],
      })),
      registrationUrl: `${brand.site}/events/${slug}/`,
      description: para(
        `${topic}: an evening of ${brand.name} for editors and developers, with a case from a recent project and time for questions.`
      ),
    });
  }
}

export const FORM_COUNT = 500;
const FORMS = ["contact", "audit", "newsletter", "estimate"];

// One form submission by its number. The graders use the same formula.
export function formSubmission(i: number, pageSlugs: string[]) {
  const first = FIRST_NAMES[(i * 3) % FIRST_NAMES.length];
  const last = LAST_NAMES[(i * 5) % LAST_NAMES.length];
  const company = COMPANIES[(i * 11) % COMPANIES.length];
  const spam = i % 9 === 4;
  const minutes = i * 17 * 60 + ((i * 37) % 600);

  return {
    form: FORMS[(i * 7 + (i >> 3)) % FORMS.length],
    submittedAt: new Date(Date.parse("2025-06-02T08:00:00.000Z") + minutes * 60_000).toISOString(),
    name: `${first} ${last}`,
    email: `${first}.${last}@${slugOf(company)}.example`.toLowerCase(),
    company,
    country: COUNTRY_FACTS[(i * 7) % COUNTRY_FACTS.length].code,
    message: spam
      ? SPAM_MESSAGES[i % SPAM_MESSAGES.length]
      : FORM_MESSAGES[(i * 3) % FORM_MESSAGES.length],
    spam,
    sourcePage: `/${pageSlugs[(i * 13) % pageSlugs.length]}/`,
  };
}

export async function seedForms(create: Create, pageSlugs: string[]) {
  for (let i = 0; i < FORM_COUNT; i++)
    await create("form-submissions", formSubmission(i, pageSlugs));
}

const toInternal = (collection: string, id: Id) => ({
  type: "internal",
  reference: ref(collection, id),
});
const toCustom = (url: string) => ({ type: "custom", url });

export async function seedRedirects(
  create: Create,
  posts: { id: Id; slug: string; publishedOn: string }[],
  pages: { id: Id; slug: string }[],
  cases: { id: Id; slug: string }[]
) {
  const rows: { from: string; to: object }[] = [
    ...posts.map((post) => ({ from: `/articles/${post.slug}`, to: toInternal("posts", post.id) })),
    ...posts.map((post) => ({
      from: `/blog/${post.publishedOn.slice(0, 4)}/${post.slug}`,
      to: toCustom(`${brand.site}/blog/${post.slug}/`),
    })),
    ...pages
      .slice(0, 80)
      .map((page) => ({ from: `/services/${page.slug}`, to: toInternal("pages", page.id) })),
    ...cases.map((study) => ({
      from: `/work/${study.slug}`,
      to: toInternal("case-studies", study.id),
    })),
    ...cases.map((study) => ({
      from: `/portfolio/${study.slug}`,
      to: toCustom(`${brand.site}/case-studies/${study.slug}/`),
    })),
    ...Array.from({ length: 16 }, (_, i) => ({
      from: `/?p=${1000 + i * 7}`,
      to: toCustom(`${brand.site}/blog/`),
    })),
  ];

  for (const [i, row] of rows.entries()) {
    await create("redirects", {
      ...row,
      permanent: i % 10 !== 0,
      ...(i % 25 === 0 ? { note: "Kept from the old site" } : {}),
    });
  }

  return rows.length;
}
