import { describe, expect, it } from "vitest";

import { runBulk } from "../src/agent/content/bulk.js";
import { BUDGET_NOTE, budgetNote, createTurnBudget } from "../src/agent/turnBudget.js";

describe("turn token budget", () => {
  it("counts input and output tokens of every step against the limit", () => {
    const budget = createTurnBudget(100);

    budget.add({ inputTokens: 60, outputTokens: 10 });
    expect(budget.exceeded()).toBe(false);
    budget.add(undefined);
    budget.add({ inputTokens: 30 });
    expect(budget.spent).toBe(100);
    expect(budget.exceeded()).toBe(true);
  });

  it("never stops a request when the limit is 0", () => {
    const budget = createTurnBudget(0);

    budget.add({ inputTokens: 10_000_000 });
    expect(budget.exceeded()).toBe(false);
  });

  it("adds the note only when the agent was stopped with work still to do", () => {
    const budget = createTurnBudget(10);

    expect(budgetNote(budget, "tool-calls")).toBe("");
    budget.add({ inputTokens: 10 });
    expect(budgetNote(budget, "tool-calls")).toBe(BUDGET_NOTE);
    expect(budgetNote(budget, "stop")).toBe("");
    expect(budgetNote(undefined, "tool-calls")).toBe("");
  });

  it("starts no new document of a bulk run once the budget is used up", async () => {
    const budget = createTurnBudget(100);
    const started: (string | number)[] = [];
    const summary = await runBulk(
      [1, 2, 3, 4],
      async (id) => {
        started.push(id);
        budget.add({ inputTokens: 60 });

        return { id, status: "done" };
      },
      { op: "test", collection: "things", concurrency: 1, budget }
    );

    expect(started).toEqual([1, 2]);
    expect(summary.done).toBe(2);
    expect(summary.remaining).toEqual([3, 4]);
  });
});

describe("turn token budget and the run callbacks", () => {
  const step: any = {
    usage: { inputTokens: 40, outputTokens: 10 },
    toolCalls: [],
    toolResults: [],
  };

  it("counts the steps of a run with and without a telemetry store", async () => {
    const { createAgentCallbacks } = await import("../src/agent/telemetry.js");
    const budget = createTurnBudget(1000);
    const storage: any = { keepsContent: false, record: async () => undefined };

    createAgentCallbacks("main", undefined, null, { budget }).onStepFinish(step);
    createAgentCallbacks("content-editor", "conv1", storage, { budget }).onStepFinish(step);
    expect(budget.spent).toBe(100);
  });
});
