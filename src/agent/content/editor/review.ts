import { generateText, Output } from "ai";
import { z } from "zod";
import { isRecord } from "../../../borders.js";
import { REVIEWER_INSTRUCTIONS } from "../../subAgents/reviewer.js";
import { describeLink } from "../links.js";
import { judgementQuestions } from "../outcomeCriteria.js";
import { buildSubAgentInstructionsNote } from "../../instructions.js";
import { modelFacts } from "../../telemetry.js";
import { LLM_MAX_RETRIES } from "../editorDeps.js";
import type { ChangeClass } from "../changeClass.js";
import type { SessionContext } from "./state.js";
import { quiet } from "../../../promises.js";

const reviewSchema = z.object({ approved: z.boolean(), reason: z.string() });

// An answer cut at the cap is not valid JSON and the review is lost: the cap leaves room for a
// long reason, also in a script that takes more tokens per word.
const REVIEW_MAX_OUTPUT_TOKENS = 1000;

export const REVIEW_UNAVAILABLE_REASON = "Review unavailable - not verified";

const tokenCount = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

function usageTokens(usage: unknown) {
  const record = isRecord(usage) ? usage : {};
  const details = isRecord(record.inputTokenDetails) ? record.inputTokenDetails : {};

  return {
    inputTokens: tokenCount(record.inputTokens),
    outputTokens: tokenCount(record.outputTokens),
    cacheReadTokens: tokenCount(details.cacheReadTokens),
    cacheWriteTokens: tokenCount(details.cacheWriteTokens),
  };
}

interface ReviewAttempt {
  reviewAttempt: number;
  reviewStartedAt: number;
}

function recordReview(
  { run, state }: SessionContext,
  { reviewAttempt, reviewStartedAt }: ReviewAttempt,
  row: {
    success: boolean;
    error?: string;
    usage?: unknown;
    approved?: boolean;
  }
): void {
  const { deps } = run;

  if (!deps.telemetry || !deps.conversationId) return;
  void quiet(
    deps.telemetry.record({
      conversationId: deps.conversationId,
      agentId: "reviewer",
      eventType: "model_call",
      durationMs: Date.now() - reviewStartedAt,
      ...usageTokens(row.usage),
      success: row.success,
      error: row.error?.slice(0, 500),
      metadata: {
        ...modelFacts(deps.model),
        ...(state.runId ? { parentRunId: state.runId } : {}),
        attempt: reviewAttempt,
        ...(row.approved === undefined ? {} : { approved: row.approved }),
      },
    })
  );
}

/** A criterion the editor declared for the result, which the code checked and found met. */
const hasCheckedOutcome = ({ state }: SessionContext): boolean =>
  state.criteriaResults.some(
    (result) => result.ok && !result.deferred && result.criterion.check.type !== "unchanged"
  );

/**
 * The evidence follows the kind of change. Words changed inside existing fields, with a declared
 * outcome that the code checked: the checks and the list of changes are the evidence. A change
 * of structure, a write into another locale, a question the editor left to a reader and an edit
 * with no checked outcome also get the reviewer: there nothing else says the edit is the task.
 */
export function needsReviewer(session: SessionContext, changeClass: ChangeClass): boolean {
  return (
    changeClass === "structure" ||
    session.isTranslation ||
    judgementQuestions(session.state.criteriaResults).length > 0 ||
    !hasCheckedOutcome(session)
  );
}

/** Kept in the telemetry so the share of edits that go without the reviewer can be counted. */
export function recordReviewSkipped(
  { run, state }: SessionContext,
  changeClass: ChangeClass
): void {
  const { deps } = run;

  if (!deps.telemetry || !deps.conversationId) return;
  void quiet(
    deps.telemetry.record({
      conversationId: deps.conversationId,
      agentId: "reviewer",
      eventType: "review_skipped",
      success: true,
      metadata: { ...(state.runId ? { parentRunId: state.runId } : {}), changeClass },
    })
  );
}

export interface ReviewFacts {
  before: string;
  after: string;
  changes: string[];
  issues: string[];
}

function reviewQuestion(session: SessionContext, facts: ReviewFacts): string {
  const { instruction } = session.run;
  const { summary, retargeted, criteriaResults } = session.state;
  const { before, after, changes, issues } = facts;

  return (
    `Task: ${instruction}\n\nBefore:\n${before}\n\nAfter:\n${after}` +
    `\n\nWhat changed in the document (facts from the diff - judge these):\n${changes.length ? changes.map((change) => `- ${change}`).join("\n") : "- nothing"}` +
    `\n\nEditor summary (the editor's own account - it can be wrong about what it did; where it disagrees with the facts above, the facts win): ${summary}` +
    (retargeted.length > 0
      ? `\n\nLink anchors whose TEXT changed while their TARGET stayed the same:\n` +
        retargeted
          .map((retarget) => `- was "${retarget.textBefore}", now ${describeLink(retarget.link)}`)
          .join("\n")
      : "") +
    (issues.length
      ? `\n\nOpen issues the deterministic checks still list:\n` +
        issues.map((issue) => `- ${issue}`).join("\n")
      : "") +
    (judgementQuestions(criteriaResults).length
      ? `\n\nThe editor declared these as things only a reader can decide - answer each one:\n` +
        judgementQuestions(criteriaResults)
          .map((question) => `- ${question}`)
          .join("\n")
      : "") +
    `\n\nDo the changes match the task without unintended damage?`
  );
}

/** Returns whether the reviewer approved; its reason lands in `session.state.reviewReason`. */
export async function reviewEdit(session: SessionContext, facts: ReviewFacts): Promise<boolean> {
  const { deps, signal } = session.run;
  const { state } = session;
  let approved = false;

  state.reviewReason = REVIEW_UNAVAILABLE_REASON;

  for (let reviewAttempt = 1; reviewAttempt <= 2; reviewAttempt++) {
    const reviewStartedAt = Date.now();
    const attempt: ReviewAttempt = { reviewAttempt, reviewStartedAt };

    try {
      const review = await generateText({
        model: deps.model,
        instructions: `${REVIEWER_INSTRUCTIONS}${buildSubAgentInstructionsNote(deps.agentInstructions ?? [], "review")}`,
        messages: [
          {
            role: "user",
            content: reviewQuestion(session, facts),
          },
        ],
        maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS,
        abortSignal: signal,
        maxRetries: LLM_MAX_RETRIES,
        output: Output.object({ schema: reviewSchema }),
      });

      if (review.output) {
        approved = review.output.approved;
        state.reviewReason = review.output.reason;
      }

      recordReview(session, attempt, {
        success: true,
        usage: review?.usage,
        approved: review?.output?.approved,
      });
      break;
    } catch (err) {
      recordReview(session, attempt, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        usage: isRecord(err) ? err.usage : undefined,
      });
    }
  }

  return approved;
}
