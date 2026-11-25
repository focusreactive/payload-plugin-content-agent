"use client";

import React from "react";
import { getToolName } from "ai";
import { Ban, CircleHelp, TriangleAlert } from "lucide-react";
import { parseApprovalRequest } from "../../approvalRequest.js";
import type { ApprovalRequest } from "../../approvalRequest.js";
import { cn } from "../lib/cn.js";
import { ApprovalRequestBody, Promises, isLive, useApprovalCopy } from "./approvalRequestView.js";
import type { ApprovalCopy } from "./approvalRequestView.js";
import { RunningStep } from "./stepStatus.js";
import type { ToolPart } from "./toolCall.js";

export type AnswerApproval = (answer: { id: string; approved: boolean }) => void;

const ApprovalContext = React.createContext<AnswerApproval | null>(null);

export const ApprovalProvider = ApprovalContext.Provider;

export const awaitsApproval = (part: ToolPart): boolean =>
  part.state === "approval-requested" ||
  part.state === "approval-responded" ||
  part.state === "output-denied";

const BUTTON =
  "cursor-pointer rounded-md border px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-85 " +
  "focus-visible:outline-ca-accent focus-visible:outline-2 focus-visible:outline-offset-2";

const PLAIN_COPY: ApprovalCopy = {
  question: "Confirm before the agent goes on",
  confirm: "Confirm",
  cancel: "Cancel",
  promises: ["Nothing is written until you confirm."],
};

const CANCELLED = "Cancelled - nothing was changed";
// The request already changed documents before this question: "nothing" would not be true.
const STOPPED =
  "Stopped - this document was not changed. The changes before it stay as drafts for your review.";

function Cancelled({ requestReason }: { requestReason?: string }) {
  const stopped = parseApprovalRequest(requestReason)?.kind === "more-documents";

  return (
    <div className="border-ca-border bg-ca-surface text-ca-muted my-2 flex items-center gap-2 rounded-[10px] border px-3 py-2 text-xs">
      <Ban className="size-3 shrink-0" aria-hidden />
      <span>{stopped ? STOPPED : CANCELLED}</span>
    </div>
  );
}

interface AskProps {
  copy: ApprovalCopy;
  risky: boolean;
  children: React.ReactNode;
  onAnswer?: (approved: boolean) => void;
}

function Ask({ copy, risky, children, onAnswer }: AskProps) {
  const Icon = risky ? TriangleAlert : CircleHelp;

  return (
    <section
      aria-label={copy.question}
      className="border-ca-border bg-ca-bg text-ca-fg my-2 overflow-hidden rounded-[12px] border text-xs shadow-sm"
    >
      <div
        className={cn(
          "flex items-start gap-2 border-b px-3 py-2.5",
          risky ? "border-ca-warn/30 bg-ca-warn/10" : "border-ca-border bg-ca-surface"
        )}
      >
        <Icon
          className={cn("mt-0.5 size-4 shrink-0", risky ? "text-ca-warn" : "text-ca-accent")}
          aria-hidden
        />
        <div className="text-[13px] leading-snug font-semibold">{copy.question}</div>
      </div>
      <div className="px-3 pt-0 pb-3">
        {children}
        <Promises lines={copy.promises} />
        {onAnswer && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onAnswer(true)}
              className={cn(
                BUTTON,
                "border-transparent",
                risky ? "bg-ca-warn text-ca-bg" : "bg-ca-accent text-ca-accent-fg"
              )}
            >
              {copy.confirm}
            </button>
            <button
              type="button"
              onClick={() => onAnswer(false)}
              className={cn(BUTTON, "border-ca-border-strong text-ca-fg bg-transparent")}
            >
              {copy.cancel}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function StructuredAsk({
  request,
  onAnswer,
}: {
  request: ApprovalRequest;
  onAnswer?: (approved: boolean) => void;
}) {
  return (
    <Ask
      copy={useApprovalCopy(request)}
      risky={request.kind === "risky-update" || isLive(request)}
      onAnswer={onAnswer}
    >
      <ApprovalRequestBody request={request} />
    </Ask>
  );
}

export function ApprovalCard({
  part,
  progressShown = false,
}: {
  part: ToolPart;
  progressShown?: boolean;
}) {
  const answer = React.useContext(ApprovalContext);

  if (part.state === "output-denied")
    return <Cancelled requestReason={part.approval.requestReason} />;

  if (part.state === "approval-responded") {
    if (!part.approval.approved) return <Cancelled requestReason={part.approval.requestReason} />;

    return progressShown ? null : <RunningStep toolName={getToolName(part)} />;
  }

  if (part.state !== "approval-requested") return null;
  const { id, requestReason } = part.approval;
  const request = parseApprovalRequest(requestReason);
  const onAnswer = answer ? (approved: boolean) => answer({ id, approved }) : undefined;

  if (request) return <StructuredAsk request={request} onAnswer={onAnswer} />;

  return (
    <Ask copy={PLAIN_COPY} risky onAnswer={onAnswer}>
      {requestReason && (
        <p className="m-0 mt-3 leading-relaxed break-words whitespace-pre-wrap">{requestReason}</p>
      )}
    </Ask>
  );
}
