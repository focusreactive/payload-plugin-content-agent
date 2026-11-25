import { brand, catalog } from "./corpus";
import type { Part } from "./corpus";
import { COUNTRY_FACTS, FAQS, INDUSTRY_NAMES, TECH_FACTS } from "./data";
import type { Country } from "./data";
import {
  articlesBlock,
  blockFrom,
  custom,
  cycle,
  internal,
  para,
  statsBlock,
  tableBlock,
} from "./layout";
import type { Refs } from "./layout";

const { facts } = catalog;
const GENERIC = "headless-cms-development";

export interface Derived {
  slug: string;
  title: string;
  family: string;
  // The master whose blocks the page copies, and the master it links to as its parent.
  source: string;
  parent: string;
  eyebrow: string;
  subheading: string;
  paragraphs: string[];
  tableColumns: string[];
  tableRows: string[][];
  stats: [number, string, string][];
  question: [string, string];
  faqTopic: string;
  tabs: boolean;
  siblings: string[];
  country?: string;
  technologies: string[];
  industry?: string;
}

const technology = (slug: string) => {
  const entry = catalog.technologies.find((t) => t.slug === slug);

  if (!entry) throw new Error(`[agency seed] unknown technology "${slug}"`);

  return { ...entry, ...TECH_FACTS[slug] };
};

const lower = (text: string) => text[0].toLowerCase() + text.slice(1);
const upper = (text: string) => text[0].toUpperCase() + text.slice(1);
const yesNo = (value: boolean) => (value ? "Yes" : "No");
const countrySlug = (country: Country) =>
  country.name.replace(/^the /u, "").toLowerCase().replaceAll(" ", "-");
const since = (slug: string) => 2016 + (slug.length % 7);

const techRows = (slugs: string[]) => {
  const list = slugs.map(technology);

  return [
    ["Vendor", ...list.map((t) => t.vendor)],
    ["Kind", ...list.map((t) => t.kind)],
    ["License", ...list.map((t) => t.license)],
    ["Self-hosted", ...list.map((t) => yesNo(t.selfHosted))],
    ["Pricing model", ...list.map((t) => t.pricing.model)],
    ["Free tier", ...list.map((t) => yesNo(t.pricing.freeTier))],
  ];
};

const REGION_SERVICES: [string, string, string][] = [
  ["headless-cms-agency", "Headless CMS agency", GENERIC],
  ["payload-cms-development", "Payload CMS development", "payload-cms-development"],
  ["nextjs-development", "Next.js development", "nextjs-development"],
  [
    "wordpress-to-headless-migration",
    "WordPress to headless migration",
    "wordpress-to-headless-migration",
  ],
  ["cms-audit", "CMS and performance audit", "cms-audit"],
  ["headless-ecommerce", "Headless ecommerce", "headless-ecommerce"],
];

function regionPages(): Derived[] {
  const pages: Derived[] = [];

  for (const [base, service, source] of REGION_SERVICES) {
    const siblings: string[] = [];

    for (const country of COUNTRY_FACTS) {
      const slug = `${base}-${countrySlug(country)}`;

      if (catalog.pages.some((page) => page.slug === slug)) {
        siblings.push(slug);
        continue;
      }

      const english =
        country.language === "English"
          ? "English"
          : `English and, where the project needs it, in ${country.language}`;

      pages.push({
        slug,
        title: `${service} in ${country.name}`,
        family: "region",
        source,
        parent: source === GENERIC ? "headless-cms-agency-germany" : source,
        eyebrow: `${service} for ${country.adjective} teams`,
        subheading: `${brand.name} delivers ${lower(service)} for companies in ${country.name} from the ${country.office} office.`,
        paragraphs: [
          `${brand.name} works with ${country.adjective} companies from the ${country.office} office. ${country.clients} of our ${facts.projects} projects were delivered for clients in ${country.name}.`,
          `Teams in ${country.city} get the same people from the first workshop to the launch. We work in ${english}, and we invoice in ${country.currency}.`,
        ],
        tableColumns: [upper(country.name.replace(/^the /u, ""))],
        tableRows: [
          ["Office", country.office],
          ["Main city", country.city],
          ["Languages", country.language],
          ["Currency", country.currency],
          ["Projects delivered", String(country.clients)],
        ],
        stats: [
          [country.clients, "+", `projects in ${country.name}`],
          [facts.people, "", "people on the team"],
          [facts.clutchRating, "", "of 5 on Clutch"],
        ],
        question: [
          `Do you work with companies in ${country.name}?`,
          `Yes. Our ${country.office} office has delivered ${country.clients} projects for ${country.adjective} companies.`,
        ],
        faqTopic: "process",
        tabs: false,
        siblings: [...siblings],
        country: country.code,
        technologies: [],
      });
      siblings.push(slug);
    }
  }

  return pages;
}

