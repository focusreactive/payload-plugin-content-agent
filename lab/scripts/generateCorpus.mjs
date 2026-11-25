#!/usr/bin/env node
// Writes the authored texts of the `agency` schema with a model: one brief per document, built by
// code from `lab/content/agency/catalog.json`. The files are frozen in git and the seed reads them,
// so a fresh database never calls a model.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const LAB = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONTENT = path.join(LAB, "content", "agency");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const has = (name) => args.includes(name);

const envFile = opt("--env-file", null);

if (envFile) process.loadEnvFile(path.resolve(envFile));

const keyVar = opt("--api-key-var", "OPENAI_API_KEY");
const modelId = opt("--model", null);
const locale = opt("--translate", null);
const outDir = path.resolve(opt("--out", locale ? path.join(CONTENT, locale) : CONTENT));
const only = opt("--only", null)?.split(",") ?? null;
const effort = opt("--effort", null);
const concurrency = Number(opt("--concurrency", "4"));

const brand = JSON.parse(readFileSync(path.join(CONTENT, "brand.json"), "utf-8"));
const catalog = JSON.parse(readFileSync(path.join(CONTENT, "catalog.json"), "utf-8"));
const { facts } = catalog;

const technology = (slug) => catalog.technologies.find((t) => t.slug === slug);
const author = (slug) => catalog.authors.find((a) => a.slug === slug);

const TARGETS = [
  ...catalog.posts.map((p) => ({
    url: `{{site}}/blog/${p.slug}/`,
    title: p.title,
  })),
  ...catalog.pages.map((p) => ({ url: `{{site}}/${p.slug}/`, title: p.title })),
  ...catalog.cases.map((c) => ({
    url: `{{site}}/case-studies/${c.slug}/`,
    title: c.title,
  })),
  ...catalog.docs.map((d) => ({
    url: `{{site}}/docs/${d.path}/`,
    title: `${facts.starter} docs: ${d.title}`,
  })),
];
const KNOWN_URLS = new Set([
  ...TARGETS.map((t) => t.url),
  "{{site}}/",
  "{{site}}/blog/",
  "{{site}}/contact/",
]);
const OUTSIDE_HOSTS = new Set([
  ...catalog.technologies.map((t) => new URL(t.website).host),
  "clutch.co",
  "g2.com",
]);

// The same targets on every run: a fixed walk through the list, the document itself left out.
const pickTargets = (index, selfUrl, count) => {
  const picked = [];

  for (let step = 0; picked.length < count; step++) {
    const target = TARGETS[(index * 7 + step * 13 + 5) % TARGETS.length];

    if (target.url !== selfUrl && !picked.includes(target)) picked.push(target);
  }

  return picked;
};

const SYSTEM = `You write website content for a fictional headless CMS agency. The texts are test content of a CMS, so they must read like real published pages: concrete, specific, no filler, no placeholder text.

Rules that always hold:
- Never write the name of the agency, its short name or its domain. Write the mark {{brand}} for the name, {{short}} for the short name and {{site}} for the site address (no slash after it unless a path follows). The marks are replaced later.
- Products, frameworks and review sites are real: describe them truthfully and name them with their official spelling. Clients, people, quotes, ratings and project numbers are invented; use only the ones the brief gives.
- Use only the link addresses the brief lists. Do not invent any other address. Write every link as a markdown link whose anchor text is a natural part of the sentence, never the title of the target page.
- Do not use the character | inside a sentence. It is reserved for tables and for the list formats the brief defines.
- Write in English. Output only the document in the exact format the brief defines: no preface, no closing remark, no code fence around the whole document.`;

const agencyFacts = `Facts about the agency (use them where they fit, never contradict them): founded in ${facts.founded}; ${facts.people} people; ${facts.projects} projects delivered; offices in ${facts.offices.join(" and ")}; its open source starter kit for Next.js and a headless CMS is called "${facts.starter}" (current version ${facts.starterVersion}, installed with \`npx ${facts.starterPackage}\`); rated ${facts.clutchRating} of 5 on Clutch from ${facts.clutchReviews} reviews.`;

const linkLines = (targets) => targets.map((t) => `- ${t.url} (the page "${t.title}")`).join("\n");
const outsideLines = (slugs) =>
  slugs
    .map(technology)
    .map((t) => `- ${t.name}: ${t.website}`)
    .join("\n");

