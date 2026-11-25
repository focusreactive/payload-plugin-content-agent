import { describe, it, expect, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();

  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({
      output: { narrative: "a summary", keyObservations: ["obs"], tags: [] },
    }),
  };
});

import { runDistillation } from "../src/memory/distillation.js";
import { DEFAULT_CONTEXT_BUDGET } from "../src/memory/contextAssembler.js";

const msg = (id: string, tokenEstimate = 100) => ({
  id,
  conversationId: "c",
  type: "user" as const,
  content: `msg ${id}`,
  tokenEstimate,
  createdAt: new Date(),
});

describe("runDistillation: coverage excludes the search-only orderNum-0 summary", () => {
  it("starts the new distillation range from the FIRST message, not after the orderNum-0 range", async () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg(String(i + 1).padStart(2, "0")));
    const searchOnlySummary = {
      id: "s0",
      conversationId: "c",
      orderNum: 0,
      startId: "01",
      endId: "04",
      narrative: "x",
      keyObservations: [],
      tags: [],
      tokenEstimate: 5,
      createdAt: new Date(),
    };

    let addedSummary: any = null;
    const memory: any = {
      backgroundReports: {
        startWorkerIfNotRunning: vi.fn(async () => ({ id: "w1" })),
        completeWorker: vi.fn(async () => {}),
        failWorker: vi.fn(async () => {}),
        addReport: vi.fn(async () => {}),
      },
      temporal: {
        getMessages: vi.fn(async () => messages),
        getSummaries: vi.fn(async () => [searchOnlySummary]),
        getMaxOrderNum: vi.fn(async () => 0),
        addSummary: vi.fn(async (params: any) => {
          addedSummary = params;

          return { id: "s1", ...params };
        }),
      },
      embeddings: null,
    };

    await runDistillation("c", memory, {} as any, DEFAULT_CONTEXT_BUDGET);

    expect(memory.temporal.addSummary).toHaveBeenCalledTimes(1);
    expect(addedSummary.startId).toBe("01");
    expect(addedSummary.endId).toBe("04");
  });
});
