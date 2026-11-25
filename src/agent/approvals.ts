import { createHmac } from "node:crypto";
import { isRecord } from "../borders.js";
import { approvalReason, withLiveNotice } from "../approvalRequest.js";
import type { LiveTarget } from "../approvalRequest.js";

export interface PersonApproval {
  type: "user-approval";
  reason: string;
}

export type ApprovalPolicy = (
  input: unknown,
  toolCallId: string,
  /** The request's signal: the AI SDK gives the approval check none of its own. */
  signal?: AbortSignal
) => Promise<PersonApproval | undefined> | PersonApproval | undefined;

export interface TurnApprovals {
  policies: Map<string, ApprovalPolicy>;
  /** Tool calls the chat asked the person about in this request. */
  asked: Set<string>;
  /** The documents of a run on many documents, fixed when the policy read them. */
  scopes: Map<string, (string | number)[]>;
  /** The target of a write tool call when it has no drafts: a change there is live at once. */
  liveTarget?: (toolName: string, input: unknown) => LiveTarget | null;
  /** The documents and globals without drafts that the person opened in this request. */
  live: Set<string>;
  /** The documents and globals this request changed with no confirmation of the person. */
  written: Set<string>;
  /** The documents and globals of the tool calls the person confirmed in this request. */
  confirmed: Set<string>;
  /** Asks before a tool call that changes one more document than a request may by itself. */
  nextDocument?: (toolName: string, input: unknown) => Promise<PersonApproval | undefined>;
}

/** One document of a collection, or one global. */
export const liveKey = (
  target: { collection?: string; global?: string },
  id?: string | number
): string =>
  target.global ? `global:${target.global}` : `collection:${target.collection}:${String(id)}`;

export const createTurnApprovals = (): TurnApprovals => ({
  policies: new Map(),
  asked: new Set(),
  scopes: new Map(),
  live: new Set(),
  written: new Set(),
  confirmed: new Set(),
});

export const askPerson = (reason: string): PersonApproval => ({ type: "user-approval", reason });

export interface ApprovalToolCall {
  toolName: string;
  toolCallId: string;
  input: unknown;
}

export async function decideApproval(
  approvals: TurnApprovals,
  { toolName, toolCallId, input }: ApprovalToolCall,
  signal?: AbortSignal
): Promise<PersonApproval | undefined> {
  const policy = approvals.policies.get(toolName);

  try {
    const live = approvals.liveTarget?.(toolName, input) ?? null;
    const asked =
      (await policy?.(input, toolCallId, signal)) ??
      (await approvals.nextDocument?.(toolName, input));
    const decision = live
      ? askPerson(
          asked ? withLiveNotice(asked.reason) : approvalReason({ kind: "live-write", ...live })
        )
      : asked;

    if (decision) approvals.asked.add(toolCallId);

    return decision;
  } catch (err) {
    // The tool itself refuses a call that needs the person and was not asked about.
    console.warn(
      `[Content Agent] The approval check of ${toolName} failed:`,
      err instanceof Error ? err.message : err
    );

    return undefined;
  }
}

export function personApproved(
  approvals: TurnApprovals | undefined,
  toolCallId: string | undefined
): boolean {
  return Boolean(approvals && toolCallId && approvals.asked.has(toolCallId));
}

/** The turn stops at a question: its last step asks the person about a tool call. */
export const awaitsPerson = (
  steps: ReadonlyArray<{ content?: ReadonlyArray<unknown> }> | undefined
): boolean =>
  (steps?.at(-1)?.content ?? []).some(
    (part) => isRecord(part) && part.type === "tool-approval-request" && !part.isAutomatic
  );

/** The same on every server instance: one signs the request and another may verify the answer. */
export const approvalSecret = (payloadSecret: string): string =>
  createHmac("sha256", payloadSecret).update("content-agent:tool-approval").digest("hex");