const POST_FORMATS = {
  guide: {
    words: "1600 to 2000",
    shape: `Six to eight sections, each under a "## " heading; use "### " headings inside at least two of them. Required parts: one markdown table of at least four rows; two fenced code blocks with a language tag (ts, tsx, js, json or bash); one numbered list of steps; one bullet list; one blockquote with a practical tip.`,
  },
  comparison: {
    words: "1500 to 1900",
    shape: `Sections under "## " headings: a short verdict first, then one section per compared product, then a feature comparison, pricing, "When to choose" for each product, and a conclusion. Required parts: one markdown table that compares the products across at least seven rows; one bullet list of strengths and one of weaknesses for each product; one fenced code block with a language tag.`,
  },
  news: {
    words: "350 to 500",
    shape: `Three or four short sections under "## " headings. Required parts: one blockquote with a statement of the author of the post; one bullet list.`,
  },
  report: {
    words: "1400 to 1800",
    shape: `Sections under "## " headings: key findings, method, four or five findings sections, what it means, about the data. Required parts: two markdown tables with numbers (at least five rows each); one numbered list of the key findings; one bullet list. Invent the numbers and keep them consistent across the text and the tables.`,
  },
};

const listicleShape = (post) => {
  const labels = post.labels ?? ["Best for", "Pricing"];
  const entries = post.entries
    ? `The entries, in this order: ${post.entries.join(", ")}.`
    : `Choose the entries yourself; the count is the number in the title.`;

  return `An intro of two paragraphs, then one section per entry, then a section "## How we chose" with a bullet list, then a section "## Summary" with one markdown table that has a row for each entry. ${entries} Every entry has exactly the same structure: a heading "## <number>. <name>", one paragraph, a paragraph of one line that starts with "**${labels[0]}:**", a paragraph of one line that starts with "**${labels[1]}:**", then one more paragraph. An empty line stands between all of them. Use no other bold text in the document.`;
};

const postBrief = (post, index) => {
  const url = `{{site}}/blog/${post.slug}/`;
  const format = POST_FORMATS[post.format] ?? {
    words: "1800 to 2200",
    shape: listicleShape(post),
  };
  const writer = author(post.author);
  const year = post.year ?? Number(facts.today.slice(0, 4));

  return `Write a blog post.

Title: ${post.title}
Kind: ${post.format}
Author: ${writer.name}, ${writer.role} at {{brand}}
Written in: ${year}. Name no later date.
Length of the body: ${format.words} words.

Structure of the body: ${format.shape}

Links inside the body, each used one time, with a natural anchor text of your own, in different sections:
${linkLines(pickTargets(index, url, 4))}
${post.technologies.length ? `Outside links, each used one time on the first mention of the product:\n${outsideLines(post.technologies)}` : "No outside links."}

${agencyFacts}

Output format, exactly:

excerpt: <one sentence, 140 to 200 characters>
seoTitle: <50 to 60 characters>
seoDescription: <140 to 160 characters>

<the body: it starts with an intro paragraph, not with a heading, and does not repeat the title>

## FAQ

### <question>
<answer of one paragraph>

Write four questions in the FAQ. The FAQ is the last section.`;
};

const docBrief = (doc, index) => {
  const url = `{{site}}/docs/${doc.path}/`;
  const others = catalog.docs.filter((d) => d !== doc);
  const related = [0, 1, 2].map((step) => others[(index * 5 + step * 7 + 2) % others.length]);

  return `Write one page of the documentation of ${facts.starter}, the open source starter kit of the agency: a Next.js App Router project with Payload CMS, TypeScript and a library of page blocks. Invent the details of the starter (file names, options, commands) and keep them plausible and consistent: the CLI is \`npx ${facts.starterPackage}\`, the config file is \`starter.config.ts\`, blocks live in \`src/blocks/\`.

Page title: ${doc.title}
Section of the docs: ${doc.section}
Address of the page: ${url}
Length: 700 to 1100 words.

Structure: an intro paragraph, then four to seven sections under "## " headings. Required parts: three fenced code blocks with a language tag (ts, tsx, json or bash); one markdown table of options or fields with at least four rows; one numbered list of steps; one note written as a blockquote that starts with "**Note:**".

Links to other pages of the docs, each used one time:
${related.map((d) => `- {{site}}/docs/${d.path}/ (the page "${d.title}")`).join("\n")}
Outside links, each used one time:
${outsideLines(["payload", "nextjs"])}

Output format, exactly: the markdown of the page. It starts with the intro paragraph, not with a heading, and does not repeat the title.`;
};

