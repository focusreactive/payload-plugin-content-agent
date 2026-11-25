import { describe, expect, it } from "vitest";
import { findRelabelledLinks, lostTargetWords } from "../src/agent/content/linkLabels.js";
import type { SchemaField } from "../src/types.js";

const fields = [
  { name: "title", type: "text" },
  {
    name: "layout",
    type: "blocks",
    blocks: [
      {
        slug: "related",
        fields: [
          { name: "heading", type: "text" },
          {
            name: "articles",
            type: "array",
            fields: [
              { name: "title", type: "text" },
              { name: "image", type: "upload", relationTo: "media" },
              { name: "link", type: "text" },
            ],
          },
          {
            name: "tags",
            type: "array",
            fields: [
              {
                name: "link",
                type: "group",
                fields: [
                  { name: "type", type: "radio" },
                  { name: "label", type: "text" },
                  { name: "reference", type: "relationship", relationTo: ["pages", "posts"] },
                  { name: "url", type: "text" },
                ],
              },
            ],
          },
        ],
      },
      {
        slug: "cards",
        fields: [
          {
            name: "items",
            type: "array",
            fields: [
              { name: "title", type: "text" },
              { name: "text", type: "richText" },
              { name: "link", type: "group", fields: [{ name: "url", type: "text" }] },
            ],
          },
        ],
      },
    ],
  },
] as SchemaField[];

const body = (text: string) => ({ root: { children: [{ type: "paragraph", text }] } });
const makeDoc = () => ({
  id: 1,
  title: "Agency for the Netherlands",
  layout: [
    {
      id: "b1",
      blockType: "related",
      heading: "Read more",
      articles: [
        {
          id: "a1",
          title: "Choosing a headless CMS",
          image: 7,
          link: "https://site.example/choosing-a-headless-cms/",
        },
      ],
      tags: [
        {
          id: "t1",
          link: {
            type: "reference",
            label: "Canada",
            reference: { relationTo: "pages", value: 171 },
          },
        },
      ],
    },
    {
      id: "b2",
      blockType: "cards",
      items: [
        { id: "c1", title: "Migration", text: body("We migrate."), link: { url: "/services/" } },
      ],
    },
  ],
});

describe("findRelabelledLinks", () => {
  it("finds a label that changed next to a link that did not", () => {
    const before = makeDoc();
    const after = makeDoc();

    after.layout[0].articles![0].title = "A guide for teams in Australia";
    after.layout[0].tags![0].link.label = "Sydney";
    const found = findRelabelledLinks(fields, before, after);

    expect(found.map((link) => link.ref)).toEqual([
      "layout[b1].articles[a1].title",
      "layout[b1].tags[t1].link.label",
    ]);
    expect(found[0].targets).toEqual([{ url: "https://site.example/choosing-a-headless-cms/" }]);
    expect(found[1].targets).toEqual([{ collection: "pages", id: 171 }]);
  });

  it("leaves a label alone when its link moved with it, or when only its case changed", () => {
    const before = makeDoc();
    const after = makeDoc();

    after.layout[0].articles![0].title = "CHOOSING A HEADLESS CMS";
    after.layout[0].tags![0].link.label = "Sydney";
    after.layout[0].tags![0].link.reference.value = 300;

    expect(findRelabelledLinks(fields, before, after)).toEqual([]);
  });

  it("does not read the title of a card with its own text as the label of its link", () => {
    const before = makeDoc();
    const after = makeDoc();

    after.layout[1].items![0].title = "Migration for Australian teams";
    after.layout[0].heading = "More for Australia";
    after.title = "Agency for Australia";

    expect(findRelabelledLinks(fields, before, after)).toEqual([]);
  });
});

const card = () => ({
  id: 1,
  cards: [{ id: "c1", title: "Pricing", page: 20, author: 3, style: { variant: "light" } }],
});

describe("a link repointed at the document itself", () => {
  it("is found, and restore puts the label and the target back", () => {
    const before = makeDoc();
    const after = makeDoc();

    after.layout[0].tags![0].link.label = "Australia";
    after.layout[0].tags![0].link.reference.value = 1;
    const found = findRelabelledLinks(fields, before, after, { collection: "pages", id: 1 });

    expect(found.map((link) => [link.kind, link.ref])).toEqual([
      ["self", "layout[b1].tags[t1].link.label"],
    ]);
    found[0].restore();
    expect(after).toEqual(before);
  });

  it("restore leaves the other relationships and groups of the level as the edit made them", () => {
    const cardFields = [
      {
        name: "cards",
        type: "array",
        fields: [
          { name: "title", type: "text" },
          { name: "page", type: "relationship", relationTo: "pages" },
          { name: "author", type: "relationship", relationTo: "users" },
          { name: "style", type: "group", fields: [{ name: "variant", type: "select" }] },
        ],
      },
    ] as SchemaField[];
    const before = card();
    const after = card();

    Object.assign(after.cards[0], {
      title: "Home",
      page: 1,
      author: 4,
      style: { variant: "dark" },
    });
    const found = findRelabelledLinks(cardFields, before, after, { collection: "pages", id: 1 });

    expect(found.map((link) => link.kind)).toEqual(["self"]);
    found[0].restore();
    expect(after.cards[0]).toEqual({
      id: "c1",
      title: "Pricing",
      page: 20,
      author: 4,
      style: { variant: "dark" },
    });
  });

  it("restore of a relabelled link puts only the label back", () => {
    const before = makeDoc();
    const after = makeDoc();

    after.title = "Agency for Australia";
    after.layout[0].tags![0].link.label = "Sydney";
    findRelabelledLinks(fields, before, after)[0].restore();

    expect(after.layout[0].tags![0].link.label).toBe("Canada");
    expect(after.title).toBe("Agency for Australia");
  });
});

describe("lostTargetWords", () => {
  it("is true when the new label drops the words that named the target", () => {
    expect(lostTargetWords({ from: "Canada", to: "Sydney" }, ["Development Agency Canada"])).toBe(
      true
    );
    expect(
      lostTargetWords({ from: "Choosing a headless CMS", to: "A guide for teams in Australia" }, [
        "/choosing-a-headless-cms/",
      ])
    ).toBe(true);
  });

  it("is false when the naming words stay, and when the old label never named the target", () => {
    expect(
      lostTargetWords(
        {
          from: "Headless CMS workflows for German teams",
          to: "Headless CMS workflows for French teams",
        },
        ["/blog/headless-cms-workflows"]
      )
    ).toBe(false);
    expect(lostTargetWords({ from: "Plan a workflow", to: "Talk to us" }, ["/contact"])).toBe(
      false
    );
    expect(lostTargetWords({ from: "Canada", to: "Sydney" }, [])).toBe(false);
  });
});
