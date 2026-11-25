import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentCallbacks } from "../src/agent/telemetry.js";

// A failed assertion must not leave the fake timers on for the rest of the file.
afterEach(() => {
  vi.useRealTimers();
});

const recorder = () => {
  const events: any[] = [];

  return {
    events,
    storage: {
      record: async (e: any) => {
        events.push(e);
      },
    } as any,
  };
};

const step = (n: number, tools: string[] = []): any => ({
  stepNumber: n,
  finishReason: tools.length ? "tool-calls" : "stop",
  usage: { inputTokens: 10, outputTokens: 2 },
  toolCalls: tools.map((t) => ({ toolName: t })),
  toolResults: tools.map((t, i) => ({ toolName: t, toolCallId: `c${i}`, output: { ok: true } })),
});

describe("telemetry timing", () => {
  it("records how long each step took", async () => {
    vi.useFakeTimers();
    const { events, storage } = recorder();
    const cb = createAgentCallbacks("content-editor", "conv1", storage);

    vi.advanceTimersByTime(1200);
    cb.onStepFinish(step(0, ["setText"]));
    vi.advanceTimersByTime(300);
    cb.onStepFinish(step(1));

    const steps = events.filter((e) => e.eventType === "step");

    expect(steps.map((s) => s.durationMs)).toEqual([1200, 300]);
  });

  it("measures a step from the end of the previous one, so a run sums to its steps", async () => {
    vi.useFakeTimers();
    const { events, storage } = recorder();
    const cb = createAgentCallbacks("main", "conv1", storage);

    vi.advanceTimersByTime(500);
    cb.onStepFinish(step(0));
    vi.advanceTimersByTime(700);
    cb.onStepFinish(step(1));
    cb.runFinished();

    const steps = events.filter((e) => e.eventType === "step");
    const run = events.find((e) => e.eventType === "agent_run");

    expect(steps.reduce((n, s) => n + s.durationMs, 0)).toBe(run.durationMs);
    expect(run.metadata.steps).toBe(2);
  });

  it("gives a tool call the time its execution took, as the SDK measured it", async () => {
    const { events, storage } = recorder();
    const cb = createAgentCallbacks("main", "conv1", storage);

    cb.onToolExecutionEnd({ toolExecutionMs: 1234.6, toolCall: { toolCallId: "c0" } });
    cb.onToolExecutionEnd({ toolExecutionMs: 80, toolCall: { toolCallId: "c1" } });
    cb.onStepFinish(step(0, ["listDocuments", "readDocument"]));
    cb.onStepFinish(step(1, ["readDocument"]));

    const calls = events.filter((e) => e.eventType === "tool_call");

    expect(calls.map((c) => c.durationMs)).toEqual([1235, 80, undefined]);
  });

  it("gives a tool call the duration of the step it belonged to, and no invented one of its own", async () => {
    vi.useFakeTimers();
    const { events, storage } = recorder();
    const cb = createAgentCallbacks("content-editor", "conv1", storage);

    vi.advanceTimersByTime(900);
    cb.onStepFinish(step(0, ["setText", "setField"]));

    const calls = events.filter((e) => e.eventType === "tool_call");

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.durationMs === undefined)).toBe(true);
    expect(calls.every((c) => c.metadata.stepDurationMs === 900)).toBe(true);
  });

  it("records a failed run with its reason", async () => {
    const { events, storage } = recorder();
    const cb = createAgentCallbacks("content-editor", "conv1", storage);

    cb.runFinished({ ok: false, error: "aborted" });
    const run = events.find((e) => e.eventType === "agent_run");

    expect(run.success).toBe(false);
    expect(run.error).toBe("aborted");
  });

  it("records a tool that threw as a failed tool call", () => {
    const { events, storage } = recorder();
    const cb = createAgentCallbacks("main", "conv1", storage);

    cb.onStepFinish({
      ...step(0),
      toolCalls: [{ toolName: "web" }],
      content: [
        { type: "text", text: "x" },
        {
          type: "tool-error",
          toolCallId: "c9",
          toolName: "web",
          input: { url: "https://example.com" },
          error: new Error("fetch failed"),
        },
        {
          type: "tool-error",
          toolCallId: "c10",
          toolName: "nope",
          input: "{",
          error: "Model tried to call unavailable tool",
        },
      ],
    });
    const calls = events.filter((e) => e.eventType === "tool_call");

    expect(calls.map((c) => [c.toolName, c.success, c.error])).toEqual([
      ["web", false, "fetch failed"],
      ["nope", false, "Model tried to call unavailable tool"],
    ]);
    expect(calls[0].metadata).toMatchObject({
      toolCallId: "c9",
      thrown: true,
    });
  });

  it("gives every row of one run the same run id, and each run its own", () => {
    const { events, storage } = recorder();
    const a = createAgentCallbacks("content-editor", "conv1", storage);
    const b = createAgentCallbacks("content-editor", "conv1", storage);

    a.onStepFinish(step(0, ["setText"]));
    a.runFinished({ finishReason: "stop" });
    b.onStepFinish(step(0));
    const ids = events.map((e) => e.metadata.runId);

    expect(new Set(ids.slice(0, 3)).size).toBe(1);
    expect(ids[3]).not.toBe(ids[0]);
    expect(events[2].metadata).toMatchObject({ steps: 1, finishReason: "stop" });
  });

  it("records the end of a run once", () => {
    const { events, storage } = recorder();
    const cb = createAgentCallbacks("main", "conv1", storage);

    cb.runFinished({ ok: false, error: "provider error" });
    cb.runFinished();
    expect(events.filter((e) => e.eventType === "agent_run")).toHaveLength(1);
    expect(events[0].success).toBe(false);
  });

  it("stays silent without telemetry or a conversation", () => {
    const cb = createAgentCallbacks("main", undefined, null);

    expect(() => {
      cb.onStepFinish(step(0));
      cb.runFinished();
    }).not.toThrow();
  });
});