const caseBrief = (study, index) => {
  const url = `{{site}}/case-studies/${study.slug}/`;
  const results = study.results
    .map(([label, value, unit]) => `- ${label}: ${value} ${unit}`)
    .join("\n");

  return `Write a case study of a client project of the agency.

Title: ${study.title}
Client: ${study.client} (invented company; industry ${study.industry}, country code ${study.country})
Year of the launch: ${study.year}
Services delivered: ${study.services.join(", ")}
Technologies: ${study.technologies.map((slug) => technology(slug).name).join(", ")}
Results, the only numbers of outcome you may state, exactly as given:
${results}
Length of the story: 700 to 900 words.

Structure of the story: sections under these "## " headings, in this order: The client, The challenge, The approach, The solution, The results, What comes next. Required parts: one bullet list of the problems in "The challenge"; one numbered list of the phases in "The approach"; one markdown table in "The results" with the three results (columns: Metric, Before, After); one blockquote with a statement of an invented person of the client, with name and role on the line after it.

Links inside the story, each used one time:
${linkLines(pickTargets(index + 3, url, 2))}
Outside links, each used one time on the first mention of the product:
${outsideLines(study.technologies)}

${agencyFacts}

Output format, exactly:

summary: <two sentences, 200 to 300 characters>

<the story: it starts with the heading "## The client">`;
};

const BLOCK_FORMATS = {
  hero: `eyebrow: <two to four words>\nheading: <the main headline>\nsubheading: <one or two sentences>\n- <label of the first button>\n- <label of the second button>`,
  logoCloud: `heading: <a short line above partner logos>`,
  featureGrid: `heading: <text>\nintro: <one sentence>\n- <title> | <two sentences>\n(six items)`,
  richTextSection: `heading: <text>\n\n<markdown of 180 to 260 words: paragraphs, one bullet list, one link from the list of links>`,
  twoColumnText: `heading: <text>\nleft: <one paragraph of 60 to 90 words>\nright: <one paragraph of 60 to 90 words>`,
  imageWithText: `heading: <text>\n\n<markdown of 90 to 140 words>`,
  stats: `heading: <text>\n- <number> | <unit> | <label>\n(four items; the number is a plain number such as 180 or 4.9; the unit is one of: %, x, +, ms, months, pages, or empty when none fits; take the numbers from the facts where a fact fits)`,
  steps: `heading: <text>\nintro: <one sentence>\n- <step title> | <duration, for example "2 weeks"> | <two sentences on the step> | <deliverable>; <deliverable>; <deliverable>\n(five items)`,
  caseStudyCards: `heading: <text>\nintro: <one sentence>`,
  comparisonTable: `heading: <text>\ncolumns: <label> | <label> | <label>\n- <row label> | <cell> | <cell> | <cell>\n(three columns, six rows; a cell holds a few words)`,
  technologyGrid: `heading: <text>`,
  reviewSlider: `heading: <text>`,
  awardsStrip: `heading: <text>`,
  relatedArticles: `heading: <text>`,
  quote: `quote: <two sentences of an invented client>\nperson: <invented full name>\nrole: <role and invented company>`,
  callout: `tone: <note, tip or warning>\ntitle: <text>\ntext: <two sentences>`,
  timeline: `heading: <text>\n- <date as YYYY-MM-DD> | <title> | <one sentence>\n(six items in the order of time; no date after the day of writing)`,
  pricingTable: `heading: <text>\n- <plan name> | <price in euro, digits only> | <period: month, year or project> | <feature>; <feature>; <feature>; <feature>\n(three items)`,
  faqList: `heading: <text>\n- <question> | <answer of two or three sentences>\n(six items)`,
  cta: `heading: <text>\ntext: <one sentence>\n- <label of the first button>\n- <label of the second button>`,
  contactForm: `heading: <text>\nintro: <one sentence>`,
};

