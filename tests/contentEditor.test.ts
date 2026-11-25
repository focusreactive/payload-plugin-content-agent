import { describe, it, expect, vi } from "vitest";

vi.mock("ai", () => {
  class MockToolLoopAgent {
    config: any;
    constructor(config: any) {
      this.config = config;
    }
    async generate() {
      const t = this.config.tools;
      const ctx = { toolCallId: "t", messages: [] };

      await t.getEditableContent.execute({}, ctx);
      await t.setValues.execute({ edits: [{ ref: "title", value: "New Title" }] }, ctx);

      return { text: "edited title" };
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
    generateText: vi.fn().mockResolvedValue({ output: { approved: true, reason: "matches task" } }),
    Output: { object: ({ schema }: any) => schema },
  };
});

import { createContentEditorTools } from "../src/agent/content/contentEditor.js";
import { createTurnApprovals, decideApproval } from "../src/agent/approvals.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { parseApprovalRequest } from "../src/approvalRequest.js";

const asIo = (tools: any, s: SchemaContext) => createDocumentIO({ mcpTools: tools, schema: s });

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text" },
        {
          name: "layout",
          type: "blocks",
          blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }],
        },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

function makeMcp(captured: { update?: any }) {
  const doc = {
    id: "d1",
    title: "Old Title",
    layout: [{ id: "h1", blockType: "hero", heading: "Hi" }],
  };

  return {
    findpages: {
      execute: vi.fn(async (args: any) => ({
        content: [{ text: `Resource:\n${JSON.stringify({ ...doc, id: args.id ?? doc.id })}` }],
      })),
    },
    updatepages: {
      execute: vi.fn(async (args: any) => {
        captured.update = args;

        return { content: [{ text: "{}" }] };
      }),
    },
  };
}

const localizedSchema: SchemaContext = {
  ...schema,
  locales: ["en", "es"],
  defaultLocale: "en",
  collections: [
    {
      ...schema.collections[0],
      fields: [
        { name: "title", type: "text", localized: true },
        ...schema.collections[0].fields.slice(1),
      ] as SchemaField[],
    },
  ],
};

const opts = { toolCallId: "t", messages: [] } as any;

