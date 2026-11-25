import { describe, it, expect } from "vitest";
import {
  shrinkError,
  findShrunkFields,
  findLostProtectedValues,
} from "../src/agent/content/guards.js";
import { checkCriteria, removalRefusal } from "../src/agent/content/outcomeCriteria.js";
import type { OutcomeState } from "../src/agent/content/outcomeCriteria.js";
import { createDocumentRewriteTools } from "../src/agent/content/documentRewrite.js";
import { createBlockTools } from "../src/agent/content/blockTools.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

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
            { slug: "faq", fields: [{ name: "title", type: "text" }] as SchemaField[] },
            {
              slug: "intro",
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
const text = (t: string) => ({ type: "text", version: 1, text: t });
const rt = (...children: any[]) => ({
  root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children },
});
const lexPara = (...c: any[]) => ({ type: "paragraph", version: 1, children: c });
const opts = { toolCallId: "t", messages: [] } as any;
const para = (i: number) =>
  `Paragraph ${i} of the article. ${"It says something useful about headless CMS architecture. ".repeat(6)}`;
const body = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");

describe("a long text field is offered paragraph by paragraph and rebuilt losslessly", () => {
  it("splits into paragraphs, writes one back, keeps every other byte", async () => {
    const doc = { id: 1, title: "T", contentMarkdown: body };
    const ws = { ref: { current: doc }, collection: "posts" } as any;
    const t = createDocumentRewriteTools(ws, schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const bodyEntries = r.fields.find((f: any) => f.ref === "contentMarkdown");

    expect(bodyEntries.entries).toBe(12);
    const n = bodyEntries.from + 3;
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [n]: para(3).replace("Paragraph 3", "Paragraph THREE") } },
      opts
    );

    expect(a.ok).toBe(true);
    expect(doc.contentMarkdown).toBe(body.replace("Paragraph 3 of", "Paragraph THREE of"));
    expect(doc.contentMarkdown.length).toBe(body.length + 4);
  });
  it("refuses a paragraph that comes back as a fragment", async () => {
    const doc = { id: 1, title: "T", contentMarkdown: body };
    const ws = { ref: { current: doc }, collection: "posts" } as any;
    const t = createDocumentRewriteTools(ws, schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const n = r.fields.find((f: any) => f.ref === "contentMarkdown").from;
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [n]: "Paragraph 0." } },
      opts
    );

    expect(a.ok).toBe(false);
    expect(a.errors[0].error).toMatch(/content lost/u);
    expect(doc.contentMarkdown).toBe(body);
  });
});

describe("shrink guard", () => {
  it("refuses halving a long value, allows real edits and short fields", () => {
    expect(shrinkError("body", "x".repeat(400), "x".repeat(100))).toMatch(
      /shrink from 400 to 100/u
    );
    expect(shrinkError("body", "x".repeat(400), "x".repeat(390))).toBeNull();
    expect(shrinkError("title", "short title", "new")).toBeNull();
  });
  it("setValues refuses to replace a long text field with a line", async () => {
    const doc = { id: 1, title: "T", contentMarkdown: body };
    const t = createBlockTools({ ref: { current: doc }, collection: "posts" } as any, schema);
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "contentMarkdown", value: "Headless CMS Architecture: Guide" }] },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toMatch(/content lost/u);
    expect(doc.contentMarkdown).toBe(body);
  });
  it("findShrunkFields is the save-time backstop", () => {
    const before = { contentMarkdown: "y".repeat(2000), title: "T" };

    expect(findShrunkFields(fields, before, { ...before, contentMarkdown: "gone" })).toEqual([
      { ref: "contentMarkdown", from: 2000, to: 4 },
    ]);
    expect(
      findShrunkFields(fields, before, { ...before, contentMarkdown: "y".repeat(1500) })
    ).toEqual([]);
  });
});

