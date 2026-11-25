import { describe, it, expect, vi } from "vitest";
import {
  shrinkRatioFor,
  shrinkError,
  findShrunkFields,
  findLostProtectedValues,
  findNewDuplicates,
  duplicatePassage,
  SHRINK_RATIO,
  TRANSLATION_SHRINK_RATIO,
} from "../src/agent/content/guards.js";
import {
  checkCriteria,
  createOutcomeTools,
  declaresShorter,
} from "../src/agent/content/outcomeCriteria.js";
import { isTypographicNeedle } from "../src/agent/content/outcomeText.js";
import type { OutcomeState } from "../src/agent/content/outcomeCriteria.js";
import { createDocumentRewriteTools } from "../src/agent/content/documentRewrite.js";
import { createBlockTools } from "../src/agent/content/blockTools.js";
import { createRichTextTools } from "../src/agent/content/richtextTools.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const opts = { toolCallId: "t", messages: [] } as any;
const text = (t: string) => ({
  type: "text",
  version: 1,
  text: t,
  format: 0,
  detail: 0,
  mode: "normal",
  style: "",
});
const lexPara = (t: string) => ({
  type: "paragraph",
  version: 1,
  direction: "ltr",
  format: "",
  indent: 0,
  children: [text(t)],
});
const rt = (...children: any[]) => ({
  root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children },
});
const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "contentMarkdown", type: "textarea" },
        { name: "content", type: "richText", editor: "lexical" },
        {
          name: "layout",
          type: "blocks",
          blocks: [
            {
              slug: "cta",
              fields: [
                { name: "title", type: "text" },
                { name: "text", type: "textarea" },
              ] as SchemaField[],
            },
          ],
        },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};
const fields = schema.collections[0].fields;
const para = (i: number) =>
  `Paragraph ${i} of the article. ${"It says something useful about headless CMS architecture. ".repeat(6)}`;
const body = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");
const DISCLAIMER =
  "This article reflects the state of the market in 2026 and is not legal or financial advice of any kind.";

