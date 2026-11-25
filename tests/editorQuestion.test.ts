import { describe, it, expect, vi } from "vitest";

let agentScript: (tools: any, ctx: any) => Promise<string> = async () => "noop";
let stopConditions: unknown[] = [];
let generateInput: any;

vi.mock("ai", () => {
  class MockToolLoopAgent {
    config: any;
    constructor(config: any) {
      this.config = config;
      stopConditions = config.stopWhen;
    }
    async generate(input: any) {
      generateInput = input;
      const text = await agentScript(this.config.tools, {
        toolCallId: "t",
        messages: [],
      });

      return { text };
    }
  }

  return {
    ToolLoopAgent: MockToolLoopAgent,
    isStepCount: () => "steps",
    hasToolCall: (name: string) => `stop on ${name}`,
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
import { singleResult } from "../src/agent/content/editor/shared.js";
import { reportsFailedWrite } from "../src/agent/runAgent/failedWrites.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text" },
        { name: "body", type: "textarea" },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};
const opts = { toolCallId: "t", messages: [] } as any;

function editorOn(initial: Record<string, unknown>) {
  const store = { doc: structuredClone(initial), writes: 0 };
  const io = {
    transports: () => ({ read: "local", write: "local", create: "local" }),
    lockRefusal: async () => null,
    read: vi.fn(async () => ({ doc: structuredClone(store.doc) })),
    write: vi.fn(async (_target: unknown, options: any) => {
      store.writes += 1;
      store.doc = { ...store.doc, ...options.patch };

      return { doc: structuredClone(store.doc) };
    }),
    list: vi.fn(async () => ({ docs: [], totalDocs: 0, totalPages: 1 })),
  } as any;
  const tools = createContentEditorTools({
    io,
    schema,
    model: {} as any,
    concurrency: 1,
    telemetry: null,
  });

  return { tools, store };
}

const ended = () =>
  stopConditions.some((condition) => typeof condition === "function" && condition());

describe("the editor stops with a question for the person", () => {
  it("returns the question and saves nothing, also not an edit made before it", async () => {
    const { tools, store } = editorOn({
      id: "d1",
      title: "Pricing",
      body: "Old text",
    });

    agentScript = async (editorTools, ctx) => {
      await editorTools.setValues.execute({ edits: [{ ref: "body", value: "New text" }] }, ctx);
      await editorTools.askPerson.execute(
        { question: " Which of the two plans do you mean? " },
        ctx
      );

      return "";
    };

    const result: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "update the plan name" },
      opts
    );

    expect(result).toEqual({
      id: "d1",
      status: "needsInput",
      question: "Which of the two plans do you mean?",
    });
    expect(store.writes).toBe(0);
    expect(store.doc.body).toBe("Old text");
    expect(stopConditions.some((stop) => typeof stop === "function" && stop() === true)).toBe(true);
  });

  it("refuses an empty question with the next call and goes on to save", async () => {
    const { tools, store } = editorOn({
      id: "d1",
      title: "Pricing",
      body: "Old text",
    });
    let refusal: any;

    agentScript = async (editorTools, ctx) => {
      refusal = await editorTools.askPerson.execute({ question: "  " }, ctx);
      await editorTools.setValues.execute({ edits: [{ ref: "body", value: "New text" }] }, ctx);
      await editorTools.finishEdit.execute({}, ctx);

      return "changed the body";
    };

    const result: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "rewrite the body" },
      opts
    );

    expect(refusal.error).toMatch(/Call askPerson again with `question`/u);
    expect(result.status).toBe("done");
    expect(store.writes).toBe(1);
  });

  it("ends the session on a finishEdit that accepts a changed document and keeps its summary", async () => {
    const { tools, store } = editorOn({
      id: "d1",
      title: "Pricing",
      body: "Old text",
    });
    let endedBeforeFinish = true;
    let endedAfterFinish = false;

    agentScript = async (editorTools, ctx) => {
      await editorTools.setValues.execute({ edits: [{ ref: "body", value: "New text" }] }, ctx);
      endedBeforeFinish = ended();
      await editorTools.finishEdit.execute({ summary: "Replaced the body." }, ctx);
      endedAfterFinish = ended();

      return "";
    };

    const result: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "rewrite the body" },
      opts
    );

    expect(endedBeforeFinish).toBe(false);
    expect(endedAfterFinish).toBe(true);
    expect(result.status).toBe("done");
    expect(result.summary).toBe("Replaced the body.");
    expect(store.writes).toBe(1);
  });

  it("goes on after a finishEdit on an unchanged document and takes the final text", async () => {
    const { tools, store } = editorOn({
      id: "d1",
      title: "Pricing",
      body: "Old text",
    });
    let endedAfterFinish = true;

    agentScript = async (editorTools, ctx) => {
      await editorTools.finishEdit.execute({ summary: "Changed the body." }, ctx);
      endedAfterFinish = stopConditions.some(
        (condition) => typeof condition === "function" && condition()
      );

      return "The body already reads this way.";
    };

    const result: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "rewrite the body" },
      opts
    );

    expect(endedAfterFinish).toBe(false);
    expect(result.status).toBe("unchanged");
    expect(result.summary).toBe("The body already reads this way.");
    expect(store.writes).toBe(0);
  });

  it("starts the session with the read of the document already made", async () => {
    const { tools } = editorOn({
      id: "d1",
      title: "Pricing",
      body: "Old text",
    });

    agentScript = async () => "";
    await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "rewrite the body" },
      opts
    );

    const [task, call, result] = generateInput.messages;

    expect(generateInput.prompt).toBeUndefined();
    expect(task).toMatchObject({ role: "user" });
    expect(task.content).toContain("Task: rewrite the body");
    expect(call.content).toEqual([
      {
        type: "tool-call",
        toolCallId: result.content[0].toolCallId,
        toolName: "getEditableContent",
        input: {},
      },
    ]);
    expect(result.content[0]).toMatchObject({
      type: "tool-result",
      toolName: "getEditableContent",
    });
    expect(result.content[0].output.value.fields).toContainEqual(
      expect.objectContaining({
        ref: "body",
        value: "Old text",
        editWith: "setValues",
      })
    );
  });

  it("offers no question tool when one instruction runs over many documents", async () => {
    const { tools } = editorOn({
      id: "d1",
      title: "Pricing",
      body: "Old text",
    });
    let offered: string[] = [];

    agentScript = async (editorTools) => {
      offered = Object.keys(editorTools);

      return "";
    };

    await tools.editContent.execute!(
      { collection: "pages", ids: ["d1"], instruction: "rewrite the body" },
      opts
    );

    expect(offered).toContain("finishEdit");
    expect(offered).not.toContain("askPerson");
  });

  it("tells the orchestrator to pass the question on and names the next call", () => {
    const text = singleResult("editContent", {
      id: "d1",
      status: "needsInput",
      question: "Which plan?",
    });

    expect(text).toContain("NOTHING was saved");
    expect(text).toContain('"""\nWhich plan?\n"""');
    expect(text).toContain("call editContent with the task and their answer in `instruction`");
  });

  it("is not counted as a write that failed", () => {
    expect(
      reportsFailedWrite({
        id: "d1",
        status: "needsInput",
        question: "Which plan?",
      })
    ).toBe(false);
  });
});