describe("protected values", () => {
  it("reports times, emails and prices that vanished (not URLs), unless the task names them", () => {
    const before = {
      title: "Call at 12:30, see https://example.com/a and write to me@x.io, price $35",
    };
    const after = { title: "Call at 12: 30, see the site and write to me, price 35" };
    const lost = findLostProtectedValues(before, after, "fix the spaces after colons");

    expect(lost).toEqual(expect.arrayContaining(["12:30", "me@x.io"]));
    expect(lost).not.toContain("https://example.com/a");
    expect(
      findLostProtectedValues(
        before,
        { title: "x" },
        "remove the link https://example.com/a and 12:30 and me@x.io and $35"
      )
    ).toEqual([]);
  });
});

describe("protected values in other scripts", () => {
  it("reports a price, a percent and a time written with other digits and signs", () => {
    const before = { text: "السعر ٣٥ ₽ والخصم ١٠٪ في ١٢:٣٠, also 20 ₴ and 5％" };
    const lost = findLostProtectedValues(before, { text: "x" }, "rewrite");

    expect(lost).toEqual(expect.arrayContaining(["١٢:٣٠", "٣٥ ₽", "١٠٪", "20 ₴", "5％"]));
  });

  it("does not take a number inside a word for a value", () => {
    expect(findLostProtectedValues({ text: "build v2s and 3 steps" }, { text: "x" }, "")).toEqual(
      []
    );
  });
});

const removed = (path: string) => ({ path, check: { type: "itemRemoved" as const } });
const layout = () => [
  { id: "a", blockType: "faq", blockName: "Frequently asked questions" },
  { id: "b", blockType: "intro", title: "Business impact", text: "x" },
];

const session = (outcome: OutcomeState) => {
  const doc = { id: 1, layout: layout() };
  const tools = createBlockTools({ ref: { current: doc }, collection: "posts" } as any, schema, {
    remove: (item, path) => removalRefusal(outcome, item, path),
  });
  const remove = (id: string): Promise<any> =>
    (tools.removeItem.execute as any)({ path: "layout", id }, opts);

  return { doc, remove };
};

describe("remove guard: only the declared items may go", () => {
  it("refuses an item that was not declared and names the way out", async () => {
    const { doc, remove } = session({ criteria: [removed("layout[b]")] });
    const refused = await remove("a");

    expect(refused.error).toContain('faq "layout[a]" ("Frequently asked questions")');
    expect(refused.error).toContain('declared for removal ("layout[b]")');
    expect(refused.error).toContain('"itemRemoved" criterion for "layout[a]"');
    expect(doc.layout).toHaveLength(2);
    expect((await remove("b")).ok).toBe(true);
    expect(doc.layout).toHaveLength(1);
  });

  it("reads the declaration at the time of the call", async () => {
    const outcome: OutcomeState = { criteria: [removed("layout[b]")] };
    const { remove } = session(outcome);

    expect((await remove("a")).error).toMatch(/not one of the items declared/u);
    outcome.criteria = [removed("layout[b]"), removed("layout[a]")];
    expect((await remove("a")).ok).toBe(true);
  });

  it("has no guard when no removal is declared", async () => {
    const { remove } = session({ criteria: [{ path: "title", check: { type: "unchanged" } }] });

    expect((await remove("a")).ok).toBe(true);
  });

  it("checks at the end that each declared item is gone", () => {
    const before = { layout: layout() };
    const [gone, kept, unknown] = checkCriteria(
      [removed("layout[a]"), removed("layout[b]"), removed("layout[zzz]")],
      before,
      { layout: [layout()[1]] }
    );

    expect(gone.ok).toBe(true);
    expect(kept.ok).toBe(false);
    expect(kept.detail).toContain("still in the document");
    expect(unknown.ok).toBe(false);
    expect(unknown.detail).toContain("getEditableContent");
  });
});

const added = (path: string, n: number) => ({ path, check: { type: "itemsAdded" as const, n } });

