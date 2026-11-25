// Fixed facts of the seed. Every record that is not an authored text is built from these tables.

export interface Country {
  code: string;
  name: string;
  adjective: string;
  city: string;
  language: string;
  currency: string;
  office: "Amsterdam" | "Berlin";
  clients: number;
  lat: number;
  lng: number;
}

export const COUNTRY_FACTS: Country[] = [
  {
    code: "us",
    name: "the United States",
    adjective: "American",
    city: "New York",
    language: "English",
    currency: "USD",
    office: "Amsterdam",
    clients: 31,
    lat: 40.71,
    lng: -74.01,
  },
  {
    code: "ca",
    name: "Canada",
    adjective: "Canadian",
    city: "Toronto",
    language: "English and French",
    currency: "CAD",
    office: "Amsterdam",
    clients: 9,
    lat: 43.65,
    lng: -79.38,
  },
  {
    code: "uk",
    name: "the United Kingdom",
    adjective: "British",
    city: "London",
    language: "English",
    currency: "GBP",
    office: "Amsterdam",
    clients: 24,
    lat: 51.51,
    lng: -0.13,
  },
  {
    code: "de",
    name: "Germany",
    adjective: "German",
    city: "Berlin",
    language: "German",
    currency: "EUR",
    office: "Berlin",
    clients: 38,
    lat: 52.52,
    lng: 13.4,
  },
  {
    code: "at",
    name: "Austria",
    adjective: "Austrian",
    city: "Vienna",
    language: "German",
    currency: "EUR",
    office: "Berlin",
    clients: 7,
    lat: 48.21,
    lng: 16.37,
  },
  {
    code: "ch",
    name: "Switzerland",
    adjective: "Swiss",
    city: "Zurich",
    language: "German, French and Italian",
    currency: "CHF",
    office: "Berlin",
    clients: 11,
    lat: 47.38,
    lng: 8.54,
  },
  {
    code: "nl",
    name: "the Netherlands",
    adjective: "Dutch",
    city: "Amsterdam",
    language: "Dutch",
    currency: "EUR",
    office: "Amsterdam",
    clients: 27,
    lat: 52.37,
    lng: 4.9,
  },
  {
    code: "se",
    name: "Sweden",
    adjective: "Swedish",
    city: "Stockholm",
    language: "Swedish",
    currency: "SEK",
    office: "Berlin",
    clients: 8,
    lat: 59.33,
    lng: 18.07,
  },
  {
    code: "no",
    name: "Norway",
    adjective: "Norwegian",
    city: "Oslo",
    language: "Norwegian",
    currency: "NOK",
    office: "Berlin",
    clients: 6,
    lat: 59.91,
    lng: 10.75,
  },
  {
    code: "dk",
    name: "Denmark",
    adjective: "Danish",
    city: "Copenhagen",
    language: "Danish",
    currency: "DKK",
    office: "Berlin",
    clients: 5,
    lat: 55.68,
    lng: 12.57,
  },
  {
    code: "es",
    name: "Spain",
    adjective: "Spanish",
    city: "Madrid",
    language: "Spanish",
    currency: "EUR",
    office: "Amsterdam",
    clients: 4,
    lat: 40.42,
    lng: -3.7,
  },
  {
    code: "au",
    name: "Australia",
    adjective: "Australian",
    city: "Sydney",
    language: "English",
    currency: "AUD",
    office: "Amsterdam",
    clients: 10,
    lat: -33.87,
    lng: 151.21,
  },
];

export interface TechFacts {
  vendor: string;
  license: "open-source" | "proprietary";
  selfHosted: boolean;
  summary: string;
  pricing: { model: string; freeTier: boolean; hostedPlan: boolean };
}

const tech = (
  vendor: string,
  license: TechFacts["license"],
  selfHosted: boolean,
  model: string,
  freeTier: boolean,
  hostedPlan: boolean,
  summary: string
): TechFacts => ({
  vendor,
  license,
  selfHosted,
  summary,
  pricing: { model, freeTier, hostedPlan },
});

