/**
 * Names of collections, fields, blocks and content of the projects the plugin was built
 * and tested on, the lab schemas and their seed included. The source and the text the model
 * reads must hold none of them, also not as an example: the plugin reads the schema of the host
 * at run time.
 */
const WORDS =
  /pages-?v\d|headers-?v\d|contentMarkdown|relatedArticles|versionAuthor|focusreactive|testimonial|case[- ]stud|landing-?pages?|glossary-?terms?|site-?settings|productGrid|\btextBlock\b|meta(?:Title|Description)|subheading|tagline|siteName|\bposts\b|\bblogs?\b|\bauthors?\b|\barticles\b|\bproducts\b|\bfaqs?\b|\bhero\b|\bcta\b|\bsku\b/iu;

// The block slugs of the lab schemas, and the products the lab seed writes about.
const LAB_NAMES =
  /featureGrid|pricingTable|logoCloud|caseStudyCards|reviewSlider|comparisonTable|faqList|storyblok|sanity|contentful/iu;

// A term at the start of a camelCase name: a heroBlock or a blogPost is a project term too.
// `article` and `post` stay out: an HTML element and a common prefix (postProcess).
const COMPOUNDS =
  /\b(?:[Hh]ero|[Cc]ta|[Ff]aqs?|[Bb]logs?|[Pp]roducts?|[Aa]uthors?)[A-Z]|[Cc]ase[Ss]tud(?:y|ies)/u;

const ALL = [WORDS, LAB_NAMES, COMPOUNDS];

export const PROJECT_TERMS = {
  test: (text: string): boolean => ALL.some((terms) => terms.test(text)),
  exec: (text: string): RegExpExecArray | null =>
    ALL.map((terms) => terms.exec(text)).find((hit) => hit !== null) ?? null,
};
