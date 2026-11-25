import { describe, it, expect, vi, afterEach } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import * as mcpClient from "../src/agent/mcpClient.js";
import type { ResolvedPluginOptions, SchemaContext } from "../src/types.js";
import { turnBody } from "./harness.js";

afterEach(() => vi.restoreAllMocks());

const schema: SchemaContext = { globals: [], collections: [] };

async function callOptionsOf(reasoningEffort?: ResolvedPluginOptions["reasoningEffort"]) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(mcpClient, "getMcpTools").mockResolvedValue({});
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Hello." },
          { type: "text-end", id: "t" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ] as any[],
      }),
    }),
  });

  await turnBody({
    messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Hi" }] }],
    schema,
    options: { model, ...(reasoningEffort ? { reasoningEffort } : {}) },
  });

  return model.doStreamCalls[0] as any;
}

describe("the reasoningEffort option", () => {
  it("asks the main model for no reasoning by default, on every provider", async () => {
    const call = await callOptionsOf();

    expect(call.reasoning).toBe("none");
    expect(call.providerOptions?.anthropic?.effort).toBeUndefined();
  });

  it("passes the level the host sets", async () => {
    expect((await callOptionsOf("medium")).reasoning).toBe("medium");
  });
});
