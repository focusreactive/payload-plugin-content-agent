import { describe, expect, it } from "vitest";
import { discardOutcome } from "../src/ui/useReviewPanel.js";

describe("the line of a discard", () => {
  it("reports a change without its earlier state as failed, with the reason", () => {
    const outcome = discardOutcome(
      [
        { collection: "posts", id: "1", status: "restored" },
        { collection: "posts", id: "2", status: "no-snapshot" },
      ],
      []
    );

    expect(outcome.failed).toBe(true);
    expect(outcome.message).toBe(
      "Discarded in 1 document · 1 failed: the state from before the agent was not kept"
    );
  });

  it("names the error of a failed document", () => {
    const outcome = discardOutcome(
      [{ collection: "posts", id: "3", status: "failed", error: "The document was not found" }],
      []
    );

    expect(outcome).toEqual({ message: "1 failed: The document was not found", failed: true });
  });
});
