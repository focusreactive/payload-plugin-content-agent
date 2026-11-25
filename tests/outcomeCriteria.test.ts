import { describe, expect, it } from "vitest";

import {
  checkCriteria,
  createOutcomeTools,
  describeDropped,
  describeFailures,
  judgementQuestions,
} from "../src/agent/content/outcomeCriteria.js";
import type { Criterion, OutcomeState } from "../src/agent/content/outcomeCriteria.js";

const opts = { toolCallId: "t", messages: [] } as any;

const rt = (text: string) => ({
  root: {
    type: "root",
    children: [{ type: "paragraph", version: 1, children: [{ type: "text", text, version: 1 }] }],
    version: 1,
  },
});

const doc = (product: string) => ({
  id: "p1",
  title: `${product} CMS expert agency`,
  seo: { title: `${product} agency`, description: `We build with ${product}.` },
  blocks: [
    {
      id: "b1",
      blockType: "hero",
      title: `${product} experts`,
      body: rt(`Years of ${product} work.`),
    },
    { id: "b2", blockType: "cases", projects: [3, 7, 9] },
  ],
});

const check = (criteria: Criterion[], before: any, after: any) =>
  checkCriteria(criteria, before, after);

describe("checkCriteria", () => {
  it("passes a finished rename and fails a half-finished one", () => {
    const before = doc("Sanity");
    const criteria: Criterion[] = [
      { check: { type: "absent", text: "Sanity" }, why: "the page is about Strapi now" },
    ];

    expect(check(criteria, before, doc("Strapi"))[0].ok).toBe(true);

    const half = doc("Strapi");

    half.blocks[0].title = "Sanity experts";
    const r = check(criteria, before, half)[0];

    expect(r.ok).toBe(false);
    expect(r.detail).toContain("still appears 1 time");
    expect(r.detail).toContain("Sanity experts");
  });

  it("is case-insensitive, so a leftover inside a slug counts", () => {
    const before = doc("Sanity");
    const after: any = doc("Strapi");

    after.seo.description = "See https://my-agency.example/sanity-cms-overview/ for details.";
    const r = check([{ check: { type: "absent", text: "Sanity" } }], before, after)[0];

    expect(r.ok).toBe(false);
    expect(r.detail).toContain("sanity-cms-overview");
  });

  it("protects what must not move", () => {
    const before = doc("Sanity");
    const after: any = doc("Strapi");
    const criteria: Criterion[] = [
      { path: "blocks[b2].projects", check: { type: "unchanged" }, why: "the case studies stay" },
    ];

    expect(check(criteria, before, after)[0].ok).toBe(true);

    after.blocks[1].projects = [3, 7];
    const r = check(criteria, before, after)[0];

    expect(r.ok).toBe(false);
    expect(r.detail).toContain("supposed to stay");
  });

  it("catches a field that was supposed to change and did not", () => {
    const before = doc("Sanity");
    const after = doc("Sanity");
    const r = check([{ path: "seo.description", check: { type: "changed" } }], before, after)[0];

    expect(r.ok).toBe(false);
    expect(r.detail).toContain("identical");
  });

  it("scopes a check to one field", () => {
    const before = doc("Sanity");
    const after: any = doc("Strapi");

    after.seo.description = "Still about Sanity.";
    expect(
      check([{ path: "blocks[b1]", check: { type: "absent", text: "Sanity" } }], before, after)[0]
        .ok
    ).toBe(true);
    expect(check([{ check: { type: "absent", text: "Sanity" } }], before, after)[0].ok).toBe(false);
  });

  it("fails a criterion whose path does not resolve, rather than passing it", () => {
    const r = check(
      [{ path: "blocks[nope].title", check: { type: "nonEmpty" } }],
      doc("Sanity"),
      doc("Strapi")
    )[0];

    expect(r.ok).toBe(false);
    expect(r.detail).toContain("holds nothing in the edited document");
  });

  it("holds unchanged and absent on a field that the document leaves out", () => {
    const results = check(
      [
        { path: "subtitle", check: { type: "unchanged" } },
        { path: "subtitle", check: { type: "absent", text: "Sanity" } },
        { path: "subtitle", check: { type: "present", text: "Sanity" } },
      ],
      doc("Sanity"),
      doc("Strapi")
    );

    expect(results.map((result) => result.ok)).toEqual([true, true, false]);
    expect(results[2].detail).toContain("holds nothing in the edited document");
  });

  it("reads rich text, not just plain fields", () => {
    const before = doc("Sanity");
    const after: any = doc("Strapi");

    after.blocks[0].body = rt("Years of Sanity work.");
    const r = check([{ check: { type: "absent", text: "Sanity" } }], before, after)[0];

    expect(r.ok).toBe(false);
    expect(r.detail).toContain("Years of Sanity work.");
  });

  it("reads content only: not the timestamps, the status or how rich text is shown", () => {
    const shown = {
      root: {
        type: "root",
        direction: "ltr",
        format: "center",
        version: 1,
        children: [
          {
            type: "paragraph",
            version: 1,
            children: [
              { type: "text", text: "Prices of 2026", mode: "normal", format: 0, version: 1 },
              {
                type: "link",
                version: 1,
                fields: { url: "https://x.io/2026", linkType: "custom", newTab: false },
                children: [{ type: "text", text: "plans", mode: "normal", version: 1 }],
              },
            ],
          },
        ],
      },
    };
    const page = {
      id: "p1",
      title: "Plans for 2026",
      body: shown,
      createdAt: "2025-06-01T10:00:00.000Z",
      updatedAt: "2025-06-02T10:00:00.000Z",
      _status: "draft",
    };
    const results = check(
      ["2025", "normal", "center", "custom", "ltr", "draft"].map((text) => ({
        check: { type: "absent", text },
      })),
      page,
      page
    );

    expect(results.filter((r) => !r.ok).map((r) => r.detail)).toEqual([]);
    expect(check([{ check: { type: "present", text: "x.io/2026" } }], page, page)[0].ok).toBe(true);
  });

  it("reads the ids of a reference list and other stored numbers", () => {
    const before = { id: "p1", tags: [21] };
    const after = { id: "p1", tags: [21, 64], year: 2026 };
    const results = check(
      [
        { path: "tags", check: { type: "present", text: "64" } },
        { path: "tags", check: { type: "present", text: "21" } },
        { path: "tags", check: { type: "nonEmpty" } },
        { path: "tags", check: { type: "absent", text: "49" } },
        { check: { type: "present", text: "2026" } },
      ],
      before,
      after
    );

    expect(results.filter((r) => !r.ok).map((r) => r.detail)).toEqual([]);
    expect(
      describeDropped([{ path: "tags", check: { type: "present", text: "64" } }], before, after)
    ).toEqual([]);
  });

  it("reads a content field whatever its name, also type or version", () => {
    const page = { id: "p1", title: "New", type: "Acme partner", version: "Acme 2" };
    const [r] = check([{ check: { type: "absent", text: "Acme" } }], page, page);

    expect(r.ok).toBe(false);
    expect(r.detail).toContain("2 time(s)");
  });

  it("counts occurrences when a few are legitimate", () => {
    const before = doc("Sanity");
    const after: any = doc("Strapi");

    after.seo.description = "Unlike Sanity, Strapi is self-hosted.";
    expect(
      check([{ check: { type: "countAtMost", text: "Sanity", n: 1 } }], before, after)[0].ok
    ).toBe(true);
    after.blocks[0].title = "Sanity experts";
    expect(
      check([{ check: { type: "countAtMost", text: "Sanity", n: 1 } }], before, after)[0].ok
    ).toBe(false);
  });

  it("defers a judgement instead of guessing at it", () => {
    const r = check(
      [{ check: { type: "judgement", description: "Does the tone match the rest of the site?" } }],
      doc("a"),
      doc("b")
    );

    expect(r[0].ok).toBe(true);
    expect(r[0].deferred).toBe(true);
    expect(judgementQuestions(r)).toEqual(["Does the tone match the rest of the site?"]);
  });

  it("writes failures the editor can act on", () => {
    const before = doc("Sanity");
    const after: any = doc("Strapi");

    after.blocks[0].title = "Sanity experts";
    const text = describeFailures(
      check(
        [
          {
            path: "blocks[b1].title",
            check: { type: "absent", text: "Sanity" },
            why: "renamed to Strapi",
          },
        ],
        before,
        after
      )
    );

    expect(text).toContain("at blocks[b1].title");
    expect(text).toContain("renamed to Strapi");
  });
});

