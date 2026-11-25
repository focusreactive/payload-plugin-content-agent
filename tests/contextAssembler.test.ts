import { describe, it, expect } from "vitest";
import {
  buildTemporalView,
  DEFAULT_CONTEXT_BUDGET,
  trimCoveredUiMessages,
} from "../src/memory/contextAssembler.js";

const userMessage = (id: string, tokenEstimate: number) => ({
  id,
  conversationId: "c",
  type: "user" as const,
  content: id,
  tokenEstimate,
  createdAt: new Date(),
});

describe("contextAssembler: compactionHardLimit actually bounds the view", () => {
  it("drops the oldest uncovered messages once the hard limit is exceeded, keeping the recency buffer", () => {
    const budget = { ...DEFAULT_CONTEXT_BUDGET, compactionHardLimit: 25, recencyBufferMessages: 2 };
    const messages = Array.from({ length: 10 }, (_, i) =>
      userMessage(String(i).padStart(2, "0"), 10)
    );
    const { view, totalTokens } = buildTemporalView(messages, [], budget);

    expect(totalTokens).toBeLessThanOrEqual(25);
    expect(view.length).toBeGreaterThanOrEqual(2);
    const survivingIds = view.map((v: any) => v.data.id);

    expect(survivingIds).toContain("09");
    expect(survivingIds).not.toContain("00");
  });
});

describe("trimCoveredUiMessages with no summary in the view", () => {
  it("is a no-op when the hard limit dropped nothing", () => {
    const ui = [{ id: 1 }, { id: 2 }, { id: 3 }];

    expect(trimCoveredUiMessages(ui, [{ kind: "message", data: {} as any }])).toBe(ui);
  });

  it("leaves out of the prompt the oldest messages the hard limit dropped", () => {
    const budget = { ...DEFAULT_CONTEXT_BUDGET, compactionHardLimit: 25, recencyBufferMessages: 2 };
    const messages = Array.from({ length: 10 }, (_, i) =>
      userMessage(String(i).padStart(2, "0"), 10)
    );
    const { view, droppedMessages } = buildTemporalView(messages, [], budget);
    const ui = messages.map((message) => ({ id: message.id }));
    const sent = trimCoveredUiMessages(ui, view, droppedMessages);

    expect(droppedMessages).toBe(8);
    expect(sent.map((message) => message.id)).toEqual(["08", "09"]);
  });
});

const msg = (id: string, type: "user" | "assistant", tokenEstimate = 10) =>
  ({ id, conversationId: "c", type, content: id, tokenEstimate, createdAt: new Date() }) as any;

describe("buildTemporalView: search-only (orderNum 0) summaries never trim history", () => {
  const messages = [msg("01", "user"), msg("02", "assistant"), msg("03", "user")];

  it("an orderNum-0 summary covering the whole chat leaves all messages in the view", () => {
    const searchOnly = {
      id: "s0",
      conversationId: "c",
      orderNum: 0,
      startId: "01",
      endId: "03",
      narrative: "n",
      keyObservations: [],
      tags: [],
      tokenEstimate: 5,
      createdAt: new Date(),
    } as any;
    const { view } = buildTemporalView(messages, [searchOnly], DEFAULT_CONTEXT_BUDGET);

    expect(view.filter((i) => i.kind === "summary")).toHaveLength(0);
    expect(view.filter((i) => i.kind === "message")).toHaveLength(3);
  });

  it("a real distillation (orderNum 1) DOES cover its range", () => {
    const distill = {
      id: "s1",
      conversationId: "c",
      orderNum: 1,
      startId: "01",
      endId: "02",
      narrative: "n",
      keyObservations: [],
      tags: [],
      tokenEstimate: 5,
      createdAt: new Date(),
    } as any;
    const { view } = buildTemporalView(messages, [distill], DEFAULT_CONTEXT_BUDGET);

    expect(view.filter((i) => i.kind === "summary")).toHaveLength(1);
    expect(view.filter((i) => i.kind === "message")).toHaveLength(1);
  });
});
