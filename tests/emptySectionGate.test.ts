import { describe, it, expect, vi } from "vitest";

let agentScript: (t: any, ctx: any) => Promise<string> = async () => "noop";

vi.mock("ai", () => {
  class MockToolLoopAgent {
    config: any;
    constructor(config: any) {
      this.config = config;
    }
    async generate() {
      const ctx = { toolCallId: "t", messages: [] };
      const text = await agentScript(this.config.tools, ctx);

      return { text };
    }
  }

  return {
    ToolLoopAgent: MockToolLoopAgent,
    isStepCount: (_n: number) => () => false,
    hasToolCall: () => () => false,
    jsonSchema: (schema: any) => ({ jsonSchema: schema }),
    tool: (cfg: any) => ({
      description: cfg.description,
      inputSchema: cfg.inputSchema,
      execute: cfg.execute,
    }),
    generateText: vi.fn().mockResolvedValue({ output: { approved: true, reason: "ok" } }),
    Output: { object: ({ schema }: any) => schema },
  };
});

import { createContentEditorTools } from "../src/agent/content/contentEditor.js";
import { findEmptyNewSections } from "../src/agent/content/structureChecks.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { createRichTextTools } from "../src/agent/content/richtextTools.js";
import { htmlMarkupError } from "../src/agent/content/richtext/surgical.js";
import type { DocumentWorkspace } from "../src/agent/content/blockTools.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const faqBlock = {
  slug: "faq",
  fields: [
    { name: "title", type: "text" },
    {
      name: "items",
      type: "array",
      fields: [
        { name: "question", type: "text" },
        { name: "answer", type: "text" },
      ],
    },
    { name: "image", type: "upload", relationTo: "media" },
  ] as SchemaField[],
};
const ctaBlock = {
  slug: "cta",
  fields: [
    { name: "text", type: "text" },
    { name: "href", type: "text" },
  ] as SchemaField[],
};

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text" },
        { name: "layout", type: "blocks", blocks: [faqBlock, ctaBlock] },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const layoutField = schema.collections[0].fields as SchemaField[];
const opts = { toolCallId: "t", messages: [] } as any;

function makeMcp(doc: any, captured: { update?: any } = {}) {
  return {
    findpages: {
      execute: vi
        .fn()
        .mockResolvedValue({ content: [{ text: `Resource:\n${JSON.stringify(doc)}` }] }),
    },
    updatepages: {
      execute: vi.fn(async (args: any) => {
        captured.update = args;

        return { content: [{ text: "{}" }] };
      }),
    },
  };
}

const toolsFor = (doc: any, captured: { update?: any } = {}) =>
  createContentEditorTools({
    io: createDocumentIO({ mcpTools: makeMcp(doc, captured), schema }),
    schema,
    model: {} as any,
    concurrency: 5,
  });

describe("findEmptyNewSections", () => {
  const before = { id: "d1", layout: [{ id: "old", blockType: "faq", title: "Kept", items: [] }] };

  it("reports a section this edit added whose only container came out empty", () => {
    const after = {
      id: "d1",
      layout: [...before.layout, { id: "new", blockType: "faq", title: "Added" }],
    };
    const found = findEmptyNewSections(layoutField, before, after);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ blockType: "faq", path: "layout[new]", empty: ["items"] });
  });

  it("leaves a PRE-EXISTING empty section alone - it is not this edit's doing", () => {
    const after = {
      id: "d1",
      layout: [{ id: "old", blockType: "faq", title: "Renamed", items: [] }],
    };

    expect(findEmptyNewSections(layoutField, before, after)).toHaveLength(0);
  });

  it("accepts a new section that got its rows", () => {
    const after = {
      id: "d1",
      layout: [
        ...before.layout,
        {
          id: "new",
          blockType: "faq",
          title: "Added",
          items: [{ id: "r1", question: "Q", answer: "A" }],
        },
      ],
    };

    expect(findEmptyNewSections(layoutField, before, after)).toHaveLength(0);
  });

  it("never reports a block that declares no container fields (a CTA is complete without rows)", () => {
    const after = {
      id: "d1",
      layout: [
        ...before.layout,
        { id: "new", blockType: "cta", text: "Talk to us", href: "/contact" },
      ],
    };

    expect(findEmptyNewSections(layoutField, before, after)).toHaveLength(0);
  });
});

