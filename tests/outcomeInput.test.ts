import { asSchema } from "ai";
import { describe, expect, it } from "vitest";

import { createOutcomeTools } from "../src/agent/content/outcomeCriteria.js";
import type { OutcomeState } from "../src/agent/content/outcomeCriteria.js";
import { declareOutcomeInput, readCriteria } from "../src/agent/content/outcomeInput.js";

const opts = { toolCallId: "t", messages: [] } as any;

const errorOf = (input: unknown): string => {
  const read = readCriteria(input);

  return "error" in read ? read.error : "";
};

describe("declareOutcome input: one flat object per criterion", () => {
  it("reads every check type into a criterion", () => {
    const read = readCriteria({
      criteria: [
        { type: "absent", text: "Sanity", why: "the page is about Strapi now" },
        { type: "present", text: "Strapi", path: "title" },
        { type: "countAtMost", text: "GROQ", n: 0 },
        { type: "nonEmpty", path: "intro" },
        { type: "unchanged", path: "blocks[b2].projects" },
        { type: "changed", path: "seo.description" },
        { type: "shorter", path: "content" },
        { type: "lengthAtMost", path: "seo.description", n: 160 },
        { type: "linkCount", path: "content", n: 0 },
        { type: "itemRemoved", path: "layout[b2]" },
        { type: "itemsAdded", path: "layout", n: 1 },
        { type: "judgement", description: "Is the tone formal?" },
      ],
    });

    expect(read).toEqual({
      criteria: [
        { check: { type: "absent", text: "Sanity" }, why: "the page is about Strapi now" },
        { path: "title", check: { type: "present", text: "Strapi" } },
        { check: { type: "countAtMost", text: "GROQ", n: 0 } },
        { path: "intro", check: { type: "nonEmpty" } },
        { path: "blocks[b2].projects", check: { type: "unchanged" } },
        { path: "seo.description", check: { type: "changed" } },
        { path: "content", check: { type: "shorter" } },
        { path: "seo.description", check: { type: "lengthAtMost", n: 160 } },
        { path: "content", check: { type: "linkCount", n: 0 } },
        { path: "layout[b2]", check: { type: "itemRemoved" } },
        { path: "layout", check: { type: "itemsAdded", n: 1 } },
        { check: { type: "judgement", description: "Is the tone formal?" } },
      ],
    });
  });

  it("reads an empty value of a field the type does not use as not sent", () => {
    const read = readCriteria({
      criteria: [{ type: "unchanged", path: null, text: "", n: null, description: "", why: null }],
    });

    expect(read).toEqual({ criteria: [{ check: { type: "unchanged" } }] });
  });

  it("shows the model the types as one list of values on a flat object", async () => {
    const schema: any = await asSchema(declareOutcomeInput).jsonSchema;
    const criterion = schema.properties.criteria.items;

    expect(criterion.properties.type.enum).toContain("shorter");
    expect(criterion.required).toEqual(["type"]);
    expect(Object.keys(criterion.properties).sort()).toEqual(
      ["description", "n", "path", "text", "type", "why"].sort()
    );
  });
});