// The fixed texts that the seed puts next to an authored text, in the first and the second locale.
export const LABELS = {
  en: {
    talk: "Talk to us",
    contact: "Contact us",
    blog: "Read the blog",
    caption: "The setup at a glance",
    choice: "Not sure which one fits?",
    recommendation: (name: string) => `Tell ${name} about your project and get a recommendation.`,
    ask: "Ask our team",
    glossary: " See the glossary: ",
  },
  es: {
    talk: "Habla con nosotros",
    contact: "Contáctanos",
    blog: "Lee el blog",
    caption: "La configuración de un vistazo",
    choice: "¿No sabes cuál encaja mejor?",
    recommendation: (name: string) => `Cuéntale tu proyecto a ${name} y recibe una recomendación.`,
    ask: "Pregunta a nuestro equipo",
    glossary: " Consulta el glosario: ",
  },
};
export type Labels = (typeof LABELS)["en"];

export const TECH_FACTS: Record<string, TechFacts> = {
  payload: tech(
    "Payload CMS, Inc.",
    "open-source",
    true,
    "open-source",
    true,
    true,
    "A TypeScript CMS that is configured in code and runs inside a Next.js application."
  ),
  sanity: tech(
    "Sanity AS",
    "proprietary",
    false,
    "usage",
    true,
    true,
    "A hosted content platform with an open source editing studio and the GROQ query language."
  ),
  storyblok: tech(
    "Storyblok GmbH",
    "proprietary",
    false,
    "subscription",
    true,
    true,
    "A hosted headless CMS with a visual editor and content built from nested components."
  ),
  contentful: tech(
    "Contentful GmbH",
    "proprietary",
    false,
    "subscription",
    true,
    true,
    "A hosted content platform with content models, environments and a large app marketplace."
  ),
  strapi: tech(
    "Strapi Solutions SAS",
    "open-source",
    true,
    "open-source",
    true,
    true,
    "An open source Node.js CMS with a content type builder in the admin panel."
  ),
  directus: tech(
    "Monospace, Inc.",
    "open-source",
    true,
    "open-source",
    true,
    true,
    "A data platform that puts an admin app and APIs on top of an existing SQL database."
  ),
  wordpress: tech(
    "WordPress Foundation",
    "open-source",
    true,
    "open-source",
    true,
    false,
    "The most used open source CMS, built with PHP, with themes, plugins and a REST API."
  ),
  nextjs: tech(
    "Vercel",
    "open-source",
    true,
    "open-source",
    true,
    false,
    "A React framework with server rendering, static generation and the App Router."
  ),
  astro: tech(
    "The Astro Technology Company",
    "open-source",
    true,
    "open-source",
    true,
    false,
    "A web framework for content sites that ships little JavaScript by default."
  ),
  nuxt: tech(
    "NuxtLabs",
    "open-source",
    true,
    "open-source",
    true,
    false,
    "A Vue framework with server rendering, static generation and file-based routing."
  ),
  remix: tech(
    "Shopify",
    "open-source",
    true,
    "open-source",
    true,
    false,
    "A React framework built on web standards, with nested routes and server data loading."
  ),
  sveltekit: tech(
    "Svelte",
    "open-source",
    true,
    "open-source",
    true,
    false,
    "The application framework of Svelte, with server rendering and adapters for many hosts."
  ),
  gatsby: tech(
    "Netlify",
    "open-source",
    true,
    "open-source",
    true,
    false,
    "A React static site generator with a GraphQL data layer and a plugin ecosystem."
  ),
  shopify: tech(
    "Shopify Inc.",
    "proprietary",
    false,
    "subscription",
    false,
    true,
    "A hosted commerce platform with a Storefront API for headless shops."
  ),
  medusa: tech(
    "Medusa",
    "open-source",
    true,
    "open-source",
    true,
    true,
    "An open source commerce engine for Node.js, built from modules."
  ),
  commercetools: tech(
    "commercetools GmbH",
    "proprietary",
    false,
    "usage",
    false,
    true,
    "An API-first commerce platform for large catalogs and several markets."
  ),
  vercel: tech(
    "Vercel Inc.",
    "proprietary",
    false,
    "usage",
    true,
    true,
    "A hosting platform for frontend frameworks, made by the company behind Next.js."
  ),
  netlify: tech(
    "Netlify, Inc.",
    "proprietary",
    false,
    "usage",
    true,
    true,
    "A hosting platform for web projects with builds, functions and deploy previews."
  ),
  "cloudflare-pages": tech(
    "Cloudflare, Inc.",
    "proprietary",
    false,
    "usage",
    true,
    true,
    "Hosting for frontend projects on the Cloudflare network, next to Workers."
  ),
  algolia: tech(
    "Algolia",
    "proprietary",
    false,
    "usage",
    true,
    true,
    "A hosted search API with fast results, typo tolerance and analytics."
  ),
  typesense: tech(
    "Typesense, Inc.",
    "open-source",
    true,
    "open-source",
    true,
    true,
    "An open source search engine that holds its index in memory, with a hosted cloud plan."
  ),
  meilisearch: tech(
    "Meili SAS",
    "open-source",
    true,
    "open-source",
    true,
    true,
    "An open source search engine written in Rust, with a hosted cloud plan."
  ),
};

