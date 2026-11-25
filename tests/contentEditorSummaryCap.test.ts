import { describe, it, expect, vi } from "vitest";

const LONG_SUMMARY = "Changed the following fields: " + "x".repeat(2000);

vi.mock("ai", () => {
  class MockToolLoopAgent {
    async generate() {
      return { text: LONG_SUMMARY };
    }
  }

  return {
    ToolLoopAgent: MockToolLoopAgent,
    isStepCount: () => () => false,
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
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [{ name: "title", type: "text" }] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

function makeMcp(captured: { update?: any }) {
  const doc = { id: "d1", title: "Old Title" };

  return {
    findposts: {
      execute: vi.fn(async (args: any) => ({
        content: [{ text: `Resource:\n${JSON.stringify({ ...doc, id: args.id ?? doc.id })}` }],
      })),
    },
    updateposts: {
      execute: vi.fn(async (args: any) => {
        captured.update = args;

        return { content: [{ text: "{}" }] };
      }),
    },
  };
}

const opts = { toolCallId: "t", messages: [] } as any;

describe("editContent (one or many): summary size cap", () => {
  it("caps a single document's free-form summary before it becomes the stored tool-result output", async () => {
    const captured: { update?: any } = {};
    const tools = createContentEditorTools({
      io: createDocumentIO({ mcpTools: makeMcp(captured), schema }),
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "posts", id: "d1", instruction: "x" },
      opts
    );

    // The stub touches no field, so the run ends unchanged.
    // The cap on the summary is what this checks.
    expect(r.status).toBe("unchanged");
    expect(r.summary.length).toBeLessThan(600);
    expect(r.summary).toContain("truncated");
  });

  it("caps EACH document's summary inside a many-document editContent's results array - the multiplying case", async () => {
    const tools = createContentEditorTools({
      io: createDocumentIO({ mcpTools: makeMcp({}), schema }),
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "posts", ids: ["a", "b", "c"], instruction: "x" },
      opts
    );

    expect(r.results).toHaveLength(3);

    for (const doc of r.results) {
      expect(doc.summary.length).toBeLessThan(600);
    }

    expect(JSON.stringify(r.results).length).toBeLessThan(3 * 700);
  });
});
