import { brand, catalog, fill, read, splitFaq, splitHead, translated, words } from "./corpus";
import { COUNTRY_FACTS, LABELS } from "./data";
import type { Labels } from "./data";
import { cycle, internal } from "./layout";
import type { Id, Refs } from "./layout";
import { blockNode, inlineBlockNode, textNode, withTonesOf } from "./markdown";
import type { ToLexical } from "./markdown";
import type { AddMedia } from "./media";
import { day, slugOf } from "./records";
import type { Create } from "./records";

interface Taxonomy {
  authors: Map<string, Id>;
  categories: Map<string, Id>;
  technologies: Map<string, Id>;
  tags: Id[];
  glossary: Id[];
}

type Nodes = Record<string, any>[];

const firstParagraph = (children: Nodes) => children.find((node) => node.type === "paragraph");

// The day a post went live: inside its year, never after the day of the facts.
const publishedOn = (i: number, year?: number) =>
  year && year < 2026 ? day(`${year}-02-03`, (i * 23) % 300) : day("2026-01-12", (i * 9) % 130);

export async function seedPosts(
  create: Create,
  addMedia: AddMedia,
  toLexical: ToLexical,
  taxonomy: Taxonomy,
  contact: Id
) {
  const posts: (Refs["posts"][number] & {
    publishedOn: string;
    second?: { title: string; excerpt: string };
  })[] = [];
  const authors = [...taxonomy.authors.values()];

  for (const [i, post] of catalog.posts.entries()) {
    const { head, body } = splitHead(read(`posts/${post.slug}`), [
      "excerpt",
      "seoTitle",
      "seoDescription",
    ]);
    const { text, faq } = splitFaq(body);
    const title = fill(post.title);
    const cover = await addMedia(`cover-${post.slug}`, "cover", `Cover of the article "${title}"`);
    const markdownOnly = i % 5 === 4;
    const content = markdownOnly ? null : toLexical(text, `posts/${post.slug}`);
    const date = publishedOn(i, post.year);
    const figure =
      content && post.format === "guide"
        ? await addMedia(`figure-${post.slug}`, "cover", `Diagram for the article "${title}"`, {
            caption: LABELS.en.caption,
            credit: brand.name,
          })
        : null;

    // The blocks that the seed adds to a body: the same ones in every locale.
    const withBlocks = (state: NonNullable<typeof content>, labels: Labels) => {
      const children: Nodes = state.root.children;

      if (figure) {
        const at = children.findIndex((node) => node.type === "heading");

        children.splice(
          Math.max(at, 0),
          0,
          blockNode(`posts/${post.slug}/figure`, "figure", {
            image: figure,
            caption: labels.caption,
          })
        );
      }

      if (post.format === "comparison")
        children.push(
          blockNode(`posts/${post.slug}/cta`, "cta", {
            heading: labels.choice,
            text: labels.recommendation(brand.name),
            primary: internal("pages", contact, labels.ask),
          })
        );

      if (i % 4 === 0)
        firstParagraph(children)?.children.push(
          textNode(labels.glossary),
          inlineBlockNode(`posts/${post.slug}/term`, "glossaryTerm", {
            term: taxonomy.glossary[(i * 3) % taxonomy.glossary.length],
          }),
          textNode(".")
        );

      return state;
    };

    if (content) withBlocks(content, LABELS.en);

    const status = i % 10 === 6 ? "draft" : "published";
    const second = translated(`posts/${post.slug}`, [
      "title",
      "excerpt",
      "seoTitle",
      "seoDescription",
    ]);

    if (second && content && !second.body)
      throw new Error(`[agency seed] the translation of "${post.slug}" has no body`);

    const { id } = await create(
      "posts",
      {
        title,
        slug: post.slug,
        excerpt: head.excerpt,
        cover,
        ...(content ? { content } : { contentMarkdown: text }),
        faq,
        author: taxonomy.authors.get(post.author),
        ...(i % 6 === 0 ? { coAuthors: [authors[(i + 2) % authors.length]] } : {}),
        category: taxonomy.categories.get(post.category),
        tags: cycle(taxonomy.tags, i * 3, 2 + (i % 2)),
        technologies: post.technologies.map((slug) => taxonomy.technologies.get(slug)),
        relatedPosts: [posts[i - 1]?.id, posts[i - 3]?.id].filter((item) => item !== undefined),
        publishedOn: date,
        readingMinutes: Math.max(1, Math.round(words(text) / 220)),
        format: post.format,
        featured: i % 8 === 0,
        seo: {
          title: head.seoTitle,
          description: head.seoDescription,
          keywords: [post.category, ...post.technologies],
          ogImage: cover,
        },
        _status: status,
      },
      second
        ? {
            title: second.head.title,
            excerpt: second.head.excerpt,
            ...(content
              ? {
                  content: withBlocks(
                    withTonesOf(content, toLexical(second.body, `posts/${post.slug}/second`)),
                    LABELS.es
                  ),
                }
              : {}),
            seo: { title: second.head.seoTitle, description: second.head.seoDescription },
          }
        : false
    );

    posts.push({
      id,
      slug: post.slug,
      title,
      excerpt: head.excerpt,
      cover,
      technologies: post.technologies,
      publishedOn: date,
      ...(second ? { second: { title: second.head.title, excerpt: second.head.excerpt } } : {}),
    });
  }

  return posts;
}