function technologyPage(
  slug: string,
  title: string,
  tech: string,
  parent: string,
  lead: string
): Derived {
  const t = technology(tech);

  return {
    slug,
    title,
    family: "technology",
    source: GENERIC,
    parent,
    eyebrow: `${t.name} experts`,
    subheading: lead,
    paragraphs: [
      `${t.name} is ${lower(t.summary)} ${brand.name} has built with it since ${since(tech)}.`,
      `Our developers know where [${t.name}](${t.website}) is strong and where a project needs another tool. We say so before the contract, not after it.`,
    ],
    tableColumns: [t.name],
    tableRows: techRows([tech]),
    stats: [
      [Number(facts.today.slice(0, 4)) - since(tech), "+", `years with ${t.name}`],
      [8 + ((tech.length * 5) % 23), "+", `${t.name} projects`],
      [facts.clutchRating, "", "of 5 on Clutch"],
    ],
    question: [
      `Is ${t.name} open source?`,
      t.license === "open-source"
        ? `Yes. ${t.name} is open source, and ${t.vendor} maintains it.`
        : `No. ${t.name} is a product of ${t.vendor} with a proprietary license.`,
    ],
    faqTopic: "pricing",
    tabs: slug.startsWith("hire-"),
    siblings: [],
    technologies: [tech],
  };
}

function technologyPages(): Derived[] {
  const kinds: [string[], string][] = [
    [["sanity", "storyblok", "contentful", "strapi", "directus"], "payload-cms-development"],
    [["astro", "nuxt", "remix", "sveltekit", "gatsby"], "nextjs-development"],
  ];
  const pages: Derived[] = [];

  for (const [slugs, parent] of kinds) {
    for (const slug of slugs) {
      const { name } = technology(slug);

      pages.push(
        technologyPage(
          `${slug}-development`,
          `${name} development`,
          slug,
          parent,
          `We plan, build and maintain websites on ${name}, from the content model to the launch.`
        )
      );
    }
  }

  for (const { slug, name } of catalog.technologies) {
    pages.push(
      technologyPage(
        `hire-${slug}-developers`,
        `Hire ${name} developers`,
        slug,
        GENERIC,
        `Add ${name} developers of ${brand.name} to your team for a project or for a fixed number of days each month.`
      )
    );
  }

  for (const slug of ["payload", "sanity", "storyblok", "contentful", "strapi", "directus"]) {
    const { name } = technology(slug);

    pages.push({
      ...technologyPage(
        `${slug}-audit`,
        `${name} audit`,
        slug,
        "cms-audit",
        `A two-week review of your ${name} setup: the content model, the editor experience and the speed of the site.`
      ),
      family: "service",
      source: "cms-audit",
    });
  }

  for (const slug of ["shopify", "medusa", "commercetools"]) {
    const { name } = technology(slug);

    pages.push({
      ...technologyPage(
        `headless-${slug}-storefront`,
        `Headless ${name} storefront`,
        slug,
        "headless-ecommerce",
        `A fast storefront on ${name} with a CMS for the content that sells the products.`
      ),
      family: "solution",
      source: "headless-ecommerce",
    });
  }

  return pages;
}

