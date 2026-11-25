import type { Block, CollectionConfig, GlobalConfig } from "payload";
import { bold, creator, h2, link, p, richText, ul } from "../seedHelpers";
import type { Created } from "../seedHelpers";
import type { LabSchema } from "./types";

const drafts = { versions: { drafts: true } };

const Authors: CollectionConfig = {
  slug: "authors",
  admin: { useAsTitle: "name" },
  ...drafts,
  fields: [
    { name: "name", type: "text", required: true },
    { name: "bio", type: "textarea" },
  ],
};
const Tags: CollectionConfig = {
  slug: "tags",
  admin: { useAsTitle: "name" },
  ...drafts,
  fields: [
    { name: "name", type: "text", required: true },
    { name: "slug", type: "text", required: true },
  ],
};
const Posts: CollectionConfig = {
  slug: "posts",
  admin: { useAsTitle: "title" },
  ...drafts,
  fields: [
    { name: "title", type: "text", required: true },
    { name: "slug", type: "text", required: true, unique: true },
    { name: "excerpt", type: "textarea" },
    { name: "content", type: "richText" },
    { name: "author", type: "relationship", relationTo: "authors" },
    { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
  ],
};

const Hero: Block = {
  slug: "hero",
  fields: [
    { name: "heading", type: "text", required: true },
    { name: "subheading", type: "textarea" },
  ],
};
const Faq: Block = {
  slug: "faq",
  fields: [
    { name: "title", type: "text" },
    {
      name: "items",
      type: "array",
      fields: [
        { name: "question", type: "text", required: true },
        { name: "answer", type: "textarea", required: true },
      ],
    },
  ],
};
const TextBlock: Block = { slug: "textBlock", fields: [{ name: "body", type: "richText" }] };
const Cta: Block = {
  slug: "cta",
  fields: [
    { name: "label", type: "text", required: true },
    { name: "url", type: "text", required: true },
  ],
};
const Related: Block = {
  slug: "related",
  fields: [
    { name: "heading", type: "text" },
    {
      name: "articles",
      type: "array",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "url", type: "text", required: true },
      ],
    },
    {
      name: "pages",
      type: "array",
      fields: [
        { name: "label", type: "text", required: true },
        { name: "page", type: "relationship", relationTo: "pages", required: true },
      ],
    },
  ],
};
const Pages: CollectionConfig = {
  slug: "pages",
  admin: { useAsTitle: "title" },
  ...drafts,
  fields: [
    { name: "title", type: "text", required: true },
    { name: "slug", type: "text", required: true, unique: true },
    { name: "layout", type: "blocks", blocks: [Hero, Faq, TextBlock, Cta, Related] },
  ],
};
const SiteSettings: GlobalConfig = {
  slug: "site-settings",
  ...drafts,
  fields: [
    { name: "siteName", type: "text" },
    { name: "tagline", type: "text" },
    {
      name: "navigation",
      type: "array",
      fields: [
        { name: "label", type: "text", required: true },
        { name: "url", type: "text", required: true },
      ],
    },
  ],
};

const SITE = "https://harbor.example";