export const TAGS = [
  "Content modeling",
  "Live preview",
  "Migration",
  "Localization",
  "Performance",
  "Core Web Vitals",
  "Technical SEO",
  "Redirects",
  "Editorial workflow",
  "Access control",
  "Images",
  "Caching",
  "Hosting",
  "Site search",
  "Headless commerce",
  "Open source",
  "Comparison",
  "Research",
  "Company news",
  "Starter kit",
];

// A term, its definition and the technology it belongs to, when it belongs to one.
export const GLOSSARY: [string, string, string?][] = [
  ["Headless CMS", "A CMS that stores content and serves it through an API, with no page layer."],
  ["Content model", "The set of content types, their fields and the relations between them."],
  ["Content type", "A named shape of content, such as a post or a product, made of fields."],
  ["Collection", "A group of documents that share one set of fields.", "payload"],
  ["Global", "A document that exists one time, such as the site header.", "payload"],
  ["Block", "A reusable section of a page with its own fields."],
  ["Rich text", "Formatted text stored as a tree of nodes, not as HTML."],
  ["Portable Text", "The open rich text format that Sanity uses.", "sanity"],
  ["GROQ", "The query language of Sanity for JSON documents.", "sanity"],
  ["Story", "One content entry in Storyblok, built from nested components.", "storyblok"],
  ["Space", "The container of all content and settings of one project in Storyblok or Contentful."],
  ["Environment", "A copy of the content model and content for tests, as Contentful offers."],
  ["Locale", "One language or regional version of the content."],
  ["Fallback locale", "The locale a field is read from when its own locale is empty."],
  ["Draft", "A saved version of a document that visitors do not see."],
  ["Version", "A saved state of a document that an editor can restore."],
  ["Live preview", "A view of the page that updates while the editor types."],
  ["Visual editor", "An editor that shows the page and lets the editor click a part to change it."],
  ["Webhook", "An HTTP request that a system sends when an event happens."],
  ["Static site generation", "Pages are built to HTML files before a visitor asks for them."],
  ["Server-side rendering", "The server builds the HTML of a page on each request."],
  ["Incremental static regeneration", "A static page is built again after a set time.", "nextjs"],
  ["App Router", "The router of Next.js that is built on React Server Components.", "nextjs"],
  ["Server component", "A React component that runs only on the server."],
  ["Island architecture", "A static page with small interactive parts that load alone.", "astro"],
  ["Hydration", "The step in which the browser attaches JavaScript to server HTML."],
  ["Edge function", "Code that runs on the network of the host, close to the visitor."],
  ["CDN", "A network of servers that keep copies of files close to visitors."],
  ["Cache tag", "A label on cached data that lets the site clear exactly that data."],
  ["Core Web Vitals", "Three measures by Google of loading, interaction and layout stability."],
  ["Largest Contentful Paint", "The time until the largest element in view is drawn."],
  ["Interaction to Next Paint", "The delay between an action of the visitor and the next frame."],
  ["Cumulative Layout Shift", "A score for how much the page moves while it loads."],
  ["Canonical URL", "The address a search engine should treat as the main one for a page."],
  ["Redirect map", "A table of old addresses and the new address of each."],
  ["Structured data", "Markup that tells a search engine what a page is about."],
  ["Access control", "The rules that decide who can read or change a document."],
  ["Composable commerce", "A shop built from separate services that talk through APIs."],
  ["Storefront API", "The API a headless shop reads products and carts from.", "shopify"],
  ["Search index", "The data structure a search engine reads to answer a query."],
];

