/** The tokens every agent of one chat request has used, against the limit of the host. */
export interface TurnBudget {
  readonly limit: number;
  readonly spent: number;
  add: (usage: { inputTokens?: number; outputTokens?: number } | undefined) => void;
  exceeded: () => boolean;
}

/** A limit of 0 means no limit. */
export function createTurnBudget(limit: number): TurnBudget {
  let spent = 0;

  return {
    limit,
    get spent() {
      return spent;
    },
    add(usage) {
      spent += (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
    },
    exceeded: () => limit > 0 && spent >= limit,
  };
}

export const BUDGET_NOTE =
  "\n\n⚠ This request reached its token limit, so the agent stopped here. What it saved stays saved. Send a message to go on.";

/** The agent was stopped between two steps, with work still to do. */
export const budgetNote = (budget: TurnBudget | undefined, finishReason: string | undefined) =>
  budget?.exceeded() && finishReason === "tool-calls" ? BUDGET_NOTE : "";
