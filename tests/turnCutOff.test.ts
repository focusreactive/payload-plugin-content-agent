import { describe, it, expect, vi, afterEach } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { createOpenAI } from "@ai-sdk/openai";
import * as mcpClient from "../src/agent/mcpClient.js";
import { CUT_OFF_NOTE, MAX_TURN_STEPS, STEP_LIMIT_NOTE } from "../src/agent/turnEnd.js";
import type { SchemaContext } from "../src/types.js";
import { fakeMemory, turnBody } from "./harness.js";

afterEach(() => vi.restoreAllMocks());

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [{ name: "excerpt", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function cutOffModel(prompts: unknown[]) {
  return new MockLanguageModelV3({
    doStream: async (options: any) => {
      prompts.push(options.prompt);

      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Next I am going to update the excerpt." },
            { type: "text-end", id: "t1" },
            { type: "tool-input-start", id: "call-1", toolName: "updatePosts" },
            { type: "tool-input-delta", id: "call-1", delta: '{"id": 1, "excer' },
            { type: "finish", finishReason: { unified: "other", raw: "incomplete" }, usage },
          ] as any[],
        }),
      };
    },
  });
}

/** Calls a tool in every step, so only the step limit ends the turn. */
function endlessModel() {
  let step = 0;

  return new MockLanguageModelV3({
    doStream: async () => {
      step += 1;

      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: `call-${step}`,
              toolName: "getSchemaInfo",
              input: "{}",
            },
            { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
          ] as any[],
        }),
      };
    },
  });
}

async function runTurn(messages: any[], model?: MockLanguageModelV3) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(mcpClient, "getMcpTools").mockResolvedValue({});
  const prompts: unknown[] = [];
  const mem = fakeMemory();
  const body = await turnBody({
    messages,
    schema,
    memory: mem,
    options: { model: model ?? cutOffModel(prompts) },
  });

  await vi.waitFor(() =>
    expect(mem.saveMessage).toHaveBeenCalledWith(
      "c-1",
      "assistant",
      expect.any(String),
      expect.anything()
    )
  );

  return { body, mem, prompts };
}

describe("a turn the model cuts off", () => {
  const ask = {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "Set the excerpt of post 1." }],
  };

  it("says so when the step limit stops the agent with work still to do", async () => {
    const { body, mem } = await runTurn([ask], endlessModel());
    const saved = mem.saveMessage.mock.calls.find((c: any[]) => c[1] === "assistant")[2];

    expect(body).toContain(STEP_LIMIT_NOTE.trim());
    expect(saved).toContain(STEP_LIMIT_NOTE.trim());
    expect(body.match(/"toolName":"getSchemaInfo"/gu)?.length).toBeGreaterThanOrEqual(
      MAX_TURN_STEPS
    );
  });

  it("tells the user in the live stream and in the saved history", async () => {
    const { body, mem } = await runTurn([ask]);

    expect(body).toContain(CUT_OFF_NOTE.trim());
    const saved = mem.saveMessage.mock.calls.find((c: any[]) => c[1] === "assistant")[2];

    expect(saved).toBe(`Next I am going to update the excerpt.${CUT_OFF_NOTE}`);
  });

  it("sends an earlier OpenAI answer as text, not as a reference to an item whose reasoning was removed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(mcpClient, "getMcpTools").mockResolvedValue({});
    const requests: any[] = [];
    const openai = createOpenAI({
      apiKey: "test",
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));

        return Response.json(
          { error: { message: "stop here", type: "invalid_request_error" } },
          { status: 400, headers: { "content-type": "application/json" } }
        );
      },
    });
    const earlier = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "reasoning",
          text: "SECRET-REASONING",
          providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: null } },
        },
        { type: "text", text: "Done before.", providerMetadata: { openai: { itemId: "msg_1" } } },
      ],
    };

    await turnBody({
      messages: [ask, earlier, { ...ask, id: "u2" }],
      schema,
      options: { model: openai("gpt-5.4") },
    });

    const input = JSON.stringify(requests[0].input);

    expect(input).not.toContain("msg_1");
    expect(input).not.toContain("rs_1");
    expect(input).not.toContain("SECRET-REASONING");
    expect(requests[0].input).toContainEqual({ role: "assistant", content: "Done before." });
  });

  it("does not send the reasoning of earlier turns back to the model", async () => {
    const earlier = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "SECRET-REASONING" },
        { type: "text", text: "Done before." },
      ],
    };
    const { prompts } = await runTurn([ask, earlier, { ...ask, id: "u2" }]);

    expect(JSON.stringify(prompts[0])).not.toContain("SECRET-REASONING");
    expect(JSON.stringify(prompts[0])).toContain("Done before.");
  });
});