const pageBrief = (page, index) => {
  const url = `{{site}}/${page.slug}/`;
  const formats = [...new Set(page.blocks)]
    .map((slug) => `=== ${slug}\n${BLOCK_FORMATS[slug]}`)
    .join("\n\n");

  return `Write the texts of a landing page of the agency. The page is built from blocks; write the text of every block.

Page title: ${page.title}
Subject: ${page.subject}
Day of writing: ${facts.today}

The blocks of the page, in this order: ${page.blocks.join(", ")}.

Links for the rich text blocks, each used at most one time:
${linkLines(pickTargets(index + 11, url, 3))}

${agencyFacts}

Output format, exactly:

seoTitle: <50 to 60 characters>
seoDescription: <140 to 160 characters>

Then one part for each block, in the order above, with one empty line between the parts. A part starts with a line "=== <block name>" and then follows the format of its block. A line in angle brackets or in round brackets below is an instruction: replace it or follow it, never copy it.

${formats}`;
};

const authored = [
  ...catalog.posts.map((post, i) => ({
    id: `posts/${post.slug}`,
    kind: post.format === "news" ? "news" : "post",
    brief: postBrief(post, i),
  })),
  ...catalog.docs.map((doc, i) => ({
    id: `docs/${doc.path.replace("/", "-")}`,
    kind: "doc",
    brief: docBrief(doc, i),
  })),
  ...catalog.cases.map((study, i) => ({
    id: `cases/${study.slug}`,
    kind: "case",
    brief: caseBrief(study, i),
  })),
  ...catalog.pages.map((page, i) => ({
    id: `pages/${page.slug}`,
    kind: "page",
    blocks: page.blocks,
    brief: pageBrief(page, i),
  })),
];

const all = (text, pattern) => [...text.matchAll(pattern)].map((match) => match[1] ?? match[0]);
const count = (text, pattern) => all(text, pattern).length;

// The documents with no text in a second locale, for good: the translation scenarios start from
// them. The seed keeps the body of every fifth post as markdown, in a field with no locales.
const staysUntranslated = (kind, index) =>
  kind === "page" ? index % 4 === 3 : kind === "post" && index % 5 === 2;
const markdownOnly = (kind, index) => kind === "post" && index % 5 === 4;

const TRANSLATED_HEAD = {
  post: ["title", "excerpt", "seoTitle", "seoDescription"],
  page: ["title", "seoTitle", "seoDescription"],
  doc: ["title"],
  case: ["title", "summary"],
};
// Cells of a landing row that hold a number, a date or an option of a select field.
const FIXED_CELLS = { stats: [0, 1], pricingTable: [1, 2], timeline: [0] };

const translateSystem = (language) =>
  `You translate the website content of a headless CMS agency from English into ${language}. The texts are test content of a CMS, so the translation must read like a page that a native writer wrote for a business reader: natural, neutral, international ${language}, no word-for-word phrasing.

Rules that always hold:
- Keep the format exactly. A line "key: value" keeps its key in English and gets a translated value. A line "=== name" stays as it is. Keep the same count and order of headings, paragraphs, list items, blockquotes, table rows and table cells, and every empty line. A list row with cells keeps the same count of cells and the separator " | ".
- Never change: the marks {{brand}}, {{short}} and {{site}}; a link address (translate only the anchor text); a fenced code block and inline code, with every character; the names of products, companies and people; numbers, dates and prices.
- These values stay in English, exactly as given: the value of a line "tone:"; the first two cells of a row under "=== stats"; the second and third cell of a row under "=== pricingTable"; the first cell of a row under "=== timeline".
- Output only the translated document: no preface, no closing remark, no code fence around the whole document.`;