export async function seedCases(
  create: Create,
  addMedia: AddMedia,
  toLexical: ToLexical,
  taxonomy: Taxonomy
) {
  const cases: (Refs["cases"][number] & { client: string })[] = [];

  for (const [i, study] of catalog.cases.entries()) {
    const { head, body } = splitHead(read(`cases/${study.slug}`), ["summary"]);
    const story = toLexical(body, `cases/${study.slug}`);
    const country = COUNTRY_FACTS.find((entry) => entry.code === study.country);
    const logo = await addMedia(`client-${study.slug}`, "logo", `Logo of ${study.client}`);
    const gallery = [];

    for (const [n, view] of ["home page", "article page"].entries()) {
      gallery.push({
        image: await addMedia(
          `case-${study.slug}-${n + 1}`,
          "cover",
          `The ${view} of the ${study.client} site`
        ),
        caption: `The new ${view}`,
      });
    }

    const withStack = (state: typeof story) => {
      firstParagraph(state.root.children)?.children.push(
        textNode(" Stack: "),
        ...study.technologies.flatMap((slug, n) => [
          ...(n ? [textNode(", ")] : []),
          inlineBlockNode(`cases/${study.slug}/tech/${slug}`, "technologyMention", {
            technology: taxonomy.technologies.get(slug),
          }),
        ]),
        textNode(".")
      );

      return state;
    };

    withStack(story);

    const second = translated(`cases/${study.slug}`, ["title", "summary"]);

    const { id } = await create(
      "case-studies",
      {
        title: study.title,
        slug: study.slug,
        client: study.client,
        industry: study.industry,
        country: study.country,
        year: study.year,
        services: study.services,
        technologies: study.technologies.map((slug) => taxonomy.technologies.get(slug)),
        summary: head.summary,
        story,
        results: study.results.map(([label, value, unit]) => ({ label, value, unit })),
        logo,
        ...(i % 3 === 0 ? { videoUrl: `${brand.site}/media/video/${study.slug}.mp4` } : {}),
        gallery,
        liveUrl: `https://www.${slugOf(study.client)}.example`,
        location: { lat: country?.lat, lng: country?.lng },
      },
      second
        ? {
            title: second.head.title,
            summary: second.head.summary,
            story: withStack(
              withTonesOf(story, toLexical(second.body, `cases/${study.slug}/second`))
            ),
          }
        : false
    );

    cases.push({
      id,
      slug: study.slug,
      client: study.client,
      country: study.country,
      industry: study.industry,
      technologies: study.technologies,
    });
  }

  return cases;
}