describe("declareOutcome", () => {
  it("records the contract and reports how much of it is mechanical", async () => {
    const state = { criteria: [] as Criterion[] };
    const t = createOutcomeTools(state);
    const r: any = await t.declareOutcome.execute!(
      {
        criteria: [
          { type: "absent", text: "Sanity" },
          { path: "blocks[b2].projects", type: "unchanged" },
          { type: "judgement", description: "Is the copy persuasive?" },
        ],
      },
      opts
    );

    expect(r.declared).toBe(3);
    expect(r.checkedMechanically).toBe(2);
    expect(state.criteria).toHaveLength(3);
  });
});

const absent = (text: string) => ({ check: { type: "absent" as const, text } });
const declare = (state: any, criteria: any[], document?: unknown) =>
  createOutcomeTools(state, document === undefined ? undefined : () => document).declareOutcome
    .execute!(
    { criteria: criteria.map(({ check: spec, ...rest }) => ({ ...rest, ...spec })) },
    opts
  ) as Promise<any>;

describe("declareOutcome: a later declaration changes the contract with a trace", () => {
  it("names the added and the dropped criteria and keeps the dropped ones", async () => {
    const state: OutcomeState = { criteria: [] };

    await declare(state, [absent("Sanity"), absent("GROQ")]);
    const second = await declare(state, [absent("GROQ"), absent("Contentful")]);

    expect(second.added).toEqual(['absent "Contentful"']);
    expect(second.dropped).toEqual(['absent "Sanity"']);
    expect(second.note).toContain("dropped 1 criterion");
    expect(state.criteria).toHaveLength(2);
    expect(state.dropped).toEqual([absent("Sanity")]);
  });

  it("says nothing about a change on the first declaration or on the same one again", async () => {
    const state: OutcomeState = { criteria: [] };
    const first = await declare(state, [absent("Sanity")]);
    const again = await declare(state, [{ ...absent("Sanity"), why: "other words" }]);

    expect("dropped" in first).toBe(false);
    expect(again.added).toEqual([]);
    expect(again.dropped).toEqual([]);
    expect(state.dropped).toEqual([]);
  });

  it("takes a criterion off the dropped list when it is declared again", async () => {
    const state: OutcomeState = { criteria: [] };

    await declare(state, [absent("Sanity"), absent("GROQ")]);
    await declare(state, [absent("GROQ")]);
    await declare(state, [absent("GROQ"), absent("Sanity")]);

    expect(state.dropped).toEqual([]);
  });

  it("reports a dropped criterion only when the document does not meet it", () => {
    const before = { title: "Sanity and GROQ" };
    const after = { title: "Sanity and queries" };
    const dropped = describeDropped([absent("Sanity"), absent("GROQ")], before, after);

    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain('absent "Sanity"');
  });

  it("reports a dropped judgement, which no check can decide", () => {
    const dropped = describeDropped(
      [{ check: { type: "judgement", description: "Is the tone formal?" } }],
      {},
      {}
    );

    expect(dropped).toEqual(['judgement "Is the tone formal?"']);
  });

  it("shows the count of the open document for a limit it is over now", async () => {
    const state: OutcomeState = { criteria: [] };
    const document = { title: "Sanity", body: "Sanity is a CMS. Sanity has GROQ." };
    const result = await declare(
      state,
      [
        { check: { type: "countAtMost", text: "Sanity", n: 0 } },
        { check: { type: "countAtMost", text: "GROQ", n: 1 } },
      ],
      document
    );

    expect(result.overLimitNow).toHaveLength(1);
    expect(result.overLimitNow[0]).toContain('"Sanity" appears 3 time(s)');
    expect(result.note).toContain("overLimitNow");
  });
});

