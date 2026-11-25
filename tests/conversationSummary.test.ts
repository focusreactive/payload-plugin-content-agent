import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { runConversationSummary } from "../src/memory/distillation.js";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const model = () =>
  new MockLanguageModelV3({
    doGenerate: async () =>
      ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              narrative: "Pricing page rewrite.",
              keyObservations: [],
              tags: null,
            }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      }) as any,
  });

const messages = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    type: i % 2 ? "assistant" : "user",
    content: `message ${i + 1}`,
  }));

function memory(summaries: any[], count: number) {
  return {
    embeddings: { embedSummary: vi.fn(async () => undefined) },
    backgroundReports: {
      startWorkerIfNotRunning: async () => ({ id: "w" }),
      completeWorker: vi.fn(async () => undefined),
      failWorker: vi.fn(async () => undefined),
    },
    temporal: {
      getSummaries: async () => summaries,
      getMessages: async () => messages(count),
      addSummary: vi.fn(async (params: any) => ({ id: "new", ...params })),
      replaceSummary: vi.fn(async (id: string, params: any) => ({ id, ...params })),
    },
  } as any;
}

describe("the search summary of a short conversation", () => {
  it("is made again when enough messages came after it", async () => {
    const stored = memory([{ id: "s1", orderNum: 0, startId: "m1", endId: "m4" }], 10);

    await runConversationSummary("c", stored, model());

    expect(stored.temporal.addSummary).not.toHaveBeenCalled();
    expect(stored.temporal.replaceSummary).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ startId: "m1", endId: "m10" })
    );
    expect(stored.embeddings.embedSummary).toHaveBeenCalledWith("s1", "Pricing page rewrite.");
  });

  it("is left as it is after one more turn", async () => {
    const stored = memory([{ id: "s1", orderNum: 0, startId: "m1", endId: "m4" }], 6);

    await runConversationSummary("c", stored, model());

    expect(stored.temporal.replaceSummary).not.toHaveBeenCalled();
    expect(stored.temporal.addSummary).not.toHaveBeenCalled();
  });
});