describe("added items are declared, not read from the words of the task", () => {
  const before = { layout: [{ id: "a", blockType: "faq", title: "FAQ" }] };
  const grown = { layout: [...before.layout, { id: "b", blockType: "intro", title: "New" }] };

  it("passes when the container has exactly the declared number of new items", () => {
    expect(checkCriteria([added("layout", 1)], before, grown)[0].ok).toBe(true);
  });

  it("sends back an edit that rewrote the existing items and added none", () => {
    const rewritten = { layout: [{ id: "a", blockType: "faq", title: "Pricing" }] };
    const [result] = checkCriteria([added("layout", 1)], before, rewritten);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("1 item(s) against 1 before");
    expect(result.detail).toContain("insertItem");
  });

  it("counts a container that did not exist before from zero", () => {
    expect(checkCriteria([added("layout", 1)], {}, before)[0].ok).toBe(true);
  });

  it("refuses a path that is not a container and names where the path comes from", () => {
    const [result] = checkCriteria([added("title", 1)], { title: "x" }, { title: "y" });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("getEditableContent");
  });
});

describe("insertItem refuses a duplicate of an existing sibling", () => {
  it("same block type + same title is already there; a different title is fine", async () => {
    const doc = {
      id: 1,
      layout: [{ id: "a", blockType: "intro", title: "Business impact and expertise", text: "x" }],
    };
    const t = createBlockTools({ ref: { current: doc }, collection: "posts" } as any, schema);
    const dup: any = await t.insertItem.execute!(
      { path: "layout", blockType: "intro", fields: { title: "business impact and  expertise" } },
      opts
    );

    expect(dup.error).toMatch(/already exists/u);
    expect(doc.layout).toHaveLength(1);
    const ok: any = await t.insertItem.execute!(
      { path: "layout", blockType: "intro", fields: { title: "Why migrate now" } },
      opts
    );

    expect(ok.ok).toBe(true);
    const noTitle: any = await t.insertItem.execute!({ path: "layout", blockType: "faq" }, opts);

    expect(noTitle.ok).toBe(true);
  });
});