describe('editContent: an error before any document is touched reads as an error, not "done"', () => {
  it("a malformed where / nothing to continue", async () => {
    const { createContentEditorTools } = await import("../src/agent/content/contentEditor.js");
    const tools = createContentEditorTools({
      io: { list: vi.fn() } as any,
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const out: any = await tools.editContent.execute!(
      { collection: "posts", where: "nope", instruction: "x" } as any,
      opts
    );
    const shown = (tools.editContent as any).toModelOutput({ output: out }).value;

    expect(shown).toMatch(/error/u);
    expect(shown).not.toMatch(/done/u);
    const tr: any = await tools.translateContent.execute!(
      { collection: "posts", continue: true } as any,
      opts
    );

    expect((tools.translateContent as any).toModelOutput({ output: tr }).value).toMatch(
      /error - Nothing to continue/u
    );
  });
});

describe("shrink guard follows the task", () => {
  it("is off when the editor declared a shorter text, lower for a translation", () => {
    expect(shrinkRatioFor(true)).toBeNull();
    expect(shrinkRatioFor(true, true)).toBeNull();
    expect(shrinkRatioFor(false)).toBe(SHRINK_RATIO);
    expect(shrinkRatioFor(false, true)).toBe(TRANSLATION_SHRINK_RATIO);
  });
  it("a CJK translation at a third of the length is kept, a fragment is not", () => {
    const en = "x".repeat(3000);

    expect(
      findShrunkFields(
        fields,
        { contentMarkdown: en },
        { contentMarkdown: "y".repeat(1100) },
        TRANSLATION_SHRINK_RATIO
      )
    ).toEqual([]);
    expect(
      findShrunkFields(
        fields,
        { contentMarkdown: en },
        { contentMarkdown: "y".repeat(60) },
        TRANSLATION_SHRINK_RATIO
      )
    ).toHaveLength(1);
    expect(
      findShrunkFields(fields, { contentMarkdown: en }, { contentMarkdown: "y" }, null)
    ).toEqual([]);
    expect(shrinkError("body", "x".repeat(400), "x".repeat(100), null)).toBeNull();
  });
  it("setValues writes a shortened body when the task asks for it", () => {
    const doc = { id: 1, contentMarkdown: body };
    const t = createBlockTools({ ref: { current: doc }, collection: "posts" } as any, schema, {
      shrinkRatio: () => null,
    });

    return (t.setValues.execute as any)(
      { edits: [{ ref: "contentMarkdown", value: para(0) }] },
      opts
    ).then((r: any) => {
      expect(JSON.stringify(r)).not.toMatch(/content lost/u);
      expect(doc.contentMarkdown).toBe(para(0));
    });
  });
});

describe("typography criteria are matched exactly", () => {
  it('"replace em dashes with hyphens" can pass', () => {
    expect(isTypographicNeedle("—")).toBe(true);
    expect(isTypographicNeedle(": ")).toBe(true);
    expect(isTypographicNeedle("industry’s standard")).toBe(false);
    const before = { body: "Fast — and cheap — hosting." };
    const after = { body: "Fast - and cheap - hosting." };
    const r = checkCriteria([{ check: { type: "absent", text: "—" } } as any], before, after);

    expect(r[0].ok).toBe(true);
  });
  it('"add a space after the colon" does not pass without a change', () => {
    const doc = { body: "Note:this matters." };
    const r = checkCriteria([{ check: { type: "present", text: ": " } } as any], doc, doc);

    expect(r[0].ok).toBe(false);
  });
});

describe("protected values", () => {
  it('"3 steps" is not the measure "3 s"', () => {
    expect(
      findLostProtectedValues(
        { t: "Set it up in 3 steps on 10 sites." },
        { t: "Set it up in three steps on ten sites." },
        "rewrite"
      )
    ).toEqual([]);
  });
  it("a translation may re-format a time or a price, an edit may not", () => {
    const before = { t: "Doors open at 12:30, tickets $10." };
    const after = { t: "Ouverture à 12h30, billets 10 $." };

    expect(findLostProtectedValues(before, after, "translate", { isTranslation: true })).toEqual(
      []
    );
    expect(
      findLostProtectedValues(before, { t: "Doors open at 12: 30, tickets $10." }, "fix spacing")
    ).toEqual(["12:30"]);
  });
});

describe("duplicate checks and text kept in two places", () => {
  it("a consistent rewrite of a passage that was already in two blocks is not a new duplicate", () => {
    const before = { a: DISCLAIMER, b: DISCLAIMER };
    const NEW = DISCLAIMER.replace("2026", "2027");

    expect(findNewDuplicates(before, { a: NEW, b: NEW })).toEqual([]);
    expect(
      findNewDuplicates({ a: DISCLAIMER, b: "other" }, { a: DISCLAIMER, b: DISCLAIMER })
    ).toHaveLength(1);
  });
  it("the second copy of a mirrored passage may be updated", () => {
    const original = { a: DISCLAIMER, b: DISCLAIMER };
    const NEW = DISCLAIMER.replace("2026", "2027");
    const current = { a: NEW, b: DISCLAIMER };

    expect(duplicatePassage(current, DISCLAIMER, NEW, original)).toBeNull();
    expect(duplicatePassage({ a: NEW, b: "x" }, "x", NEW, { a: "y", b: "x" })).not.toBeNull();
  });
});

describe("the text pass never overwrites a field another tool changed after the read", () => {
  it("refuses the stale paragraph write and keeps the newer value", async () => {
    const doc: any = { id: 1, title: "T", contentMarkdown: body };
    const ws = { ref: { current: doc }, collection: "posts" } as any;
    const t = createDocumentRewriteTools(ws, schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const n = r.fields.find((f: any) => f.ref === "contentMarkdown").from;

    doc.contentMarkdown = body.replace("Paragraph 11", "Paragraph ELEVEN");
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [n]: para(0).replace("Paragraph 0", "Paragraph ZERO") } },
      opts
    );

    expect(a.ok).toBe(false);
    expect(a.errors[0].error).toMatch(/changed after this readDocumentText/u);
    expect(doc.contentMarkdown).toContain("Paragraph ELEVEN");
  });
  it("several writes against the same read still add up", async () => {
    const doc: any = { id: 1, title: "T", contentMarkdown: body };
    const t = createDocumentRewriteTools(
      { ref: { current: doc }, collection: "posts" } as any,
      schema
    );
    const r: any = await t.readDocumentText.execute!({}, opts);
    const n = r.fields.find((f: any) => f.ref === "contentMarkdown").from;

    expect(
      (
        (await t.applyDocumentText.execute!(
          { token: r.token, text: { [n]: para(0).replace("Paragraph 0", "Paragraph ZERO") } },
          opts
        )) as any
      ).ok
    ).toBe(true);
    expect(
      (
        (await t.applyDocumentText.execute!(
          { token: r.token, text: { [n + 1]: para(1).replace("Paragraph 1", "Paragraph ONE") } },
          opts
        )) as any
      ).ok
    ).toBe(true);
    expect(doc.contentMarkdown).toContain("Paragraph ZERO");
    expect(doc.contentMarkdown).toContain("Paragraph ONE");
  });
});