export const FAQS: [string, string, string][] = [
  [
    "pricing",
    "How do you price a project?",
    "We give a fixed price for a defined scope after a paid discovery phase.",
  ],
  [
    "pricing",
    "Do you work on a retainer?",
    "Yes. Support and further development run on a monthly retainer with a fixed number of days.",
  ],
  [
    "pricing",
    "What does a discovery phase cost?",
    "A discovery phase takes two weeks and has a fixed price that we name in the first call.",
  ],
  [
    "pricing",
    "Are CMS license fees part of your price?",
    "No. You pay the vendor directly, and we help you choose the right plan.",
  ],
  [
    "pricing",
    "Do you charge for an estimate?",
    "No. The first call and a rough estimate are free.",
  ],
  [
    "pricing",
    "Can we start with a small project?",
    "Yes. Many clients start with an audit and decide on the next step after the report.",
  ],
  [
    "process",
    "How long does a typical project take?",
    "Most websites take three to five months from the first workshop to launch.",
  ],
  [
    "process",
    "Who will we work with?",
    "A project lead, a designer and two or three developers who stay on the project until launch.",
  ],
  [
    "process",
    "How often do we see progress?",
    "Every two weeks we show working software and agree on the next steps.",
  ],
  [
    "process",
    "Do you write the content?",
    "We plan the content model and migrate content. Writing is done by your team or a partner.",
  ],
  [
    "process",
    "Which tools do you use to plan the work?",
    "We work in your issue tracker when you have one, and in ours when you do not.",
  ],
  [
    "process",
    "Can our developers work with your team?",
    "Yes. Mixed teams are common, and we share one repository and one review process.",
  ],
  [
    "migration",
    "Will we lose search traffic in a migration?",
    "A tested redirect map and equal metadata keep the traffic. We watch the numbers after launch.",
  ],
  [
    "migration",
    "Can you migrate our content by script?",
    "Yes. We write migration scripts and check the result against the old site.",
  ],
  [
    "migration",
    "Do we need a content freeze?",
    "A short freeze of a few days before launch is enough in most projects.",
  ],
  [
    "migration",
    "Can we keep our URLs?",
    "Yes, where the structure allows it. Every changed URL gets a permanent redirect.",
  ],
  [
    "migration",
    "What happens to our images and files?",
    "We move them to the new media library and keep alt texts and captions.",
  ],
  [
    "migration",
    "Can we migrate in steps?",
    "Yes. A section of the site can move first while the old system serves the rest.",
  ],
  [
    "support",
    "Do you offer support after launch?",
    "Yes. A support plan covers updates, monitoring and small changes.",
  ],
  [
    "support",
    "How fast do you answer an incident?",
    "On a support plan we answer a critical incident within two working hours.",
  ],
  [
    "support",
    "Do you train our editors?",
    "Yes. Every project ends with a training session and a written guide for editors.",
  ],
  [
    "support",
    "Who keeps the dependencies up to date?",
    "On a support plan we update the CMS and the framework every month.",
  ],
  [
    "support",
    "Can you take over a site that another agency built?",
    "Yes, after an audit that tells us and you what state the code is in.",
  ],
  [
    "support",
    "Do you host the site?",
    "No. The site runs in your own hosting account, and we set it up and document it.",
  ],
];

export const AWARDS: [string, string, number][] = [
  ["Top Web Developers", "Clutch", 2026],
  ["Top Web Developers", "Clutch", 2025],
  ["Top B2B Companies in the Netherlands", "Clutch", 2024],
  ["High Performer, Web Development", "G2", 2026],
  ["High Performer, Web Development", "G2", 2025],
  ["Partner of the Year", "Payload", 2025],
  ["Agency Partner Award", "Storyblok", 2024],
  ["Site of the Month", "Headless Awards", 2023],
];

export const PARTNERS = [
  "payload",
  "sanity",
  "storyblok",
  "contentful",
  "strapi",
  "directus",
  "shopify",
  "medusa",
  "vercel",
  "netlify",
  "algolia",
  "typesense",
];