const text = (t: string) => ({ type: "text", version: 1, format: 0, text: t });
const link = (url: string, t: string) => ({
  type: "link",
  version: 1,
  fields: { url, linkType: "custom" },
  children: [text(t)],
});
const para = (...c: any[]) => ({ type: "paragraph", version: 1, children: c });
const body = (...children: any[]) => ({
  root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children },
});

describe("checkCriteria: node boundaries are not the page", () => {
  const glued = {
    content: body(
      para(
        text("Lokalise explains how"),
        link("https://lokalise.com/x", "continuous localization"),
        text("removes the bottleneck.")
      )
    ),
  };
  const spaceInside = {
    content: body(
      para(
        text("Lokalise explains how"),
        link("https://lokalise.com/x", " continuous localization "),
        text("removes the bottleneck.")
      )
    ),
  };
  const spaceOutside = {
    content: body(
      para(
        text("Lokalise explains how "),
        link("https://lokalise.com/x", "continuous localization"),
        text(" removes the bottleneck.")
      )
    ),
  };

  it("a needle with a boundary space is not checked, it cannot describe what a reader sees", () => {
    const r = checkCriteria(
      [{ path: "content", check: { type: "countAtMost", text: " continuous localization", n: 0 } }],
      glued,
      spaceInside
    )[0];

    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/node boundary/u);
  });

  it('"unchanged" holds when only the spacing between nodes moved, and fails when a link target moved', () => {
    expect(
      checkCriteria(
        [{ path: "content", check: { type: "unchanged" } }],
        spaceInside,
        spaceOutside
      )[0].ok
    ).toBe(true);
    expect(
      checkCriteria([{ path: "content", check: { type: "unchanged" } }], glued, spaceOutside)[0].ok
    ).toBe(false);
    const repointed = structuredClone(spaceOutside);

    repointed.content.root.children[0].children[1].fields.url = "https://elsewhere.test/";
    expect(
      checkCriteria([{ path: "content", check: { type: "unchanged" } }], spaceOutside, repointed)[0]
        .ok
    ).toBe(false);
  });
});