describe("editContent refuses a third session on the same document in one request", () => {
  it("lets two through, refuses the third, and starts fresh on a new request context", async () => {
    const { createContentEditorTools } = await import("../src/agent/content/contentEditor.js");
    const io = {
      read: async () => ({ doc: null, error: "boom" }),
      write: async () => ({}),
      create: async () => ({}),
      list: async () => ({ docs: [], totalPages: 1, totalDocs: 0 }),
      transports: () => ({ read: "local" }),
      lockRefusal: async () => null,
    } as any;
    const tools = createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 1,
    });
    const ctx = {
      toolCallId: "t",
      messages: [],
      context: { requestStartedAt: Date.now(), contentEditorRuns: {} },
    } as any;
    const args = { collection: "posts", id: "1", instruction: "x" };
    const r1: any = await tools.editContent.execute!(args, ctx);
    const r2: any = await tools.editContent.execute!(args, ctx);
    const r3: any = await tools.editContent.execute!(args, ctx);

    expect(r1.error).not.toMatch(/session #/u);
    expect(r2.error).not.toMatch(/session #/u);
    expect(r3.error).toMatch(/session #3/u);
    const fresh: any = await tools.editContent.execute!(args, { ...ctx, context: {} });

    expect(fresh.error).not.toMatch(/session #/u);
  });
});

describe("applyDocumentText append puts a paragraph at the END of a field, deterministically", () => {
  it("appends to the body once (a second prose field is refused), and later applies still rebuild the body", async () => {
    const doc = { id: 1, title: "T", contentMarkdown: body, content: rt(lexPara(text("Intro."))) };
    const ws = { ref: { current: doc }, collection: "posts" } as any;
    const t = createDocumentRewriteTools(ws, schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const a: any = await t.applyDocumentText.execute!(
      {
        token: r.token,
        append: {
          contentMarkdown: "Lorem Ipsum is simply dummy text.",
          content: "Lorem Ipsum is simply dummy text.",
        },
      },
      opts
    );

    expect(a.appended).toBe(1);
    expect(a.errors[0].error).toMatch(/body is "contentMarkdown"/u);
    expect(doc.contentMarkdown).toBe(`${body.trimEnd()}\n\nLorem Ipsum is simply dummy text.`);
    expect(doc.content.root.children).toHaveLength(1);
    const n = r.fields.find((f: any) => f.ref === "contentMarkdown").from;
    const b: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [n]: para(0).replace("Paragraph 0", "Paragraph ZERO") } },
      opts
    );

    expect(b.ok).toBe(true);
    expect(doc.contentMarkdown.endsWith("Lorem Ipsum is simply dummy text.")).toBe(true);
    expect(doc.contentMarkdown).toContain("Paragraph ZERO of");
  });
  it("refuses a later entry for a short field that an append changed, instead of writing over the paragraph", async () => {
    const doc = { id: 1, title: "T", contentMarkdown: "Short intro." };
    const ws = { ref: { current: doc }, collection: "posts" } as any;
    const t = createDocumentRewriteTools(ws, schema);
    const r: any = await t.readDocumentText.execute!({}, opts);
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, append: { contentMarkdown: "Prices exclude VAT." } },
      opts
    );

    expect(a.appended).toBe(1);
    const n = r.fields.find((f: any) => f.ref === "contentMarkdown").from;
    const b: any = await t.applyDocumentText.execute!(
      { token: r.token, text: { [n]: "A short intro." } },
      opts
    );

    expect(JSON.stringify(b.errors)).toMatch(/changed after this readDocumentText/u);
    expect(doc.contentMarkdown).toBe("Short intro.\n\nPrices exclude VAT.");
  });
  it("appends a paragraph node to a rich text body", async () => {
    const doc = { id: 1, title: "T", content: rt(lexPara(text("Intro."))) };
    const t = createDocumentRewriteTools(
      { ref: { current: doc }, collection: "posts" } as any,
      schema
    );
    const r: any = await t.readDocumentText.execute!({}, opts);
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, append: { content: "Lorem Ipsum is simply dummy text." } },
      opts
    );

    expect(a.ok).toBe(true);
    const kids = doc.content.root.children;

    expect(kids).toHaveLength(2);
    expect(kids[1].type).toBe("paragraph");
    expect(kids[1].children[0].text).toBe("Lorem Ipsum is simply dummy text.");
  });
  it("refuses an unknown ref, an empty paragraph, and a call with nothing to do", async () => {
    const doc = { id: 1, title: "T", contentMarkdown: body };
    const t = createDocumentRewriteTools(
      { ref: { current: doc }, collection: "posts" } as any,
      schema
    );
    const r: any = await t.readDocumentText.execute!({}, opts);
    const a: any = await t.applyDocumentText.execute!(
      { token: r.token, append: { nope: "x", contentMarkdown: "  " } },
      opts
    );

    expect(a.ok).toBe(false);
    expect(a.errors.map((e: any) => e.n).sort()).toEqual(["contentMarkdown", "nope"]);
    const none: any = await t.applyDocumentText.execute!({ token: r.token }, opts);

    expect(none.error).toMatch(/Nothing to apply/u);
  });
});

