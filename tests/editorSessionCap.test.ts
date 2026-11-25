import { describe, it, expect } from "vitest";
import { ToolLoopAgent, isStepCount } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { turnContextSchema } from "../src/borders.js";
import type { TurnContext } from "../src/borders.js";
import { createContentEditorTools } from "../src/agent/content/contentEditor.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [{ name: "title", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const io = {
  read: async () => ({ doc: null, error: "boom" }),
  write: async () => ({}),
  create: async () => ({}),
  list: async () => ({ docs: [], totalPages: 1, totalDocs: 0 }),
  transports: () => ({ read: "local" }),
  lockRefusal: async () => null,
} as any;

function modelCallingEditContent(times: number) {
  let step = 0;

  return new MockLanguageModelV3({
    doGenerate: async () => {
      step += 1;
      const done = step > times;

      return {
        content: done
          ? [{ type: "text", text: "done" }]
          : [
              {
                type: "tool-call",
                toolCallId: `call-${step}`,
                toolName: "editContent",
                input: JSON.stringify({ collection: "posts", id: "1", instruction: "x" }),
              },
            ],
        finishReason: { unified: done ? "stop" : "tool-calls", raw: undefined },
        usage,
        warnings: [],
      } as any;
    },
  });
}

async function editErrors(turnContext: TurnContext, calls: number): Promise<string[]> {
  const { editContent } = createContentEditorTools({
    io,
    schema,
    model: {} as any,
    concurrency: 1,
  });
  const agent = new ToolLoopAgent({
    model: modelCallingEditContent(calls),
    tools: { editContent },
    toolsContext: { editContent: turnContext },
    stopWhen: isStepCount(calls + 1),
  });
  const result = await agent.generate({ prompt: "edit" });

  return result.steps
    .flatMap((s) => s.toolResults)
    .map((r) => String((r.output as { error?: unknown }).error));
}

describe("the editContent session limit through the AI SDK tool call path", () => {
  it("the schema copies the context and keeps the session counter shared", () => {
    const turnContext: TurnContext = { requestStartedAt: 1, contentEditorRuns: {} };
    const first = turnContextSchema.parse(turnContext);
    const second = turnContextSchema.parse(turnContext);

    expect(first).not.toBe(turnContext);
    expect(first).not.toBe(second);
    expect(first.contentEditorRuns).toBe(turnContext.contentEditorRuns);
    expect(second.contentEditorRuns).toBe(turnContext.contentEditorRuns);
  });

  it("refuses the third session on one document in one turn", async () => {
    const turnContext: TurnContext = { requestStartedAt: Date.now(), contentEditorRuns: {} };
    const errors = await editErrors(turnContext, 3);

    expect(errors).toHaveLength(3);
    expect(errors[0]).toBe("boom");
    expect(errors[1]).toBe("boom");
    expect(errors[2]).toMatch(/session #3/u);
    expect(turnContext.contentEditorRuns).toEqual({ "posts#1": 3 });
  });

  it("starts from zero in the next turn", async () => {
    const errors = await editErrors({ requestStartedAt: Date.now(), contentEditorRuns: {} }, 1);

    expect(errors).toEqual(["boom"]);
  });
});