describe("translateContent - one document or many (Phase 2)", () => {
  it("translates: reads source locale, saves to target locale (source untouched)", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });
    const captured: { update?: any } = {};
    const tools = createContentEditorTools({
      io: asIo(makeMcp(captured), localizedSchema),
      schema: localizedSchema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.translateContent.execute!(
      { collection: "pages", id: "d1", to: "es" },
      opts
    );

    expect(r.status).toBe("done");
    expect(captured.update.locale).toBe("es");
    expect(captured.update._status).toBe("draft");
  });

  it("rejects an unknown target locale (no agent run, no save)", async () => {
    const captured: { update?: any } = {};
    const tools = createContentEditorTools({
      io: asIo(makeMcp(captured), localizedSchema),
      schema: localizedSchema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.translateContent.execute!(
      { collection: "pages", id: "d1", to: "fr" },
      opts
    );

    expect(r.status).toBe("error");
    expect(r.error).toContain("Unknown target locale");
    expect(captured.update).toBeUndefined();
  });

  it("rejects translation on a non-localized project", async () => {
    const tools = createContentEditorTools({
      io: asIo(makeMcp({}), schema),
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.translateContent.execute!(
      { collection: "pages", id: "d1", to: "es" },
      opts
    );

    expect(r.status).toBe("error");
    expect(r.error).toContain("not localized");
  });

  it("rejects when source and target are the same", async () => {
    const tools = createContentEditorTools({
      io: asIo(makeMcp({}), localizedSchema),
      schema: localizedSchema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.translateContent.execute!(
      { collection: "pages", id: "d1", to: "en", from: "en" },
      opts
    );

    expect(r.status).toBe("error");
    expect(r.error).toContain("same");
  });

  it("translateContent on more than 5 documents asks the person and refuses without the click", async () => {
    const approvals = createTurnApprovals();
    const tools = createContentEditorTools({
      io: asIo(makeMcp({}), localizedSchema),
      schema: localizedSchema,
      model: {} as any,
      concurrency: 5,
      approvals,
    });
    const input = { collection: "pages", ids: ["a", "b", "c", "d", "e", "f"], to: "es" };
    const refused: any = await tools.translateContent.execute!(input, opts);

    expect(refused.error).toContain("Call translateContent again");
    const asked = await decideApproval(approvals, {
      toolName: "translateContent",
      toolCallId: "t",
      input,
    });

    expect(parseApprovalRequest(asked?.reason)).toMatchObject({
      kind: "translate",
      collection: "pages",
      count: 6,
      from: "en",
      to: "es",
    });
  });

  it("translateContent translates the whole batch to the target locale", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });
    const tools = createContentEditorTools({
      io: asIo(makeMcp({}), localizedSchema),
      schema: localizedSchema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.translateContent.execute!(
      { collection: "pages", ids: ["a", "b"], to: "es" },
      opts
    );

    expect(r.to).toBe("es");
    expect(r.done).toBe(2);
  });
});

describe("editContent worker (runner opens → agent edits → reviewer → save)", () => {
  it("persists the edit via MCP only after review approves", async () => {
    const captured: { update?: any } = {};
    const tools = createContentEditorTools({
      io: asIo(makeMcp(captured), schema),
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "rename title" },
      opts
    );

    expect(r.status).toBe("done");
    expect(r.summary).toContain("edited title");
    expect(captured.update).toBeTruthy();
    expect(captured.update.title).toBe("New Title");
    expect(captured.update._status).toBe("draft");
  });

  it("saves the work with the reviewer's objection as an open issue", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: false, reason: "unrelated change" },
    });
    const captured: { update?: any } = {};
    const tools = createContentEditorTools({
      io: asIo(makeMcp(captured), schema),
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "x" },
      opts
    );

    expect(r.status).toBe("done");
    expect(r.issues[0]).toBe("review: unrelated change");
    expect(r.summary).toMatch(/Saved with \d+ open issue/u);
    expect(captured.update).toBeDefined();
    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });
  });

  it("refuses an unknown collection with the collections and globals of the project", async () => {
    const captured: { update?: any } = {};
    const tools = createContentEditorTools({
      io: asIo(makeMcp(captured), schema),
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "no-such-collection", id: "1", instruction: "Fix it." },
      opts
    );

    expect(r.error).toContain('Unknown collection "no-such-collection"');
    expect(r.error).toContain(`Collections: ${schema.collections.map((c) => c.slug).join(", ")}`);
    expect(r.error).not.toContain("open");
    expect(captured.update).toBeUndefined();
  });

  it("exposes editContent and translateContent", () => {
    const tools = createContentEditorTools({
      io: asIo(makeMcp({}), schema),
      schema,
      model: {} as any,
      concurrency: 5,
    });

    expect(typeof tools.editContent.execute).toBe("function");
    expect(typeof tools.translateContent.execute).toBe("function");
  });

  it("editContent with ids runs the whole batch via the bounded pool and reports counts", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });
    const tools = createContentEditorTools({
      io: asIo(makeMcp({}), schema),
      schema,
      model: {} as any,
      concurrency: undefined as unknown as number,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", ids: ["a", "b", "c"], instruction: "rename" },
      opts
    );

    expect(r.total).toBe(3);
    expect(r.done).toBe(3);
    expect(r.results).toHaveLength(3);
    expect(r.concurrency).toBe(5);
  });

  it("respects an explicit concurrency setting", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });
    const tools = createContentEditorTools({
      io: asIo(makeMcp({}), schema),
      schema,
      model: {} as any,
      concurrency: 2,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", ids: ["a", "b", "c", "d"], instruction: "x" },
      opts
    );

    expect(r.concurrency).toBe(2);
    expect(r.done).toBe(4);
  });

  it("rejects a call that provides both collection and global, or neither", async () => {
    const tools = createContentEditorTools({
      io: asIo(makeMcp({}), schema),
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const both: any = await tools.editContent.execute!(
      { collection: "pages", global: "site-settings", id: "d1", instruction: "x" },
      opts
    );

    expect(both.status).toBe("error");
    expect(both.error).toMatch(/exactly ONE/u);
    const neither: any = await tools.editContent.execute!({ instruction: "x" }, opts);

    expect(neither.status).toBe("error");
  });
});

describe("editContent on a GLOBAL (Local API, no id)", () => {
  const globalSchema: SchemaContext = {
    collections: [],
    globals: [
      {
        slug: "site-settings",
        fields: [{ name: "title", type: "text" }] as SchemaField[],
        hasVersions: true,
        hasDrafts: true,
      },
    ],
  };

  function makeGlobalIo(captured: { update?: any }) {
    const doc = { title: "Old Title", globalType: "site-settings" };
    const payload = {
      findGlobal: vi.fn(async () => ({ ...doc })),
      updateGlobal: vi.fn(async (args: any) => {
        captured.update = args;

        return { ...doc, ...args.data };
      }),
    };

    return createDocumentIO({
      mcpTools: {},
      schema: globalSchema,
      payload: payload as any,
      user: { id: 1 } as any,
    });
  }

  it("edits and saves a global via editContent({ global })", async () => {
    const captured: { update?: any } = {};
    const tools = createContentEditorTools({
      io: makeGlobalIo(captured),
      schema: globalSchema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      { global: "site-settings", instruction: "rename title" },
      opts
    );

    expect(r.status).toBe("done");
    expect(r.id).toBe("site-settings");
    expect(captured.update.slug).toBe("site-settings");
    expect(captured.update.data.title).toBe("New Title");
    expect(captured.update.data._status).toBe("draft");
  });
});