const sourceOf = (kind, id, title, withBody) => {
  const text = readFileSync(path.join(CONTENT, `${id}.md`), "utf-8");
  const body = kind === "post" ? text.split(/^## FAQ\s*$/mu)[0].trim() : text.trim();
  const head = all(body, /^(?:excerpt|seoTitle|seoDescription): .*$/gmu).join("\n");

  return `title: ${title}\n${kind === "doc" ? "\n" : ""}${withBody ? body : head}`;
};

const translations = [
  ...catalog.posts.map((post) => ({
    kind: "post",
    id: `posts/${post.slug}`,
    title: post.title,
  })),
  ...catalog.docs.map((doc) => ({
    kind: "doc",
    id: `docs/${doc.path.replace("/", "-")}`,
    title: doc.title,
  })),
  ...catalog.cases.map((study) => ({
    kind: "case",
    id: `cases/${study.slug}`,
    title: study.title,
  })),
  ...catalog.pages.map((page) => ({
    kind: "page",
    id: `pages/${page.slug}`,
    title: page.title,
  })),
]
  .map((entry, n, list) => ({
    ...entry,
    i: n - list.findIndex((e) => e.kind === entry.kind),
  }))
  .filter(({ kind, i }) => !staysUntranslated(kind, i))
  .map(({ kind, id, i, title }) => {
    const source = sourceOf(kind, id, title, !markdownOnly(kind, i));

    return {
      id,
      kind,
      source,
      brief: `Translate this document.\n\n${source}`,
    };
  });

const documents = locale ? translations : authored;
const system = locale
  ? translateSystem(new Intl.DisplayNames(["en"], { type: "language" }).of(locale))
  : SYSTEM;

const HEAD_KEYS = {
  post: ["excerpt", "seoTitle", "seoDescription"],
  news: ["excerpt", "seoTitle", "seoDescription"],
  case: ["summary"],
  page: ["seoTitle", "seoDescription"],
  doc: [],
};
const hasTable = (text) => /^\|.+\|\s*\n\|[\s:|-]+\|\s*$/mu.test(text);
const hasFence = (text) => /^```\w+\s*$/mu.test(text);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// A model may put spaces around an address that starts with a mark: "]( {{site}}/x/ )".
const tidyLinks = (text) =>
  text
    .replace(/\]\(\s+/gu, "](")
    .replace(/(\]\([^)\s]+)\s+\)/gu, "$1)")
    .replace(/https?:\/\/\{\{site\}\}/gu, "{{site}}");

const requiredLinks = (brief) => [
  ...[...brief.matchAll(/^- (\{\{site\}\}\S+) \(the page /gmu)].map((match) => match[1]),
  ...[...brief.matchAll(/^- [^:\n]+: (https:\/\/\S+)$/gmu)].map((match) => match[1]),
];

const brandProblems = (text) =>
  [brand.name, brand.short, brand.domain]
    .filter((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, "iu").test(text))
    .map((word) => `the text holds "${word}": write the mark instead`);

const FENCE = /^[ \t]*```\w*[ \t]*\n[\s\S]*?\n[ \t]*```[ \t]*$/gmu;
const prose = (value) => value.replace(FENCE, "");
const longLines = (value) =>
  prose(value)
    .split("\n")
    .filter((line) => line.trim().length > 60);

// What a translation must share with its source, each as a name and a list read from the text.
const SHARED = [
  ["the link addresses", (text) => all(text, /\]\(([^)\s]+)\)/gu)],
  ["the fenced code blocks", (text) => all(text, FENCE)],
  ["the marks", (text) => all(text, /\{\{\w+\}\}/gu).sort()],
  ["the headings", (text) => all(text, /^(#{1,6}) /gmu)],
  ["the table rows", (text) => all(text, /^\|.*$/gmu).map((row) => count(row, /\|/gu))],
  [
    "the list items",
    (text) => all(text, /^[ \t]*(?:[-*]|\d+\.) /gmu).map((item) => /\d/u.test(item)),
  ],
  ["the blockquote lines", (text) => all(text, /^>/gmu)],
  ["the block parts", (text) => all(text, /^=== (\w+)\s*$/gmu)],
  ["the keys of the lines", (text) => all(text, /^(\w+): /gmu)],
];

const partsOf = (text) => {
  const pieces = text.split(/^=== (\w+)\s*$/mu).slice(1);

  return pieces.flatMap((slug, i) =>
    i % 2
      ? []
      : [
          {
            slug,
            tone: /^tone: (.*)$/mu.exec(pieces[i + 1])?.[1].trim(),
            rows: all(pieces[i + 1], /^- (.*\|.*)$/gmu).map((row) =>
              row.split("|").map((cell) => cell.trim())
            ),
          },
        ]
  );
};

// A translation keeps everything the seed parses and everything that is not prose.
const translationProblems = (document, text) => {
  const problems = brandProblems(text);

  for (const key of TRANSLATED_HEAD[document.kind]) {
    if (!new RegExp(`^${key}: \\S`, "mu").test(text))
      problems.push(`the line "${key}:" is missing`);
  }

  for (const [name, read] of SHARED) {
    const [expected, found] = [document.source, text].map((value) =>
      JSON.stringify(read(name === "the fenced code blocks" ? value : prose(value)))
    );

    if (expected !== found) problems.push(`${name} differ from the source: keep them exactly`);
  }

  const parts = partsOf(text);

  for (const [n, part] of partsOf(document.source).entries()) {
    const translated = parts[n];

    if (!translated || translated.slug !== part.slug) continue;
    if (translated.tone !== part.tone)
      problems.push(`part ${part.slug}: the value of "tone:" must stay "${part.tone}"`);
    if (
      translated.rows.map((row) => row.length).join(",") !==
      part.rows.map((row) => row.length).join(",")
    )
      problems.push(
        `part ${part.slug}: the rows must keep their count and the count of their cells`
      );

    for (const [r, row] of part.rows.entries()) {
      for (const cell of FIXED_CELLS[part.slug] ?? []) {
        if (translated.rows[r] && translated.rows[r][cell] !== row[cell])
          problems.push(
            `part ${part.slug}, row ${r + 1}: the cell "${row[cell]}" must stay as it is`
          );
      }
    }
  }

  const sourceLines = new Set(longLines(document.source));
  const same = longLines(text).filter((line) => sourceLines.has(line)).length;

  if (same > longLines(text).length / 10) problems.push(`${same} long lines are not translated`);

  return problems;
};

// Every check a later step relies on: the marks, the link targets, the parts the seed parses.
const authoredProblems = (document, text) => {
  const problems = brandProblems(text);

  for (const key of HEAD_KEYS[document.kind]) {
    if (!new RegExp(`^${key}: \\S`, "mu").test(text))
      problems.push(`the line "${key}:" is missing`);
  }

  for (const [match] of text.matchAll(/\{\{site\}\}[^\s)"'<>\]`*]*/gu)) {
    const url = match.replace(/[.,;:!?]+$/u, "");

    if (url !== "{{site}}" && !KNOWN_URLS.has(url))
      problems.push(`the address ${url} is not in the brief`);
  }

  for (const [, url] of text.matchAll(/\]\((https?:\/\/[^\s)]+)\)/gu)) {
    const host = URL.canParse(url) ? new URL(url).host.replace(/^www\./u, "") : null;
    const known = [...OUTSIDE_HOSTS].some((h) => h.replace(/^www\./u, "") === host);

    if (!known) problems.push(`the outside address ${url} is not in the brief`);
  }

  if (document.kind !== "page") {
    for (const url of requiredLinks(document.brief)) {
      if (!text.includes(`](${url}`)) problems.push(`the link to ${url} is missing`);
    }
  }

  if (document.kind === "post" || document.kind === "news") {
    if (!/^## FAQ\s*$/mu.test(text)) problems.push(`the section "## FAQ" is missing`);
    if ((text.split(/^## FAQ\s*$/mu)[1]?.match(/^### /gmu) ?? []).length !== 4)
      problems.push("the FAQ must hold four questions");
  }

  if (document.kind === "post" || document.kind === "doc" || document.kind === "case") {
    if (!hasTable(text)) problems.push("a markdown table is missing");
  }

  if (document.kind === "doc" && !hasFence(text)) problems.push("a fenced code block is missing");

  if (document.kind === "page") {
    const found = [...text.matchAll(/^=== (\w+)\s*$/gmu)].map((m) => m[1]);

    for (const [, key] of text.matchAll(/^(\w+):[ \t]*$/gmu))
      problems.push(`the line "${key}:" is empty`);

    if (found.join(",") !== document.blocks.join(","))
      problems.push(
        `the block parts must be, in this order: ${document.blocks.join(", ")}; found: ${found.join(", ")}`
      );
  }

  return problems;
};

const problemsOf = (document, text) =>
  document.source ? translationProblems(document, text) : authoredProblems(document, text);

// The short texts of the seed: `strings.json` lists them, the seed writes the list. One request
// translates a batch; a string that fails a check goes into one more request.
const stringProblems = (source, text) => {
  const problems = brandProblems(text ?? "");

  const same = (name, pattern) => {
    if (all(source, pattern).sort().join("\n") !== all(text, pattern).sort().join("\n"))
      problems.push(`${name} differ from the source`);
  };

  if (typeof text !== "string" || !text.trim()) return ["the translation is missing"];
  same("the tags [[...]]", /\[\[\/?\d+\/?\]\]/gu);
  same("the marks", /\{\{\w+\}\}/gu);
  same("the addresses", /https?:\/\/[^\s)\]]+/gu);
  same("the line breaks", /\n/gu);

  return problems;
};

if (has("--strings")) {
  if (!locale) {
    console.error("[corpus] --strings needs --translate <locale>");
    process.exit(1);
  }

  const list = JSON.parse(readFileSync(path.join(CONTENT, "strings.json"), "utf-8"));
  const file = path.join(outDir, "strings.json");
  const stored = existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : {};
  const done = has("--force") ? {} : stored;
  const faultyOf = (map) => list.filter((key) => stringProblems(key, map[key]).length);

  if (has("--check")) {
    const faulty = faultyOf(stored);
    const stale = Object.keys(stored).filter((key) => !list.includes(key));

    for (const key of faulty.slice(0, 20))
      console.log(`${JSON.stringify(key)}\n  - ${stringProblems(key, stored[key]).join("\n  - ")}`);
    console.log(
      `[corpus] ${list.length} strings checked, ${faulty.length} with problems, ${stale.length} not in the list`
    );
    process.exit(faulty.length || stale.length ? 1 : 0);
  }

  if (!modelId || !process.env[keyVar]) {
    console.error("[corpus] --strings needs --model, --env-file and --api-key-var (or --check)");
    process.exit(1);
  }

  const model = createOpenAI({ apiKey: process.env[keyVar] })(modelId);
  const total = { inputTokens: 0, outputTokens: 0 };

  const translateBatch = async (keys, notes) => {
    const numbered = Object.fromEntries(keys.map((key, n) => [String(n + 1), key]));
    const result = await generateText({
      model,
      instructions: `${system}

You get a JSON object of numbered texts of one website: titles, labels, sentences, short paragraphs. Translate every value on its own. A value may hold tags: "[[1]]text[[/1]]" marks a link or a format around the text, "[[2/]]" stands for a piece that is not text. Keep every tag with its number, translate the text between a pair of tags, and put the tags where they belong in the translated sentence. Keep markdown signs and line breaks. A value that is only a name stays as it is. Output only a JSON object with the same keys and the translated values.`,
      prompt: `${JSON.stringify(numbered, null, 1)}${notes ? `\n\nAn earlier answer had these faults; avoid them:\n${notes}` : ""}`,
      maxOutputTokens: 16000,
      ...(effort ? { providerOptions: { openai: { reasoningEffort: effort } } } : {}),
    });

    total.inputTokens += result.usage.inputTokens ?? 0;
    total.outputTokens += result.usage.outputTokens ?? 0;

    const answer = JSON.parse(result.text.replace(/^```\w*\n|\n```$/gu, ""));

    for (const [n, key] of keys.entries())
      if (typeof answer[n + 1] === "string") done[key] = answer[n + 1];
  };

  const run = async (keys, withNotes) => {
    const batches = [];

    for (let at = 0; at < keys.length; at += 40) batches.push(keys.slice(at, at + 40));

    const next = async () => {
      for (let batch = batches.shift(); batch; batch = batches.shift()) {
        const notes = withNotes
          ? batch
              .map((key, n) => `- text ${n + 1}: ${stringProblems(key, done[key]).join("; ")}`)
              .join("\n")
          : "";

        try {
          await translateBatch(batch, notes);
        } catch (error) {
          console.error(`[corpus] a batch of ${batch.length} strings failed: ${error.message}`);
        }

        console.log(`[corpus] strings: ${batches.length} batches left`);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, next));
  };

  await run(faultyOf(done), false);
  for (let round = 0; round < 2 && faultyOf(done).length; round++) await run(faultyOf(done), true);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify(Object.fromEntries(list.filter((key) => key in done).map((key) => [key, done[key]])), null, 2)}\n`
  );

  const usageFile = path.join(outDir, "usage.json");
  const usage = existsSync(usageFile) ? JSON.parse(readFileSync(usageFile, "utf-8")) : {};
  const earlier = usage.strings ?? { inputTokens: 0, outputTokens: 0 };

  usage.strings = {
    model: modelId,
    inputTokens: earlier.inputTokens + total.inputTokens,
    outputTokens: earlier.outputTokens + total.outputTokens,
  };
  writeFileSync(usageFile, `${JSON.stringify(usage, null, 2)}\n`);
  console.log(
    `[corpus] strings: ${list.length} in the list, ${faultyOf(done).length} with problems; ${total.inputTokens} input tokens, ${total.outputTokens} output tokens`
  );
  process.exit(faultyOf(done).length ? 1 : 0);
}

if (has("--list")) {
  for (const document of documents) console.log(document.id);
  process.exit(0);
}

const selected = only ? documents.filter((d) => only.includes(d.id)) : documents;
const unknown = only?.filter((id) => !documents.some((d) => d.id === id)) ?? [];

if (unknown.length) {
  console.error(`[corpus] unknown document: ${unknown.join(", ")}. Run with --list for the ids.`);
  process.exit(1);
}

if (has("--briefs")) {
  for (const document of selected) console.log(`##### ${document.id}\n\n${document.brief}\n`);
  process.exit(0);
}