function migrationPages(): Derived[] {
  const pages: Derived[] = [];

  for (const from of ["wordpress", "contentful", "strapi", "sanity", "storyblok", "directus"]) {
    for (const to of ["payload", "sanity", "storyblok", "contentful"]) {
      if (from === to) continue;

      const a = technology(from);
      const b = technology(to);

      pages.push({
        slug: `${from}-to-${to}-migration`,
        title: `${a.name} to ${b.name} migration`,
        family: "migration",
        source: GENERIC,
        parent: "wordpress-to-headless-migration",
        eyebrow: `From ${a.name} to ${b.name}`,
        subheading: `We move your content, your addresses and your editors from ${a.name} to ${b.name} with no loss of search traffic.`,
        paragraphs: [
          `A move from ${a.name} to ${b.name} changes where the content lives and how editors work. ${a.name} is ${lower(a.summary)} ${b.name} is ${lower(b.summary)}`,
          `We map every content type of [${a.name}](${a.website}) to a content type of [${b.name}](${b.website}), write the migration scripts and test the redirects before the launch.`,
        ],
        tableColumns: [a.name, b.name],
        tableRows: techRows([from, to]),
        stats: [
          [3 + ((from.length + to.length) % 9), "+", "migrations of this kind"],
          [2 + ((from.length * to.length) % 4), "months", "typical duration"],
          [100, "%", "of addresses redirected"],
        ],
        question: [
          `How long does a migration from ${a.name} to ${b.name} take?`,
          `Most projects of this kind take ${2 + ((from.length * to.length) % 4)} months, with the content model and the redirects planned in the first weeks.`,
        ],
        faqTopic: "migration",
        tabs: true,
        siblings: pages.filter((page) => page.slug.startsWith(`${from}-to-`)).map((p) => p.slug),
        technologies: [from, to],
      });
    }
  }

  return pages;
}

function industryPages(): Derived[] {
  return Object.entries(INDUSTRY_NAMES).map(([industry, name], i) => ({
    slug: `headless-cms-for-${industry}`,
    title: `Headless CMS for ${name}`,
    family: "solution",
    source: GENERIC,
    parent: GENERIC,
    eyebrow: `For ${name}`,
    subheading: `Content platforms for ${name}, built by a team that has worked in the field since ${facts.founded + 1 + i}.`,
    paragraphs: [
      `We build headless CMS platforms for ${name}. ${12 + i * 5} of our ${facts.projects} projects were for clients in this field.`,
      `The content model comes first. We learn how your editors work, then choose the CMS and the framework that fit that work.`,
    ],
    tableColumns: [upper(name)],
    tableRows: [
      ["Projects delivered", String(12 + i * 5)],
      ["Typical duration", `${3 + (i % 3)} months`],
      ["Typical team", `${4 + (i % 3)} people`],
      ["First project", String(facts.founded + 1 + i)],
    ],
    stats: [
      [12 + i * 5, "+", `projects for ${name}`],
      [3 + (i % 3), "months", "typical duration"],
      [facts.clutchRating, "", "of 5 on Clutch"],
    ],
    question: [
      `Do you have experience with ${name}?`,
      `Yes. We have delivered ${12 + i * 5} projects for ${name} since ${facts.founded + 1 + i}.`,
    ],
    faqTopic: "process",
    tabs: false,
    siblings: [],
    industry,
    technologies: [],
  }));
}

export const derivedPages = (): Derived[] => [
  ...regionPages(),
  ...technologyPages(),
  ...migrationPages(),
  ...industryPages(),
];

const matching = (page: Derived, refs: Refs, n: number) => {
  const own = refs.cases.filter(
    (study) =>
      study.country === page.country ||
      study.industry === page.industry ||
      study.technologies.some((slug) => page.technologies.includes(slug))
  );

  return [...own, ...cycle(refs.cases, n, 3).filter((study) => !own.includes(study))].slice(0, 3);
};

