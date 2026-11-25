import { describe, expect, it } from "vitest";

import { createAgentCallbacks } from "../src/agent/telemetry.js";
// @ts-expect-error a plain script module without types
import { costOf, tokenCost } from "../scripts/lib/telemetryQueries.mjs";

const recorder = () => {
  const events: any[] = [];

  return {
    events,
    storage: {
      keepsContent: false,
      record: async (event: any) => {
        events.push(event);
      },
    } as any,
  };
};

const step: any = {
  stepNumber: 0,
  finishReason: "stop",
  usage: { inputTokens: 10, outputTokens: 2 },
  toolCalls: [],
  toolResults: [],
};

describe("telemetry origin", () => {
  it("names the model and the parent tool call on the step and the run rows", () => {
    const { events, storage } = recorder();
    const callbacks = createAgentCallbacks("content-editor", "conv1", storage, {
      model: { modelId: "some-model", provider: "some.provider" } as any,
      parentToolCallId: "call-7",
    });

    callbacks.onStepFinish(step);
    callbacks.runFinished();

    expect(events.map((event) => event.eventType)).toEqual(["step", "agent_run"]);

    for (const event of events) {
      expect(event.metadata).toMatchObject({
        runId: callbacks.runId,
        model: "some-model",
        provider: "some.provider",
        parentToolCallId: "call-7",
      });
    }
  });

  it("takes a model given as an id and leaves the parent out for the top agent", () => {
    const { events, storage } = recorder();

    createAgentCallbacks("main", "conv1", storage, { model: "plain-id" }).onStepFinish(step);

    expect(events[0].metadata.model).toBe("plain-id");
    expect(events[0].metadata).not.toHaveProperty("provider");
    expect(events[0].metadata).not.toHaveProperty("parentToolCallId");
  });
});

describe("token cost", () => {
  const tokens = {
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheReadTokens: 600_000,
    cacheWriteTokens: 0,
  };

  it("prices the cached input apart and never counts it twice", () => {
    expect(tokenCost(tokens, { input: 2, cachedInput: 0.5, output: 10 })).toBeCloseTo(
      0.4 * 2 + 0.6 * 0.5 + 0.1 * 10
    );
    expect(tokenCost(tokens, { input: 2, output: 10 })).toBeCloseTo(2 + 1);
  });

  it("lists a model without a price and gives no cost when no model has one", () => {
    expect(costOf({ a: tokens, b: tokens }, { a: { input: 2, output: 10 } })).toEqual({
      cost: 3,
      unpriced: ["b"],
    });
    expect(costOf({ b: tokens }, {})).toEqual({ cost: null, unpriced: ["b"] });
  });
});