if (has("--check")) {
  let faulty = 0;

  for (const document of selected) {
    const file = path.join(outDir, `${document.id}.md`);
    const problems = existsSync(file)
      ? problemsOf(document, readFileSync(file, "utf-8"))
      : ["the file is missing"];

    if (problems.length) {
      faulty++;
      console.log(`${document.id}\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    }
  }

  console.log(`[corpus] ${selected.length} checked, ${faulty} with problems`);
  process.exit(faulty ? 1 : 0);
}

if (!modelId) {
  console.error("[corpus] --model <id> is required (or --list, --briefs, --check)");
  process.exit(1);
}

if (!process.env[keyVar]) {
  console.error(`[corpus] ${keyVar} is not set: pass --env-file and --api-key-var`);
  process.exit(1);
}

const model = createOpenAI({ apiKey: process.env[keyVar] })(modelId);
const fileOf = (document) => path.join(outDir, `${document.id}.md`);
const pending = selected.filter((d) => has("--force") || !existsSync(fileOf(d)));

console.log(
  `[corpus] ${pending.length} to write, ${selected.length - pending.length} already there, model ${modelId}, out ${outDir}`
);

const usageFile = path.join(outDir, "usage.json");
const usage = existsSync(usageFile) ? JSON.parse(readFileSync(usageFile, "utf-8")) : {};

const write = async (document) => {
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let text = "";
  let problems = [];
  const started = Date.now();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? document.brief
        : `${document.brief}\n\nYour earlier answer had these faults. Write the whole document again without them:\n${problems.map((p) => `- ${p}`).join("\n")}`;
    const result = await generateText({
      model,
      instructions: system,
      prompt,
      maxOutputTokens: 16000,
      ...(effort ? { providerOptions: { openai: { reasoningEffort: effort } } } : {}),
    });

    inputTokens += result.usage.inputTokens ?? 0;
    outputTokens += result.usage.outputTokens ?? 0;
    reasoningTokens += result.usage.outputTokenDetails?.reasoningTokens ?? 0;
    text = tidyLinks(result.text.trim());
    problems = problemsOf(document, text);
    if (!problems.length) break;
  }

  mkdirSync(path.dirname(fileOf(document)), { recursive: true });
  writeFileSync(fileOf(document), `${text}\n`);
  usage[document.id] = {
    model: modelId,
    inputTokens,
    outputTokens,
    reasoningTokens,
    words: text.split(/\s+/u).length,
    seconds: Math.round((Date.now() - started) / 1000),
    ...(problems.length ? { problems } : {}),
  };
  console.log(
    `[corpus] ${document.id}: ${usage[document.id].words} words, ${inputTokens} in, ${outputTokens} out, ${usage[document.id].seconds}s${problems.length ? `, ${problems.length} PROBLEMS` : ""}`
  );
};

const queue = [...pending];
const failed = [];

const worker = async () => {
  for (let document = queue.shift(); document; document = queue.shift()) {
    try {
      await write(document);
    } catch (error) {
      failed.push(document.id);
      console.error(`[corpus] ${document.id} failed: ${error.message}`);
    }
  }
};

await Promise.all(Array.from({ length: concurrency }, worker));

mkdirSync(outDir, { recursive: true });
writeFileSync(usageFile, `${JSON.stringify(usage, null, 2)}\n`);

const written = pending
  .filter((d) => usage[d.id] && !failed.includes(d.id))
  .map((d) => usage[d.id]);
const sum = (key) => written.reduce((total, row) => total + row[key], 0);

console.log(
  `[corpus] done: ${written.length} written, ${failed.length} failed, ${written.filter((row) => row.problems).length} with problems; ${sum("inputTokens")} input tokens, ${sum("outputTokens")} output tokens (${sum("reasoningTokens")} of them reasoning)`
);
if (failed.length) process.exit(1);