describe("editContent: the deterministic empty-section gate", () => {
  it("refuses to save a section inserted as a bare heading, and names it", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockClear();
    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "looks great" },
    });

    agentScript = async (t, ctx) => {
      await t.insertItem.execute(
        { path: "layout", blockType: "faq", fields: { title: "Common questions" } },
        ctx
      );

      return "added the FAQ section";
    };

    const captured: { update?: any } = {};
    const r: any = await toolsFor({ id: "d1", title: "T", layout: [] }, captured).editContent
      .execute!({ collection: "pages", id: "d1", instruction: "add an FAQ section" }, opts);

    expect(r.status).toBe("rejected");
    expect(r.reviewReason).toContain("faq");
    expect(r.reviewReason).toContain("items");
    expect(captured.update).toBeUndefined();
    expect(vi.mocked(ai.generateText as any)).not.toHaveBeenCalled();
  });

  it("saves once the editor fills the rows finishEdit named, in the same session", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });
    const finishes: any[] = [];

    agentScript = async (t, ctx) => {
      const ins: any = await t.insertItem.execute(
        { path: "layout", blockType: "faq", fields: { title: "Common questions" } },
        ctx
      );

      finishes.push(await t.finishEdit.execute({}, ctx));
      await t.insertItem.execute(
        { path: `layout[${ins.id}].items`, fields: { question: "Q", answer: "A" } },
        ctx
      );
      finishes.push(await t.finishEdit.execute({}, ctx));

      return "added the FAQ section";
    };

    const captured: { update?: any } = {};
    const r: any = await toolsFor({ id: "d1", title: "T", layout: [] }, captured).editContent
      .execute!({ collection: "pages", id: "d1", instruction: "add an FAQ section" }, opts);

    expect(finishes[0].ok).toBe(false);
    expect(finishes[0].blocking[0]).toContain("faq");
    expect(finishes[1].ok).toBe(true);
    expect(r.status).toBe("done");
    expect(captured.update).toBeDefined();
  });
});

describe("the outline the Reviewer judges", () => {
  it("spells out empty arrays and unset references", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockClear();
    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });

    agentScript = async (t, ctx) => {
      await t.setValues.execute({ edits: [{ ref: "title", value: "New Title" }] }, ctx);

      return "renamed";
    };

    // The empty faq exists before the edit, so the deterministic gate stays quiet and the reviewer runs.
    await toolsFor({
      id: "d1",
      title: "T",
      layout: [{ id: "f1", blockType: "faq", title: "Q", items: [], image: null }],
    }).editContent.execute!(
      { collection: "pages", id: "d1", instruction: "rename the title" },
      opts
    );

    const prompt = vi.mocked(ai.generateText as any).mock.calls[0][0].messages[0].content as string;

    expect(prompt).toContain("layout[f1].items: 0 row(s)");
    expect(prompt).toContain("layout[f1].image: no media set");
  });
});

const page = () => ({
  id: "d1",
  title: "T",
  layout: [{ id: "c1", blockType: "cta", text: "Go", href: "/go" }],
});

const run = async () => {
  const ai = await import("ai");

  vi.mocked(ai.generateText as any).mockClear();
  const result: any = await toolsFor(page()).editContent.execute!(
    { collection: "pages", id: "d1", instruction: "rename the title" },
    opts
  );

  return { result, reviews: vi.mocked(ai.generateText as any).mock.calls.length };
};

describe("which edit the Reviewer sees", () => {
  it("words changed in an existing field, with a declared outcome that is met: no reviewer", async () => {
    agentScript = async (t, ctx) => {
      await t.declareOutcome.execute(
        { criteria: [{ path: "title", type: "present", text: "New Title" }] },
        ctx
      );
      await t.setValues.execute({ edits: [{ ref: "title", value: "New Title" }] }, ctx);

      return "renamed";
    };

    const { result, reviews } = await run();

    expect(result.status).toBe("done");
    expect(result.changeClass).toBe("text");
    expect(reviews).toBe(0);
  });

  it("the same words with no declared outcome: the reviewer", async () => {
    agentScript = async (t, ctx) => {
      await t.setValues.execute({ edits: [{ ref: "title", value: "New Title" }] }, ctx);

      return "renamed";
    };

    const { result, reviews } = await run();

    expect(result.changeClass).toBe("text");
    expect(reviews).toBe(1);
  });

  it("a removed block, with a declared outcome that is met: the reviewer", async () => {
    agentScript = async (t, ctx) => {
      await t.declareOutcome.execute(
        { criteria: [{ type: "itemRemoved", path: "layout[c1]" }] },
        ctx
      );
      await t.removeItem.execute({ path: "layout", id: "c1" }, ctx);

      return "removed";
    };

    const { result, reviews } = await run();

    expect(result.changeClass).toBe("structure");
    expect(reviews).toBe(1);
  });
});