// The layout of a derived landing: copied blocks of a master around its own facts, with blocks
// nested three levels deep (section > columns > block) and sections shared between pages.
export function derivedLayout(
  page: Derived,
  parts: Map<string, Part[]>,
  refs: Refs,
  n: number
): Record<string, any>[] {
  const find = (slug: string) =>
    parts.get(page.source)?.find((part) => part.slug === slug) ??
    parts.get(GENERIC)?.find((part) => part.slug === slug);

  const copy = (slug: string) => {
    const part = find(slug);

    if (!part) throw new Error(`[agency seed] no "${slug}" block in a master`);

    return blockFrom(part, refs, n, `${page.slug}/${slug}`);
  };

  const posts = [
    ...new Set([
      ...refs.posts.filter((post) => post.technologies.some((t) => page.technologies.includes(t))),
      ...cycle(refs.posts, n * 3, 3),
    ]),
  ];
  const [guide] = posts;
  const parent = refs.pages.get(page.parent);

  if (!parent) throw new Error(`[agency seed] the parent "${page.parent}" does not exist yet`);

  const markdown = [
    ...page.paragraphs,
    `Read more about [our approach](${brand.site}/${page.parent}/), or start with [${guide.title}](${brand.site}/blog/${guide.slug}/).`,
  ].join("\n\n");
  const cases = matching(page, refs, n);
  const library = FAQS.map(([topic], i) => ({ topic, id: refs.faqs[i] }))
    .filter((faq) => faq.topic === page.faqTopic)
    .map((faq) => faq.id);
  const faq = {
    ...copy("faqList"),
    library: cycle(library, n, 3),
    items: [
      { question: page.question[0], answer: para(page.question[1]) },
      ...copy("faqList").items.slice(0, 3),
    ],
  };
  const process = page.tabs
    ? {
        blockType: "tabsBlock",
        heading: "How we work",
        tabs: [
          { label: "Process", content: [copy("steps")] },
          { label: "Pricing", content: [copy("pricingTable")] },
          { label: "Questions", content: [faq] },
        ],
      }
    : copy("steps");

  // Blocks that only a part of the pages has: a video, a gallery, and markdown kept as plain text
  // on the pages of the old design.
  const extras = [
    ...(page.family === "solution"
      ? [
          {
            blockType: "video",
            heading: "See a project in two minutes",
            url: `${brand.site}/media/video/${cases[0].slug}.mp4`,
            poster: refs.pictures[n % refs.pictures.length],
          },
        ]
      : []),
    ...(n % 4 === 1
      ? [
          {
            blockType: "gallery",
            heading: "From our projects",
            images: cycle(refs.pictures, n, 3).map((image, i) => ({
              image,
              caption: `Workshop, day ${i + 1}`,
            })),
          },
        ]
      : []),
    ...(n % 7 === 0
      ? [
          {
            blockType: "markdownBlock",
            heading: "In short",
            markdown: [`**${page.title}**`, "", ...page.paragraphs.map((text) => `- ${text}`)].join(
              "\n"
            ),
          },
        ]
      : []),
  ];

  return [
    {
      blockType: "hero",
      eyebrow: page.eyebrow,
      heading: page.title,
      subheading: page.subheading,
      background: refs.backgrounds[n % refs.backgrounds.length],
      actions: [
        { link: internal("pages", refs.contact, "Talk to us") },
        { link: internal("pages", parent, "See the service") },
      ],
    },
    n % 2 === 0
      ? { blockType: "sharedSection", section: refs.sections.get("trust") }
      : copy("logoCloud"),
    {
      blockType: "section",
      heading: `${page.title}: the facts`,
      theme: n % 3 === 0 ? "dark" : "light",
      content: [
        {
          blockType: "richTextSection",
          heading: page.title,
          body: refs.toLexical(markdown, `${page.slug}/intro`),
        },
        {
          blockType: "columns",
          columns: [
            { width: "half", content: [statsBlock("In numbers", page.stats)] },
            {
              width: "half",
              content: [tableBlock("At a glance", page.tableColumns, page.tableRows)],
            },
          ],
        },
      ],
    },
    copy("featureGrid"),
    ...extras,
    process,
    {
      blockType: "caseStudyCards",
      heading: "Projects like yours",
      intro: `Work that is close to ${lower(page.title)}.`,
      highlighted: cases[0].id,
      cases: cases.map((study) => study.id),
    },
    { blockType: "reviewSlider", heading: "What clients say", reviews: cycle(refs.reviews, n, 4) },
    ...(page.tabs ? [] : [faq]),
    ...(page.siblings.length
      ? [
          {
            blockType: "tagLinks",
            heading: "Related pages",
            tags: page.siblings.slice(-4).map((slug) => ({
              label: upper(slug.replaceAll("-", " ")),
              page: refs.pages.get(slug),
            })),
          },
        ]
      : [
          {
            blockType: "linkList",
            heading: "Related pages",
            links: [
              { link: internal("pages", parent, "The service in detail") },
              { link: custom(`${brand.site}/blog/${guide.slug}/`, guide.title) },
            ],
          },
        ]),
    articlesBlock("Read more", posts.slice(0, 3)),
    { blockType: "sharedSection", section: refs.sections.get("contact") },
  ];
}