export const FIRST_NAMES = [
  "Anna",
  "Lukas",
  "Emma",
  "Noah",
  "Mia",
  "Elias",
  "Sara",
  "Oskar",
  "Lena",
  "Marco",
  "Nora",
  "Felix",
  "Clara",
  "Hugo",
  "Julia",
  "Theo",
  "Maya",
  "Erik",
  "Laura",
  "Ben",
];
export const LAST_NAMES = [
  "Hansen",
  "Keller",
  "Novak",
  "Fischer",
  "Lindgren",
  "Moreau",
  "Bakker",
  "Costa",
  "Weber",
  "Nilsen",
  "Carter",
  "Rossi",
  "Meyer",
  "Dahl",
  "Brooks",
  "Vega",
  "Jansen",
];
export const COMPANIES = [
  "Northgate Tools",
  "Pinecrest Labs",
  "Harrow & Vale",
  "Bluewater Freight",
  "Solvik Energy",
  "Mertens Group",
  "Ridgeline Insurance",
  "Copperfield Foods",
  "Larkspur Hotels",
  "Tidewater Robotics",
  "Evergreen Mobility",
  "Stonebridge Legal",
  "Oakhaven Schools",
  "Vantage Optics",
  "Sable Analytics",
  "Greyfriars Publishing",
];
export const ROLES = [
  "Head of Marketing",
  "CTO",
  "Product Owner",
  "Content Lead",
  "Head of Digital",
  "Engineering Manager",
  "Marketing Director",
  "Chief Digital Officer",
];

export const REVIEW_OPENERS = [
  "The team understood our content before they wrote a line of code.",
  "We launched on the planned date, which had never happened to us before.",
  "Our editors now publish a page without a ticket to the developers.",
  "The migration kept every address that mattered to our search traffic.",
  "They told us plainly which of our ideas would not work, and why.",
  "The handover was so clear that our own developers took over in a week.",
  "Every two weeks we saw working software, not slides.",
  "The new site loads fast on a phone, and the numbers show it.",
];
export const REVIEW_CLOSERS = [
  "We have already started the second project with them.",
  "I would choose them again without a second pitch.",
  "The estimate held from the first week to the last.",
  "Their documentation is the best we have received from an agency.",
  "Our team learned a lot from working next to theirs.",
  "Support after launch has been quick and calm.",
  "The content model still fits two years later.",
];

export const EVENT_TOPICS = [
  "Content modeling workshop",
  "Headless CMS meetup",
  "Migration office hours",
  "Next.js performance clinic",
  "Payload community evening",
  "Editor experience roundtable",
  "Technical SEO for headless sites",
  "Localization in practice",
  "Headless commerce breakfast",
  "Starter kit live demo",
];
export const AGENDA = [
  "Welcome and introductions",
  "A case from a recent project",
  "Live demo",
  "Questions and answers",
  "Lightning talks",
  "Hands-on session",
];

export const CHANGES = [
  "Faster builds for projects with many pages",
  "A new block for comparison tables",
  "Better error messages in the CLI",
  "Preview works with the draft mode of Next.js",
  "A fix for image sizes in the gallery block",
  "A fix for redirects with a trailing slash",
  "Locale fallbacks can be set per field",
  "The SEO fields validate their length",
  "Scheduled publishing for pages and posts",
  "A fix for a crash on an empty navigation",
  "Updated dependencies",
  "The sitemap lists every locale",
];

export const FORM_MESSAGES = [
  "We plan to replace our CMS next year and would like to talk about options.",
  "Could you send an estimate for a migration of about 800 pages?",
  "Our editors need a preview that works. Can you help?",
  "We are looking for an audit of our Next.js site before a relaunch.",
  "Please add me to the newsletter.",
  "We need support for a site that another agency built.",
  "Do you have experience with multi-language sites in our industry?",
  "Our build takes forty minutes. We would like to fix that.",
  "We want to add a shop to our content site.",
  "Can we book a call for next week?",
];
export const SPAM_MESSAGES = [
  "Boost your rankings with 5000 backlinks for a low price.",
  "Your domain listing is about to expire, renew here today.",
  "We sell email lists of decision makers in your market.",
];

export const INDUSTRY_NAMES: Record<string, string> = {
  saas: "SaaS companies",
  ecommerce: "online shops",
  fintech: "fintech companies",
  media: "publishers",
  education: "universities and schools",
  healthcare: "healthcare providers",
  travel: "travel companies",
};