describe("declareOutcome input: a wrong shape gets a refusal that names the valid one", () => {
  const typeAsKey = [
    { criteria: [{ path: "content", check: { judgement: "The two links are unwrapped." } }] },
    {
      criteria: [
        {
          path: "content",
          check: { absent: "https://example.org/style-guide" },
          why: "The style guide link must be plain text.",
        },
      ],
    },
  ];

  it.each(typeAsKey)("names the missing type, the keys sent and the shape: %j", (input) => {
    const error = errorOf(input);

    expect(error).toContain('criteria[0]: "type" is missing (the keys sent: path, check');
    expect(error).toContain('one of "absent", "present", "countAtMost"');
    expect(error).toContain("Call declareOutcome again");
  });

  it("names an unknown type and the valid values", () => {
    expect(errorOf({ criteria: [{ type: "removed", text: "x" }] })).toContain(
      'criteria[0]: "type" is "removed", it must be one of "absent"'
    );
  });

  it("names the field a type needs", () => {
    expect(errorOf({ criteria: [{ type: "absent" }] })).toContain('"absent" needs "text"');
    expect(errorOf({ criteria: [{ type: "countAtMost", text: "x" }] })).toContain('needs "n"');
    expect(errorOf({ criteria: [{ type: "countAtMost", text: "x", n: -1 }] })).toContain(
      'needs "n"'
    );
    expect(errorOf({ criteria: [{ type: "linkCount" }] })).toContain('"linkCount" needs "n"');
    expect(errorOf({ criteria: [{ type: "lengthAtMost", n: 160 }] })).toContain(
      '"lengthAtMost" needs "path"'
    );
    expect(errorOf({ criteria: [{ type: "linkCount", n: -1 }] })).toContain(
      'To keep every link, declare no "linkCount"'
    );
    expect(errorOf({ criteria: [{ type: "itemsAdded", n: 1 }] })).toContain(
      '"itemsAdded" needs "path"'
    );
    expect(errorOf({ criteria: [{ type: "itemsAdded", path: "layout" }] })).toContain(
      '"itemsAdded" needs "n"'
    );
    expect(errorOf({ criteria: [{ type: "itemRemoved" }] })).toContain(
      '"itemRemoved" needs "path"'
    );
    expect(errorOf({ criteria: [{ type: "itemRemoved", path: "layout" }] })).toContain(
      "its id in brackets"
    );
    expect(errorOf({ criteria: [{ type: "judgement" }] })).toContain('needs "description"');
  });

  it("names every wrong criterion by its position", () => {
    const error = errorOf({
      criteria: [{ type: "unchanged" }, "shorter", { type: "present" }, { type: "x", path: 1 }],
    });

    expect(error).toContain("criteria[1]: it is not an object.");
    expect(error).toContain('criteria[2]: "present" needs "text"');
    expect(error).toContain("criteria[3]:");
    expect(error).not.toContain("criteria[0]");
  });

  it("refuses a missing, an empty and an oversized list", () => {
    const tooMany = Array.from({ length: 21 }, () => ({ type: "nonEmpty" }));

    for (const input of [
      undefined,
      {},
      { criteria: [] },
      { criteria: "shorter" },
      { criteria: tooMany },
    ])
      expect(errorOf(input)).toContain('"criteria" must be a list of 1 to 20 criteria.');
  });

  it("declares nothing and keeps the earlier contract when one criterion is wrong", async () => {
    const state: OutcomeState = { criteria: [] };
    const { declareOutcome } = createOutcomeTools(state);
    const declare = (criteria: unknown[]) => (declareOutcome.execute as any)({ criteria }, opts);

    await declare([{ type: "shorter" }]);
    const refused = await declare([{ type: "unchanged", path: "title" }, { check: "shorter" }]);

    expect(refused.error).toContain("Nothing was declared.");
    expect(state.criteria).toEqual([{ check: { type: "shorter" } }]);
    expect(state.dropped).toBeUndefined();
  });
});

const declare = (document: unknown, criteria: object[]) => {
  const state: OutcomeState = { criteria: [] };
  const { declareOutcome } = createOutcomeTools(state, () => document);

  return (declareOutcome.execute as any)({ criteria }, opts).then((result: any) => ({
    result,
    state,
  }));
};

describe("declareOutcome: a criterion the document cannot meet is refused when it is declared", () => {
  const document = { title: "A", body: { root: { children: [] } }, layout: [], faq: [{ id: "1" }] };

  it("refuses itemsAdded on a field that holds no items and names the fields that do", async () => {
    const { result, state } = await declare(document, [
      { type: "present", path: "body", text: "A line" },
      { type: "itemsAdded", path: "body", n: 1 },
    ]);

    expect(result.error).toContain('itemsAdded at "body"');
    expect(result.error).toContain("layout, faq");
    expect(result.error).toContain("declareOutcome");
    expect(state.criteria).toEqual([]);
  });

  it("takes itemsAdded on an array field and on a field that has no value yet", async () => {
    const onArray = await declare(document, [{ type: "itemsAdded", path: "layout", n: 1 }]);
    const onEmpty = await declare(document, [{ type: "itemsAdded", path: "steps", n: 2 }]);

    expect(onArray.result.ok).toBe(true);
    expect(onEmpty.result.ok).toBe(true);
    expect(onArray.state.criteria).toHaveLength(1);
  });

  it("keeps the criteria of an earlier declaration when a later one is refused", async () => {
    const state: OutcomeState = { criteria: [] };
    const { declareOutcome } = createOutcomeTools(state, () => document);
    const run = (criteria: object[]) => (declareOutcome.execute as any)({ criteria }, opts);

    await run([{ type: "present", path: "body", text: "A line" }]);
    const second = await run([{ type: "itemsAdded", path: "title", n: 1 }]);

    expect(second.error).toContain('"title" is not a blocks or array field');
    expect(state.criteria).toHaveLength(1);
    expect(state.dropped ?? []).toEqual([]);
  });
});