describe("rich text: moving a paragraph is not a duplicate", () => {
  it("remove + insertAfter of the same text in one batch is applied", async () => {
    const doc: any = { id: 1, content: rt(lexPara(DISCLAIMER), lexPara("Second paragraph.")) };
    const t = createRichTextTools({ ref: { current: doc }, collection: "posts" } as any, schema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "content",
        mode: "surgical",
        edits: [
          { key: "0", action: "remove", expectedText: "This article reflects" },
          { key: "1", action: "insertAfter", markdown: DISCLAIMER },
        ],
      } as any,
      opts
    );

    expect(r.error).toBeUndefined();
    expect(JSON.stringify(doc.content)).toContain(DISCLAIMER);
  });
  it("inserting a paragraph the Markdown body already has is still refused", async () => {
    const doc: any = {
      id: 1,
      contentMarkdown: DISCLAIMER,
      content: rt(lexPara("First paragraph.")),
    };
    const t = createRichTextTools({ ref: { current: doc }, collection: "posts" } as any, schema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "content",
        mode: "surgical",
        edits: [{ key: "0", action: "insertAfter", markdown: DISCLAIMER }],
      } as any,
      opts
    );

    expect(r.error).toMatch(/same text twice/u);
  });
});

describe("insertItem: a second item with the same title", () => {
  it("is refused by default and allowed with sameTitle", async () => {
    const doc: any = {
      id: 1,
      layout: [{ id: "c1", blockType: "cta", title: "Get started", text: "Book a call" }],
    };
    const t = createBlockTools({ ref: { current: doc }, collection: "posts" } as any, schema);
    const refused: any = await t.insertItem.execute!(
      { path: "layout", blockType: "cta", fields: { title: "Get started" } } as any,
      opts
    );

    expect(refused.error).toMatch(/sameTitle: true/u);
    const ok: any = await t.insertItem.execute!(
      {
        path: "layout",
        blockType: "cta",
        fields: { title: "Get started" },
        sameTitle: true,
      } as any,
      opts
    );

    expect(ok.ok).toBe(true);
    expect(doc.layout).toHaveLength(2);
  });
});