export const blog: LabSchema = {
  name: "blog",
  collections: [Authors, Tags, Posts, Pages],
  globals: [SiteSettings],
  async seed(payload) {
    const create = creator(payload);

    const author = await create("authors", {
      name: "Mira Okafor",
      bio: "Writes about editorial workflows.",
    });
    const tagCms = await create("tags", { name: "CMS", slug: "cms" });
    const tagSeo = await create("tags", { name: "SEO", slug: "seo" });

    const services = await create("pages", {
      title: "Content Migration Services",
      slug: "content-migration",
      layout: [
        {
          blockType: "hero",
          heading: "Move your content without losing it",
          subheading: "We plan, script and verify every migration.",
        },
        {
          blockType: "textBlock",
          body: richText(
            p("A migration is a project, not a script. We audit the old content model first."),
            p("Then we map every field and test the result with your editors.")
          ),
        },
        {
          blockType: "faq",
          title: "Migration FAQ",
          items: [
            {
              question: "How long does a migration take?",
              answer: "Most projects take four to eight weeks.",
            },
            { question: "Do we keep our URLs?", answer: "Yes. Every old URL gets a redirect." },
          ],
        },
        { blockType: "cta", label: "Plan a migration", url: `${SITE}/contact` },
      ],
    });
    const about = await create("pages", {
      title: "About Harbor",
      slug: "about",
      layout: [
        {
          blockType: "hero",
          heading: "A small team for content platforms",
          subheading: "Founded in 2019.",
        },
        {
          blockType: "textBlock",
          body: richText(p("Harbor builds editorial tools for teams that publish every day.")),
        },
      ],
    });

    // The main article. The evals edit it: plain mentions to link, a phrase to replace.
    const guide = await create("posts", {
      title: "A Practical Guide to Headless CMS Workflows",
      slug: "headless-cms-workflows",
      excerpt: "How editorial teams plan, write and review content on a headless CMS.",
      author: author.id,
      tags: [tagCms.id],
      content: richText(
        p(
          "A headless CMS separates the content from the page that shows it. Content managers write once, and every channel reads the same entry."
        ),
        h2("Planning the content model"),
        p(
          "Start with the questions your content managers ask every day. A ",
          bold("content model"),
          " that mirrors those questions needs less training."
        ),
        p(
          "Read the ",
          link("https://payloadcms.com/docs", "Payload documentation"),
          " for the field types, then sketch the model on paper."
        ),
        h2("Review before publishing"),
        p(
          "Drafts protect the live site. Content managers save a draft, a second person reads it, and only then it goes live."
        ),
        p(
          "When the old site moves to the new platform, plan the content migration early. Redirects and media take the most time."
        ),
        h2("Measuring the result"),
        p(
          "Track how long a page takes from idea to live. Shorter cycles show that the workflow fits the team."
        )
      ),
    });

    // Links glued to the words around them, as a bad import leaves them.
    const glued = await create("posts", {
      title: "Localization Pipelines That Scale",
      slug: "localization-pipelines",
      excerpt: "Keep translations in step with the source content.",
      author: author.id,
      tags: [tagCms.id, tagSeo.id],
      content: richText(
        p(
          "A translation pipeline starts with a",
          link("https://example.org/style-guide", "style guide"),
          "that every translator follows."
        ),
        p(
          "The team then checks the",
          link("https://example.org/glossary", "shared glossary"),
          "before each release, and logs open terms."
        ),
        p("Automation helps, but a person reviews every page before it goes live.")
      ),
    });

    const bulk: Created[] = [];
    const topics = [
      "Structured Content",
      "Editorial Calendars",
      "Image Guidelines",
      "Release Notes",
      "Search Snippets",
      "Internal Linking",
      "Content Audits",
    ];

    for (const [i, topic] of topics.entries()) {
      bulk.push(
        await create("posts", {
          title: `${topic}: a Short Introduction`,
          slug: `intro-${i + 1}`,
          excerpt: `What ${topic.toLowerCase()} are and why a small team needs them.`,
          author: author.id,
          tags: [tagSeo.id],
          content: richText(
            p(`${topic} keep a growing site consistent.`),
            p("This note lists the first three steps for a small team.")
          ),
        })
      );
    }

    // Long paragraphs: a task that shortens the text meets the content-loss checks here.
    const longread = await create("posts", {
      title: "Running an Editorial Review That People Trust",
      slug: "editorial-review",
      excerpt: "What a review step is for, who does it and how to keep it fast.",
      author: author.id,
      tags: [tagCms.id],
      content: richText(
        h2("Why a second reader"),
        p(
          "A writer reads a draft with the whole plan in mind, so the gaps in it stay hidden. A second reader has only the page. That reader stops at the sentence that assumes too much, at the term nobody explained and at the step that is missing between two paragraphs. This is the main value of a review: it shows the text as a visitor will meet it, with no memory of the meetings and the notes behind it. A review that only hunts for typos wastes this. Ask the reviewer to say in one sentence what the page is for, and compare that sentence with the brief."
        ),
        h2("Who reviews and when"),
        p(
          "Pick the reviewer by the risk of the page, not by rank. A product page with prices needs a person who knows the price list. A legal notice needs the person who signs for it. A blog post needs a colleague from another team, because that colleague is closest to the real reader. Set the review at a fixed point in the workflow: after the draft is complete and before any design work starts. A review that comes later costs twice, because every change moves a layout that somebody has already approved, and people then begin to defend the layout and not the text."
        ),
        h2("Keeping it fast"),
        p(
          "A slow review is skipped, so speed is part of the quality. Give the reviewer one working day and a short list of questions. Is the claim in the title kept by the text? Is every number sourced? Can a new reader follow the steps in order? Comments go into the draft itself, next to the sentence they are about, and each comment proposes a wording. The writer accepts or answers each one, and the draft does not go live while a comment is open. Track the time from the first draft to the live page. When that time grows, look at the review first: most delays come from a reviewer who was asked too late."
        )
      ),
    });

    // Notes of the writer left in the body as their own paragraphs: a task that removes them must
    // delete whole paragraphs and keep the rest.
    const notes = await create("posts", {
      title: "Planning a Product Tour Page",
      slug: "product-tour-page",
      excerpt: "How to plan the sections and the pictures of a product tour.",
      author: author.id,
      tags: [tagCms.id],
      content: richText(
        p("A product tour shows one task from start to finish. Pick the task before the pictures."),
        p("[Image: the tour start screen - keep the existing asset]"),
        h2("Choose the steps"),
        p(
          "List the steps a new visitor takes. Read the ",
          link("https://example.org/tour-checklist", "tour checklist"),
          " and drop every step that needs an explanation."
        ),
        p("[Image: the list of steps - new asset needed]"),
        p("Every image on the page needs a caption that says what the visitor sees."),
        h2("Write the captions"),
        p("[Image: a caption under a picture - new asset needed]"),
        p("A caption is one sentence. It names the action, not the button."),
        h2("Check the page"),
        p("Ask a colleague to follow the tour with no help."),
        p("[Image: the finished tour page - keep the existing asset]")
      ),
    });

    // Notes of the writer in the body, some inside a sentence and some as a whole list item, two
    // of them nearly the same: a task that names one note must remove that one and no other.
    const checks = await create("posts", {
      title: "Three Translation Vendors Compared",
      slug: "translation-vendors-compared",
      excerpt: "Three translation vendors compared by speed, price and review process.",
      author: author.id,
      tags: [tagCms.id],
      content: richText(
        p("Each vendor below was scored on speed, price and review process."),
        h2("Northwind Words"),
        p(
          "Overview. Northwind Words works from two offices. [VERIFY: office cities, team size.] It translates product pages and help articles."
        ),
        ul("Fast turnaround on short pages", "[VERIFY: named retail case]"),
        h2("Lakeside Language"),
        p(
          "Overview. Lakeside Language translates legal and financial text. [VERIFY: founding year.]"
        ),
        ul("[VERIFY: named retail migration case]", "Review process not publicly documented"),
        h2("Harbor Lingua"),
        p("Overview. Harbor Lingua sells a glossary service next to translation."),
        ul(
          "Slow on large batches",
          "Review process not publicly documented",
          "[VERIFY: named retail case; any second office]"
        )
      ),
    });

    // A page with link rows: each label names the page its link opens. A rewrite of a copy for
    // another topic must not leave a new label on an old target.
    const regionPage = (country: string, slug: string, city: string) =>
      create("pages", {
        title: `Editorial Tooling for Teams in ${country}`,
        slug: `editorial-tooling-${slug}`,
        layout: [
          {
            blockType: "hero",
            heading: `Editorial tooling for teams in ${country}`,
            subheading: `We set up review workflows for publishers in ${city}.`,
          },
        ],
      });
    const austria = await regionPage("Austria", "austria", "Vienna");
    const switzerland = await regionPage("Switzerland", "switzerland", "Zurich");
    const regional = await create("pages", {
      title: "Editorial Tooling for Teams in Germany",
      slug: "editorial-tooling-germany",
      layout: [
        {
          blockType: "hero",
          heading: "Editorial tooling for teams in Germany",
          subheading: "We set up review workflows for publishers in Berlin, Hamburg and Munich.",
        },
        {
          blockType: "textBlock",
          body: richText(
            p(
              "German publishers work under strict privacy rules. We plan the workflow around them."
            ),
            p("Our team works in the Berlin time zone and speaks German.")
          ),
        },
        {
          blockType: "related",
          heading: "Read more",
          articles: [
            {
              title: "Headless CMS Workflows: a Guide for German Teams",
              url: `${SITE}/blog/headless-cms-workflows`,
            },
            {
              title: "An Editorial Review That German Readers Trust",
              url: `${SITE}/blog/editorial-review`,
            },
          ],
          pages: [
            { label: "Austria", page: austria.id },
            { label: "Switzerland", page: switzerland.id },
          ],
        },
        { blockType: "cta", label: "Plan a workflow", url: `${SITE}/contact` },
      ],
    });

    await payload.updateGlobal({
      slug: "site-settings" as never,
      data: {
        siteName: "Harbor",
        tagline: "Editorial tools for busy teams",
        navigation: [
          { label: "Blog", url: "/blog" },
          { label: "About", url: "/about" },
        ],
        _status: "published",
      } as never,
    });

    // Links to pages of the site itself, most with no slash at the end: one address two times in
    // a post, one link whose text is the address, one that has the slash and one to another site.
    const slashes = await Promise.all(
      [
        {
          title: "Choosing a Review Workflow",
          slug: "review-workflow",
          content: richText(
            p("Start with the ", link(`${SITE}/editorial-calendar`, "editorial calendar"), "."),
            p(
              "Our ",
              link(`${SITE}/services/review`, "review service"),
              " covers the second read. The ",
              link(`${SITE}/services/review`, "same service"),
              " covers the fact check."
            ),
            p("The ", link(`${SITE}/pricing/`, "price list"), " shows the cost."),
            p("Agree on a ", link("https://example.org/style-guide", "style guide"), " first.")
          ),
        },
        {
          title: "Writing for Translation",
          slug: "writing-for-translation",
          content: richText(
            p("Read ", link(`${SITE}/blog/glossary-basics`, `${SITE}/blog/glossary-basics`), "."),
            p("Then ask for a ", link(`${SITE}/contact`, "free review call"), ".")
          ),
        },
        {
          title: "A Second Reader for Every Page",
          slug: "second-reader",
          content: richText(
            p(
              "A second reader finds the gaps. Our ",
              link(`${SITE}/services/review`, "review"),
              "."
            ),
            p("Plan it in the ", link(`${SITE}/editorial-calendar`, "calendar"), ".")
          ),
        },
      ].map((post) =>
        create("posts", {
          ...post,
          excerpt: `${post.title}: a short guide.`,
          author: author.id,
          tags: [tagCms.id],
        })
      )
    );

    return {
      documents: {
        guide: { collection: "posts", id: guide.id },
        glued: { collection: "posts", id: glued.id },
        longread: { collection: "posts", id: longread.id },
        notes: { collection: "posts", id: notes.id },
        checks: { collection: "posts", id: checks.id },
        ...Object.fromEntries(
          slashes.map((doc, i) => [`slash${i + 1}`, { collection: "posts", id: doc.id }])
        ),
        services: { collection: "pages", id: services.id },
        about: { collection: "pages", id: about.id },
        regional: { collection: "pages", id: regional.id },
        austria: { collection: "pages", id: austria.id },
        switzerland: { collection: "pages", id: switzerland.id },
        ...Object.fromEntries(
          bulk.map((doc, i) => [`intro${i + 1}`, { collection: "posts", id: doc.id }])
        ),
      },
    };
  },
};