describe("a bulk that stopped for time is resumed with continue:true, ids kept server-side", () => {
  it("stores the remaining ids and resumes them without the model passing ids", async () => {
    const { createContentEditorTools } = await import("../src/agent/content/contentEditor.js");
    const seen: any[] = [];
    const io = {
      read: async (_t: any, o: any) => {
        seen.push(o.id);

        return { doc: null, error: "boom" };
      },
      write: async () => ({}),
      create: async () => ({}),
      list: async () => ({ docs: [], totalPages: 1, totalDocs: 0 }),
      transports: () => ({ read: "local" }),
      lockRefusal: async () => null,
    } as any;
    const tools = createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 1,
      telemetry: null,
      conversationId: "conv-continue",
      bulkTimeBudgetMs: 1_000,
    });
    const spent = {
      toolCallId: "t",
      messages: [],
      context: { requestStartedAt: Date.now() - 60_000 },
    } as any;
    const r1: any = await tools.editContent.execute!(
      { collection: "posts", ids: ["1", "2", "3"], instruction: "append the note" },
      spent
    );

    expect(r1.stoppedForTime).toBe(true);
    expect(r1.remainingCount).toBe(3);
    expect(r1.remaining).toBeUndefined();
    const fresh = {
      toolCallId: "t",
      messages: [],
      context: { requestStartedAt: Date.now() },
    } as any;
    const r2: any = await tools.editContent.execute!(
      { collection: "posts", continue: true },
      fresh
    );

    expect(r2.total).toBe(3);
    expect(seen.map(String).sort()).toEqual(["1", "2", "3"]);
    const r3: any = await tools.editContent.execute!(
      { collection: "posts", continue: true },
      fresh
    );

    expect(r3.error).toMatch(/Nothing to continue/u);
  });

  it("keeps the model document of the run for the continued documents", async () => {
    const { createContentEditorTools } = await import("../src/agent/content/contentEditor.js");
    const stored: any[] = [];
    const store = new Map<string, any>();
    const tools = createContentEditorTools({
      io: {
        read: async () => ({ doc: null, error: "boom" }),
        write: async () => ({}),
        create: async () => ({}),
        list: async () => ({ docs: [], totalPages: 1, totalDocs: 0 }),
        transports: () => ({ read: "local" }),
        lockRefusal: async () => null,
      } as any,
      schema,
      model: {} as any,
      concurrency: 1,
      telemetry: null,
      conversationId: "conv-model-document",
      bulkTimeBudgetMs: 1_000,
      pendingStore: {
        get: async (c: string, t: string, k: string) => store.get(`${c}|${t}|${k}`) ?? null,
        set: async (c: string, t: string, k: string, value: any) => {
          if (t === "editContent") stored.push(value);
          store.set(`${c}|${t}|${k}`, value);
        },
      },
    });
    const spent = {
      toolCallId: "t",
      messages: [],
      context: { requestStartedAt: Date.now() - 60_000 },
    } as any;

    await tools.editContent.execute!(
      {
        collection: "posts",
        ids: ["1", "2", "3"],
        instruction: "follow the model",
        modelDocument: "the-model",
      },
      spent
    );
    await tools.editContent.execute!({ collection: "posts", continue: true }, spent);

    expect(stored.map((value) => value?.modelDocument)).toEqual(["the-model", "the-model"]);
  });
});