describe("bulk resume state", () => {
  it("is read from the durable store for this conversation, and not kept at all without one", async () => {
    const { createContentEditorTools } = await import("../src/agent/content/contentEditor.js");
    const store = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    const withConv = createContentEditorTools({
      io: { list: vi.fn() } as any,
      schema,
      model: {} as any,
      concurrency: 5,
      telemetry: null,
      conversationId: "conv-1",
      pendingStore: store,
    });
    const r: any = await withConv.editContent.execute!(
      { collection: "posts", continue: true } as any,
      opts
    );

    expect(r.error).toMatch(/Nothing to continue/u);
    expect(store.get).toHaveBeenCalledWith("conv-1", "editContent", "posts");
    const anon = createContentEditorTools({
      io: { list: vi.fn() } as any,
      schema,
      model: {} as any,
      concurrency: 5,
      telemetry: null,
      pendingStore: store,
    });

    store.get.mockClear();
    const r2: any = await anon.editContent.execute!(
      { collection: "posts", continue: true } as any,
      opts
    );

    expect(r2.error).toMatch(/Nothing to continue/u);
    expect(store.get).not.toHaveBeenCalled();
  });
});

const session = () => {
  const outcome: OutcomeState = { criteria: [] };
  const doc = { id: 1, contentMarkdown: body };
  const blocks = createBlockTools({ ref: { current: doc }, collection: "posts" } as any, schema, {
    shrinkRatio: () => shrinkRatioFor(declaresShorter(outcome)),
  });
  const { declareOutcome } = createOutcomeTools(outcome);
  const write = (): Promise<unknown> =>
    (blocks.setValues.execute as any)(
      { edits: [{ ref: "contentMarkdown", value: para(0) }] },
      opts
    );
  const declare = (criteria: { path?: string; check: object }[]) =>
    (declareOutcome.execute as any)(
      { criteria: criteria.map(({ check, ...rest }) => ({ ...rest, ...check })) },
      opts
    );

  return { doc, write, declare };
};

describe("a shorter text is declared, not read from the words of the task", () => {
  const shorter = { check: { type: "shorter" as const } };
  const unchangedTitle = { path: "title", check: { type: "unchanged" as const } };

  it("refuses a fragment and names the criterion to declare", async () => {
    const { doc, write } = session();
    const refused = JSON.stringify(await write());

    expect(refused).toMatch(/content lost/u);
    expect(refused).toContain('declareOutcome with a \\"shorter\\" criterion');
    expect(doc.contentMarkdown).toBe(body);
  });

  it("accepts the same write after the editor declared a shorter text", async () => {
    const { doc, write, declare } = session();

    await write();
    await declare([shorter]);

    expect(JSON.stringify(await write())).not.toMatch(/content lost/u);
    expect(doc.contentMarkdown).toBe(para(0));
  });

  it("refuses again when a later declaration leaves the criterion out", async () => {
    const { doc, write, declare } = session();

    await declare([shorter]);
    await declare([unchangedTitle]);

    expect(JSON.stringify(await write())).toMatch(/content lost/u);
    expect(doc.contentMarkdown).toBe(body);
  });

  it("checks after the save that the text did get shorter", () => {
    const before = { contentMarkdown: "x".repeat(400) };
    const [met] = checkCriteria([shorter], before, { contentMarkdown: "x".repeat(150) });
    const [unmet] = checkCriteria([shorter], before, { contentMarkdown: "x".repeat(400) });
    const [scoped] = checkCriteria(
      [{ path: "contentMarkdown", check: { type: "shorter" as const } }],
      { title: "A", contentMarkdown: "x".repeat(400) },
      { title: "A longer title", contentMarkdown: "x".repeat(150) }
    );

    expect(met.ok).toBe(true);
    expect(unmet.ok).toBe(false);
    expect(unmet.detail).toContain("400 characters against 400 before");
    expect(scoped.ok).toBe(true);
  });

  it("counts the characters of a text that has a declared limit", () => {
    const limit = [{ path: "summary", check: { type: "lengthAtMost" as const, n: 160 } }];
    const [met] = checkCriteria(limit, {}, { summary: "x".repeat(160) });
    const [unmet] = checkCriteria(limit, {}, { summary: "x".repeat(167) });

    expect(met.ok).toBe(true);
    expect(unmet.ok).toBe(false);
    expect(unmet.detail).toContain("167 characters, and at most 160 were declared: cut 7 or more");
  });
});
