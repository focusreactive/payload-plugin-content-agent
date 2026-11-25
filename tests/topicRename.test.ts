import { describe, expect, it } from "vitest";

import { findIncompleteRename } from "../src/agent/content/topicRename.js";

const page = (product: string, extras: Record<string, any> = {}) => ({
  title: `${product} CMS expert agency`,
  seo: {
    title: `${product} CMS Development Agency`,
    description: `${product} development agency with production deployments. We build with ${product}.`,
  },
  blocks: [
    {
      id: "b1",
      blockType: "hero",
      title: `${product} CMS expert agency`,
      subtitle: `Everything teams need to ship with ${product}.`,
    },
    {
      id: "b2",
      blockType: "offer",
      items: [
        {
          id: "i1",
          title: `Your ${product}, on Autopilot`,
          text: `We run ${product} so your team does not have to.`,
        },
        {
          id: "i2",
          title: `Your Rules, Not ${product} Defaults`,
          text: `${product} shaped around your content model.`,
        },
        {
          id: "i3",
          title: `${product} migrations`,
          text: `Move to ${product} without losing SEO.`,
        },
      ],
    },
    {
      id: "b3",
      blockType: "faq",
      items: [
        { id: "f1", title: `What is ${product} CMS?`, text: `${product} is a headless CMS.` },
      ],
    },
  ],
  ...extras,
});

describe("findIncompleteRename", () => {
  it("says nothing when the rename is complete", () => {
    expect(findIncompleteRename(page("Sanity"), page("Strapi"))).toBeNull();
  });

  it("says nothing about an untouched document", () => {
    expect(findIncompleteRename(page("Sanity"), page("Sanity"))).toBeNull();
  });

  it("catches a rename that left the old product behind", () => {
    const after: any = page("Strapi");

    after.blocks[2].items[0].title = "What is Sanity CMS?";
    after.blocks[1].items[0].title = "Your Sanity, on Autopilot";
    after.blocks[1].items[1].title = "Your Rules, Not Sanity Defaults";
    after.blocks[1].items[2].text = "Move to Sanity without losing SEO.";
    const r = findIncompleteRename(page("Sanity"), after)!;

    expect(r).not.toBeNull();
    expect(r.from).toBe("Sanity");
    expect(r.to).toBe("Strapi");
    expect(r.leftovers.length).toBe(4);
    expect(r.leftovers.map((l) => l.path).join(" ")).toMatch(/blocks\[b2\]|blocks\[b3\]/u);
  });

  it("puts a surviving URL first: a wrong destination is worse than a stray word", () => {
    const before = page("Sanity", {
      related: [
        {
          id: "r1",
          title: "Sanity CMS overview",
          link: "https://my-agency.example/sanity-cms-overview/",
        },
        {
          id: "r2",
          title: "Sanity customization",
          link: "https://my-agency.example/sanity-customization/",
        },
      ],
    });
    const after = page("Strapi", {
      related: [
        {
          id: "r1",
          title: "Strapi CMS overview",
          link: "https://my-agency.example/sanity-cms-overview/",
        },
        {
          id: "r2",
          title: "Strapi customization",
          link: "https://my-agency.example/sanity-customization/",
        },
      ],
    });
    const r = findIncompleteRename(before, after)!;

    expect(r.from).toBe("Sanity");
    expect(r.leftovers[0].text).toMatch(/^https?:\/\//u);
    expect(r.leftovers.map((l) => l.text).join(" ")).toContain("sanity-cms-overview");
  });

  it("does not fire on a page that merely mentions another product", () => {
    const before = page("Strapi");
    const after = page("Strapi") as any;

    after.blocks[2].items.push({
      id: "f2",
      title: "Strapi vs Sanity?",
      text: "Sanity is a different trade-off.",
    });
    expect(findIncompleteRename(before, after)).toBeNull();
  });

  it("stays out of a translation, where the source language is the point", () => {
    const before = page("Sanity");
    const after = page("Strapi");

    expect(findIncompleteRename(before, after, { isTranslation: true })).toBeNull();
  });
});

const ru = (product: string) => ({
  title: `${product} агентство`,
  blocks: Array.from({ length: 12 }, (_, i) => ({
    id: `b${i}`,
    blockType: "card",
    text: `Работаем с ${product} много лет`,
    note: `${product} это headless CMS`,
  })),
});
const es = (p: string) => ({
  title: `Agencia ${p}`,
  blocks: Array.from({ length: 12 }, (_, i) => ({
    id: `b${i}`,
    blockType: "card",
    text: `Éxito con ${p} en producción`,
  })),
});
const ja = (p: string) => ({
  title: `${p}の代理店`,
  blocks: Array.from({ length: 12 }, (_, i) => ({
    id: `b${i}`,
    blockType: "card",
    text: `私たちは${p}を使います`,
  })),
});

const de = (name: string, count: number) => ({
  blocks: Array.from({ length: count }, (_, i) => ({
    id: `b${i}`,
    blockType: "card",
    text: `Die Kunden lieben ${name}, weil die Plattform die Arbeit leicht macht.`,
  })),
});

describe("scripts other than English", () => {
  it("fires on Cyrillic, not only on ASCII letters", () => {
    const after: any = ru("Страпи");

    after.blocks[0].text = "Работаем с Санити много лет";
    const r = findIncompleteRename(ru("Санити"), after)!;

    expect(r).not.toBeNull();
    expect(r.from).toBe("Санити");
    expect(r.to).toBe("Страпи");
  });

  it("fires on accented Latin", () => {
    const after: any = es("Strapi");

    after.blocks[0].text = "Éxito con Sanity en producción";
    expect(findIncompleteRename(es("Sanity"), after)?.from).toBe("Sanity");
  });

  it("reads no capitalized word of the language as a name, and no shortened text as a rename", () => {
    const shorter: any = de("Globex", 5);

    for (let i = 0; i < 7; i += 1) shorter.blocks.push({ id: `g${i}`, text: "Globex hilft." });
    expect(findIncompleteRename(de("Acme", 12), shorter)).toBeNull();
    const partial: any = de("Globex", 15);

    for (const block of partial.blocks.slice(0, 3))
      block.text = block.text.replace("Globex", "Acme");
    expect(findIncompleteRename(de("Acme", 15), partial)).toMatchObject({
      from: "Acme",
      to: "Globex",
    });
  });

  it("stays silent where a script has no capitals to read", () => {
    const after: any = ja("ストラピ");

    after.blocks[0].text = "私たちはサニティを使います";
    expect(findIncompleteRename(ja("サニティ"), after)).toBeNull();
  });
});
