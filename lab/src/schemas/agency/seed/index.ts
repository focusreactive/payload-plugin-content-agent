import type { Payload } from "payload";
import type { Created } from "../../../seedHelpers";
import { collections } from "../collections";
import { globals } from "../globals";
import { seedCases, seedPosts } from "./authored";
import {
  brand,
  catalog,
  fill,
  read,
  SECOND_LOCALE,
  splitHead,
  splitParts,
  translated,
} from "./corpus";
import type { Part } from "./corpus";
import { LABELS } from "./data";
import { dictionary, merged, secondOf, without } from "./second";
import { freezeDates } from "./dates";
import { createFaults } from "./faults";
import { derivedLayout, derivedPages } from "./derived";
import { blockFrom, custom, cycle, internal, para, withIds } from "./layout";
import type { Id, Refs } from "./layout";
import { markdownConverter } from "./markdown";
import { mediaLibrary } from "./media";
import {
  seedDocs,
  seedEvents,
  seedForms,
  seedRedirects,
  seedReviews,
  seedTaxonomy,
} from "./records";
import type { Create } from "./records";

const GENERIC = "headless-cms-development";

export async function seedAgency(payload: Payload) {
  const counts: Record<string, number> = {};
  const toLexical = markdownConverter(payload, "posts", "content");
  const faults = createFaults(toLexical);

  const strings = dictionary();
  const fieldsOf = (collection: string) => payload.collections[collection].config.fields;

  const create: Create = async (collection, data, second) => {
    counts[collection] = (counts[collection] ?? 0) + 1;

    const key = `${collection}/${counts[collection]}`;
    // Read before the faults go in: the second locale has none.
    const translation =
      second === false
        ? {}
        : merged(
            secondOf(
              fieldsOf(collection),
              without(withIds(structuredClone(data), key), second ?? {}),
              strings.t
            ),
            second ?? {}
          );
    const status = (data as { _status?: string })._status ?? "published";
    const created = (await payload
      .create({
        collection: collection as never,
        data: withIds({ _status: "published", ...faults.before(collection, data) }, key) as never,
      })
      .catch((error) => {
        throw new Error(
          `[agency seed] ${collection} ${counts[collection]}: ${JSON.stringify(error.data?.errors ?? error.message)}`
        );
      })) as unknown as Created;

    if (Object.keys(translation).length)
      await payload.update({
        collection: collection as never,
        id: created.id,
        locale: SECOND_LOCALE as never,
        data: withIds({ _status: status, ...translation }, `${key}/second`) as never,
      });

    return created;
  };

  const update = (collection: string) => (id: Id, data: object) =>
    payload.update({
      collection: collection as never,
      id,
      data: { _status: "published", ...data } as never,
    });
  const addMedia = faults.media(mediaLibrary(payload, SECOND_LOCALE, strings.t));
  const taxonomy = await seedTaxonomy(create, addMedia);
  const backgrounds: Id[] = [];
  const pictures: Id[] = [];

  for (let i = 1; i <= 8; i++)
    backgrounds.push(await addMedia(`hero-${i}`, "cover", `Abstract background ${i}`));
  for (let i = 1; i <= 4; i++)
    pictures.push(await addMedia(`picture-${i}`, "cover", `Team at work, picture ${i}`));

  const contact = await create("pages", {
    title: "Contact",
    slug: "contact",
    family: "company",
    layout: [
      {
        blockType: "hero",
        heading: `Talk to ${brand.name}`,
        subheading: `Write to the ${catalog.facts.offices.join(" or ")} office. We answer within one working day.`,
        background: backgrounds[0],
      },
      {
        blockType: "contactForm",
        heading: "Send a message",
        intro: "Tell us what you want to build, migrate or fix.",
        form: "contact",
      },
    ],
    seo: {
      title: `Contact | ${brand.name}`,
      description: `Contact ${brand.name}: offices in ${catalog.facts.offices.join(" and ")}.`,
    },
  });

  await seedDocs(create, update("docs"));

  const posts = await seedPosts(create, addMedia, toLexical, taxonomy, contact.id);
  const cases = await seedCases(create, addMedia, toLexical, taxonomy);
  const reviews = await seedReviews(create, addMedia, cases);

  for (const [i, study] of cases.entries())
    await update("case-studies")(study.id, { review: reviews[i] });

  const refs: Refs = {
    contact: contact.id,
    pages: new Map([["contact", contact.id]]),
    posts,
    cases,
    reviews,
    partners: taxonomy.partners,
    awards: taxonomy.awards,
    faqs: taxonomy.faqs,
    technologies: taxonomy.technologies,
    sections: new Map(),
    backgrounds,
    pictures,
    toLexical,
    labels: LABELS.en,
  };
  // The cards of an article show its translated title where one exists.
  const secondRefs: Refs = {
    ...refs,
    posts: posts.map((post) => ({ ...post, ...post.second })),
    labels: LABELS.es,
  };
  const heads = new Map<string, Record<string, string>>();
  const parts = new Map<string, Part[]>();

  for (const page of catalog.pages) {
    const { head, body } = splitHead(read(`pages/${page.slug}`), ["seoTitle", "seoDescription"]);

    heads.set(page.slug, head);
    parts.set(page.slug, splitParts(body));
  }

  const generic = (slug: string) => {
    const part = parts.get(GENERIC)?.find((candidate) => candidate.slug === slug);

    if (!part) throw new Error(`[agency seed] the master "${GENERIC}" has no "${slug}" block`);

    return blockFrom(part, refs, 0, `sections/${slug}`);
  };

  const sections: [string, string, object[]][] = [
    [
      "trust",
      "Trust strip: partners and awards",
      [
        {
          blockType: "logoCloud",
          heading: "Partners we build with",
          partners: cycle(refs.partners, 0, 6),
        },
        { blockType: "awardsStrip", heading: "Awards", awards: cycle(refs.awards, 0, 4) },
      ],
    ],
    [
      "contact",
      "Contact: call to action and form",
      [
        {
          blockType: "cta",
          heading: "Ready to talk?",
          text: `Tell ${brand.name} what you want to build, migrate or fix.`,
          primary: internal("pages", contact.id, "Talk to us"),
          secondary: custom(`${brand.site}/blog/`, "Read the blog"),
        },
        {
          blockType: "contactForm",
          heading: "Send a message",
          intro: "We answer within one working day.",
          form: "contact",
        },
      ],
    ],
    ["process", "Process: the five steps", [generic("steps")]],
    [
      "reviews",
      "Reviews: the slider",
      [{ blockType: "reviewSlider", heading: "What clients say", reviews: cycle(reviews, 0, 6) }],
    ],
  ];

  for (const [key, title, content] of sections)
    refs.sections.set(key, (await create("sections", { title, content })).id);

  const pages: { id: Id; slug: string }[] = [];

  for (const [i, page] of catalog.pages.entries()) {
    const head = heads.get(page.slug);
    const second = translated(`pages/${page.slug}`, ["title", "seoTitle", "seoDescription"]);
    const { id } = await create(
      "pages",
      {
        title: fill(page.title),
        slug: page.slug,
        family: page.family,
        layout: (parts.get(page.slug) ?? []).map((part, k) =>
          blockFrom(part, refs, i, `pages/${page.slug}/${k}`)
        ),
        seo: {
          title: head?.seoTitle,
          description: head?.seoDescription,
          keywords: [page.subject.toLowerCase()],
          ogImage: backgrounds[i % backgrounds.length],
        },
      },
      second
        ? {
            title: second.head.title,
            layout: splitParts(second.body).map((part, k) =>
              blockFrom(part, secondRefs, i, `pages/${page.slug}/second/${k}`)
            ),
            seo: { title: second.head.seoTitle, description: second.head.seoDescription },
          }
        : false
    );

    refs.pages.set(page.slug, id);
    pages.push({ id, slug: page.slug });
  }

  for (const [n, page] of derivedPages().entries()) {
    const { id } = await create("pages", {
      title: page.title,
      slug: page.slug,
      parent: refs.pages.get(page.parent),
      family: page.family,
      design: n % 7 === 0 ? "v1" : "v2",
      layout: derivedLayout(page, parts, refs, n),
      seo: {
        title: `${page.title} | ${brand.name}`,
        description: page.subheading,
        keywords: [page.title.toLowerCase()],
        ogImage: backgrounds[n % backgrounds.length],
      },
    });

    refs.pages.set(page.slug, id);
    pages.push({ id, slug: page.slug });
  }

  await seedEvents(create, [...taxonomy.authors.values()]);
  await seedRedirects(create, posts, pages, cases);
  await seedForms(
    create,
    pages.map((page) => page.slug)
  );

  const page = (slug: string, label: string) =>
    internal("pages", refs.pages.get(slug) as Id, label);
  const logo = await addMedia("site-logo", "logo", `Logo of ${brand.name}`);

  const updateGlobal = async (slug: string, data: object) => {
    const fields = payload.globals.config.find((global) => global.slug === slug)?.fields ?? [];
    const first = withIds({ _status: "published", ...data }, `globals/${slug}`);

    await payload.updateGlobal({ slug: slug as never, data: first as never });
    await payload.updateGlobal({
      slug: slug as never,
      locale: SECOND_LOCALE as never,
      data: withIds(
        { _status: "published", ...secondOf(fields, structuredClone(first), strings.t) },
        `globals/${slug}/second`
      ) as never,
    });
  };

  await updateGlobal("header", {
    logo,
    navigation: [
      {
        link: page(GENERIC, "Services"),
        children: catalog.pages
          .filter((entry) => entry.family !== "company")
          .map((entry) => ({ link: page(entry.slug, entry.title), description: entry.subject })),
      },
      { link: custom(`${brand.site}/blog/`, "Blog") },
      { link: custom(`${brand.site}/docs/`, "Docs") },
      { link: page("about", "About") },
    ],
    action: page("contact", "Talk to us"),
  });
  await updateGlobal("footer", {
    columns: [
      {
        title: "Services",
        links: catalog.pages
          .filter((entry) => entry.family !== "company")
          .map((entry) => ({ link: page(entry.slug, entry.title) })),
      },
      {
        title: "Company",
        links: [
          { link: page("about", "About") },
          { link: page("contact", "Contact") },
          { link: custom(`${brand.site}/blog/`, "Blog") },
        ],
      },
      {
        title: "Regions",
        links: pages
          .filter((entry) => entry.slug.startsWith("headless-cms-agency-"))
          .slice(0, 6)
          .map((entry) => ({
            link: internal("pages", entry.id, entry.slug.replace("headless-cms-agency-", "")),
          })),
      },
    ],
    socials: [
      { network: "linkedin", url: "https://www.linkedin.com/company/turboreactive" },
      { network: "github", url: "https://github.com/turboreactive" },
    ],
    legal: para(
      `${brand.name} B.V., ${catalog.facts.offices.join(" and ")}. Founded in ${catalog.facts.founded}.`
    ),
  });
  await updateGlobal("site-settings", {
    siteName: brand.name,
    tagline: "Headless CMS websites that editors like to use",
    contactEmail: `hello@${brand.domain}`,
    defaultOgImage: backgrounds[0],
    postsPerPage: 12,
    showReadingTime: true,
    scripts: { analytics: { provider: "plausible", domain: brand.domain }, consent: true },
  });
  await updateGlobal("announcement", {
    enabled: true,
    text: fill(`${catalog.facts.starter} ${catalog.facts.starterVersion} is out`),
    link: custom(`${brand.site}/docs/guides/upgrading-to-3/`, "Read the upgrade guide"),
    startsOn: "2026-05-11T09:00:00.000Z",
    endsOn: "2026-06-30T09:00:00.000Z",
  });

  const faultDocuments = await faults.after(
    payload,
    (collection, data) => create(collection, data, false),
    {
      posts: new Map(posts.map((post) => [post.slug, post.id])),
      pages: refs.pages,
      reviews,
    }
  );

  strings.finish();

  await freezeDates(
    payload,
    collections.map((collection) => collection.slug),
    globals.map((global) => global.slug)
  );

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  console.log(
    `[lab] agency: ${total} documents and the media library: ${Object.entries(counts)
      .map(([collection, count]) => `${collection} ${count}`)
      .join(", ")}`
  );

  const documents = Object.fromEntries([
    ...posts.map((post) => [`post:${post.slug}`, { collection: "posts", id: post.id }]),
    ...cases.map((study) => [`case:${study.slug}`, { collection: "case-studies", id: study.id }]),
    ...pages.map((entry) => [`page:${entry.slug}`, { collection: "pages", id: entry.id }]),
    ["page:contact", { collection: "pages", id: contact.id }],
    ...[...refs.sections].map(([key, id]) => [`section:${key}`, { collection: "sections", id }]),
  ]) as Record<string, { collection: string; id: Id }>;

  return { documents: { ...documents, ...faultDocuments }, faults: faults.manifest };
}
