const NORMAL_ENDINGS = new Set(["stop", "tool-calls"]);

export const CUT_OFF_NOTE =
  "\n\n⚠ The model stopped before it finished, so nothing more was done. Send the request again.";

export function cutOffNote(finishReason: string | undefined): string {
  return finishReason && !NORMAL_ENDINGS.has(finishReason) ? CUT_OFF_NOTE : "";
}

/** The most steps of one request of the main agent. */
export const MAX_TURN_STEPS = 30;

export const STEP_LIMIT_NOTE = `\n\n⚠ This request reached its limit of ${MAX_TURN_STEPS} steps, so the agent stopped here. What it saved stays saved. Send a message to go on.`;

/** The agent was stopped by the step limit with work still to do. */
export function stepLimitNote(steps: number, finishReason: string | undefined): string {
  return steps >= MAX_TURN_STEPS && finishReason === "tool-calls" ? STEP_LIMIT_NOTE : "";
}