describe("append works before any read and never doubles a paragraph", () => {
  it("appends without a token, refuses the same paragraph twice", async () => {
    const doc = { id: 1, title: "T", contentMarkdown: body };
    const t = createDocumentRewriteTools(
      { ref: { current: doc }, collection: "posts" } as any,
      schema
    );
    const a: any = await t.applyDocumentText.execute!(
      { token: "", append: { contentMarkdown: "Lorem Ipsum is simply dummy text." } },
      opts
    );

    expect(a.ok).toBe(true);
    expect(doc.contentMarkdown.endsWith("Lorem Ipsum is simply dummy text.")).toBe(true);
    const again: any = await t.applyDocumentText.execute!(
      { token: "", append: { contentMarkdown: "Lorem Ipsum is simply dummy text." } },
      opts
    );

    expect(again.ok).toBe(false);
    expect(again.errors[0].error).toMatch(/already in the document/u);
    expect(doc.contentMarkdown.split("Lorem Ipsum is simply dummy text.").length).toBe(2);
    const textNeedsRead: any = await t.applyDocumentText.execute!(
      { token: "", text: { 1: "x" } },
      opts
    );

    expect(textNeedsRead.error).toMatch(/readDocumentText first/u);
  });

  it("appends a short paragraph that is only part of another text of the document", async () => {
    const doc = {
      id: 1,
      title: "Learn more about our plans",
      contentMarkdown: body,
      layout: [{ id: "b1", blockType: "faq", title: "Learn more about the setup" }],
    };
    const t = createDocumentRewriteTools(
      { ref: { current: doc }, collection: "posts" } as any,
      schema
    );
    const a: any = await t.applyDocumentText.execute!(
      { token: "", append: { contentMarkdown: "Learn more" } },
      opts
    );

    expect(a.ok).toBe(true);
    expect(doc.contentMarkdown.endsWith("\n\nLearn more")).toBe(true);
  });

  it("refuses a paragraph that a rich text field already holds", async () => {
    const doc = {
      id: 1,
      title: "T",
      contentMarkdown: body,
      content: rt(lexPara(text("Call us "), { ...text("today"), format: 1 })),
    };
    const t = createDocumentRewriteTools(
      { ref: { current: doc }, collection: "posts" } as any,
      schema
    );
    const a: any = await t.applyDocumentText.execute!(
      { token: "", append: { contentMarkdown: "Call us today" } },
      opts
    );

    expect(a.ok).toBe(false);
    expect(a.errors[0].error).toMatch(/already in the document/u);
  });
});

describe("the same passage is never added twice across fields", () => {
  const LOREM =
    "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the standard dummy text ever since the 1500s.";

  it("setValues refuses a value that adds a passage the document already has elsewhere", async () => {
    const doc = {
      id: 1,
      title: "T",
      contentMarkdown: `${body}\n\n${LOREM}`,
      content: rt(lexPara(text("Intro."))),
      excerpt: "short",
    };
    const t = createBlockTools({ ref: { current: doc }, collection: "posts" } as any, {
      ...schema,
      collections: [
        {
          ...schema.collections[0],
          fields: [...schema.collections[0].fields, { name: "excerpt", type: "textarea" }] as any,
        },
      ],
    });
    const r: any = await t.setValues.execute!(
      { edits: [{ ref: "excerpt", value: `short\n\n${LOREM}` }] },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors[0].error).toMatch(/already contains elsewhere/u);
  });
  it("findNewDuplicates reports a passage that repeats after the edit but not before", async () => {
    const { findNewDuplicates } = await import("../src/agent/content/guards.js");
    const before = { a: LOREM, b: "other" };

    expect(findNewDuplicates(before, { a: LOREM, b: LOREM })).toHaveLength(1);
    expect(findNewDuplicates(before, { a: LOREM, b: "changed" })).toHaveLength(0);
  });
});

describe("text checks ignore curly quotes, dashes and whitespace", () => {
  it("a present-criterion written with a straight apostrophe matches text saved with a curly one", async () => {
    const doc = {
      body: "Lorem Ipsum has been the industry’s standard dummy text ever since the 1500s — really.",
    };
    const r = checkCriteria(
      [
        {
          check: {
            type: "present",
            text: "Lorem Ipsum has been the industry's standard dummy text ever since the 1500s - really.",
          },
        } as any,
      ],
      doc,
      doc
    );

    expect(r[0].ok).toBe(true);
  });
  it("append is idempotent across quote styles", async () => {
    const LOREM =
      "Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type.";
    const doc = { id: 1, title: "T", contentMarkdown: `${body}\n\n${LOREM.replace("'", "’")}` };
    const t = createDocumentRewriteTools(
      { ref: { current: doc }, collection: "posts" } as any,
      schema
    );
    const a: any = await t.applyDocumentText.execute!(
      { token: "", append: { contentMarkdown: LOREM } },
      opts
    );

    expect(a.ok).toBe(false);
    expect(a.errors[0].error).toMatch(/already in the document/u);
  });
});
