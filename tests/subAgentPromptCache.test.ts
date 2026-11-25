import { describe, it, expect } from "vitest";
import { ToolLoopAgent, isStepCount } from "ai";
import { MockLanguageModelV3 } from "ai/test";
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
const reply = (content: unknown[], unified: string) =>
  ({ content, finishReason: { unified, raw: undefined }, usage, warnings: [] }) as any;

const io = {
  read: async () => ({ doc: { id: "1", title: "A" } }),
  write: async () => ({}),
  create: async () => ({}),
  list: async () => ({ docs: [], totalPages: 1, totalDocs: 0 }),
  transports: () => ({ read: "local" }),
  lockRefusal: async () => null,
} as any;

describe("the editor sub-agent marks its instructions for the prompt cache", () => {
  it("sends the system prompt with the cache mark on every editor run", async () => {
    const prompts: any[][] = [];
    const editorModel = new MockLanguageModelV3({
      doGenerate: async (options: any) => {
        prompts.push(options.prompt);

        return reply([{ type: "text", text: "Nothing to change." }], "stop");
      },
    });
    let step = 0;
    const mainModel = new MockLanguageModelV3({
      doGenerate: async () => {
        step += 1;

        return step > 1
          ? reply([{ type: "text", text: "done" }], "stop")
          : reply(
              [
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "editContent",
                  input: JSON.stringify({ collection: "posts", id: "1", instruction: "x" }),
                },
              ],
              "tool-calls"
            );
      },
    });
    const { editContent } = createContentEditorTools({
      io,
      schema,
      model: editorModel as any,
      concurrency: 1,
    });
    const agent = new ToolLoopAgent({
      model: mainModel,
      tools: { editContent },
      toolsContext: { editContent: { requestStartedAt: Date.now(), contentEditorRuns: {} } },
      stopWhen: isStepCount(2),
    });

    await agent.generate({ prompt: "edit" });

    expect(prompts.length).toBeGreaterThan(0);
    const system = prompts[0]!.filter((message) => message.role === "system");

    expect(system).toHaveLength(1);
    expect(system[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });
});