describe("editContent: a declared model document is routed to cloneDocument", () => {
  it("refuses to compose a model-page landing inside an empty shell", async () => {
    let ran = false;

    agentScript = async () => {
      ran = true;

      return "built";
    };

    const captured: { update?: any } = {};
    const r: any = await toolsFor({ id: "d1", title: "New", layout: [] }, captured).editContent
      .execute!(
      {
        collection: "pages",
        id: "d1",
        instruction: "Build this landing based on the migrate-from-drupal page",
        modelDocument: "migrate-from-drupal",
      },
      opts
    );

    expect(r.status).toBe("error");
    expect(r.error).toContain("cloneDocument");
    expect(r.error).toContain('"migrate-from-drupal"');
    expect(r.error).toContain("without `modelDocument`");
    expect(ran).toBe(false);
    expect(captured.update).toBeUndefined();
  });

  it("never fires on a GLOBAL: a singleton has nothing to be cloned from", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });

    agentScript = async (t, ctx) => {
      await t.setValues.execute({ edits: [{ ref: "title", value: "Set" }] }, ctx);

      return "edited";
    };

    const globalSchema: SchemaContext = {
      collections: [],
      globals: [
        {
          slug: "site-settings",
          fields: [
            { name: "title", type: "text" },
            { name: "layout", type: "blocks", blocks: [ctaBlock] },
          ] as SchemaField[],
          hasVersions: true,
          hasDrafts: true,
        },
      ],
    };
    const payload = {
      findGlobal: vi.fn(async () => ({ title: "Old", layout: [], globalType: "site-settings" })),
      updateGlobal: vi.fn(async (a: any) => ({ ...a.data })),
    };
    const io = createDocumentIO({
      mcpTools: {},
      schema: globalSchema,
      payload: payload as any,
      user: { id: 1 } as any,
    });
    const tools = createContentEditorTools({
      io,
      schema: globalSchema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      {
        global: "site-settings",
        instruction: "Fill this based on the migrate-from-drupal page",
        modelDocument: "migrate-from-drupal",
      },
      opts
    );

    expect(r.status).toBe("done");
  });

  it("reads no intent from the words of the instruction", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });

    agentScript = async (t, ctx) => {
      await t.insertItem.execute(
        { path: "layout", blockType: "cta", fields: { text: "Talk to us", href: "/contact" } },
        ctx
      );

      return "built";
    };

    const r: any = await toolsFor({ id: "d1", title: "New", layout: [] }).editContent.execute!(
      {
        collection: "pages",
        id: "d1",
        instruction: "Build this landing based on the migrate-from-drupal page",
      },
      opts
    );

    expect(r.status).toBe("done");
  });

  it("does not fire once the document already has sections (a rewrite in place)", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });

    agentScript = async (t, ctx) => {
      await t.setValues.execute({ edits: [{ ref: "layout[f1].title", value: "Rewritten" }] }, ctx);

      return "rewrote";
    };

    const r: any = await toolsFor({
      id: "d1",
      title: "T",
      layout: [
        {
          id: "f1",
          blockType: "faq",
          title: "Q",
          items: [{ id: "r", question: "a", answer: "b" }],
        },
      ],
    }).editContent.execute!(
      {
        collection: "pages",
        id: "d1",
        instruction:
          "Rewrite this clone for the new topic, keeping the same structure as the source page",
        modelDocument: "the source page",
      },
      opts
    );

    expect(r.status).toBe("done");
  });
});

const lexical = (text: string) => ({
  root: {
    type: "root",
    version: 1,
    direction: "ltr",
    format: "",
    indent: 0,
    children: [
      {
        type: "paragraph",
        version: 1,
        direction: "ltr",
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        children: [
          { type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" },
        ],
      },
    ],
  },
});
const ws = (doc: any): DocumentWorkspace => ({ ref: { current: doc }, collection: "posts" });

describe("rich text refuses HTML where it expects markdown", () => {
  const rtSchema: SchemaContext = {
    globals: [],
    collections: [
      {
        slug: "posts",
        fields: [{ name: "body", type: "richText", editor: "lexical" }] as SchemaField[],
        hasVersions: true,
        hasDrafts: true,
        hasAuth: false,
        timestamps: true,
      },
    ],
  };

  it("htmlMarkupError flags markup and ignores markdown and backticked tags", () => {
    expect(htmlMarkupError("x", "<ul>\n  <li>One</li>\n</ul>")).toContain("MARKDOWN, not HTML");
    expect(htmlMarkupError("x", "- One\n- Two\n\n**bold** and [a link](/x)")).toBeNull();
    expect(htmlMarkupError("x", "Wrap the items in `<ul>` and `<li>` tags.")).toBeNull();
    expect(htmlMarkupError("x", "Latency < 200ms and cost > $5")).toBeNull();
  });

  it("surgical applyRichText refuses an HTML fragment without touching the field", async () => {
    const doc = { id: "p", body: lexical("Hello") };
    const t = createRichTextTools(ws(doc), rtSchema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "0", action: "insertAfter", markdown: "<ul><li>One</li></ul>" }],
      },
      opts
    );

    expect(r.error).toContain("MARKDOWN, not HTML");
    expect(doc.body.root.children).toHaveLength(1);
  });

  it("transform applyRichText refuses an HTML segment", async () => {
    const doc = { id: "p", body: lexical("Hello") };
    const t = createRichTextTools(ws(doc), rtSchema);
    const r: any = await t.applyRichText.execute!(
      { ref: "body", mode: "transform", segments: { 0: "<p>Hello</p>" } },
      opts
    );

    expect(r.error).toContain("MARKDOWN, not HTML");
    expect(doc.body.root.children[0].children[0].text).toBe("Hello");
  });

  it("still accepts a normal markdown insert", async () => {
    const doc = { id: "p", body: lexical("Hello") };
    const t = createRichTextTools(ws(doc), rtSchema);
    const r: any = await t.applyRichText.execute!(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "0", action: "insertAfter", markdown: "- One\n- Two" }],
      },
      opts
    );

    expect(r.error).toBeUndefined();
  });
});
