import type { TemporalMessage, TemporalSummary } from "./storage/temporal.js";
import type { PresentState } from "./storage/present.js";
import type { LtmEntry } from "./storage/ltm.js";
import type { BackgroundReport } from "./storage/backgroundReports.js";

export interface ContextBudget {
  compactionThreshold: number;
  compactionTarget: number;
  compactionHardLimit: number;
  recencyBufferMessages: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  compactionThreshold: 30000,
  compactionTarget: 20000,
  compactionHardLimit: 60000,
  recencyBufferMessages: 6,
};

export type TemporalViewItem =
  | { kind: "message"; data: TemporalMessage }
  | { kind: "summary"; data: TemporalSummary };

export interface AssembledContext {
  temporalView: TemporalViewItem[];
  /** The oldest messages the hard limit left out of the view. */
  droppedMessages?: number;
  totalTokens: number;
  needsCompaction: boolean;
  presentState: PresentState | null;
  ltmIdentity: LtmEntry | null;
  ltmBehavior: LtmEntry | null;
  backgroundReports: BackgroundReport[];
}

interface FinalView {
  view: TemporalViewItem[];
  droppedMessages: number;
  totalTokens: number;
  needsCompaction: boolean;
}

function finalizeView(view: TemporalViewItem[], budget: ContextBudget): FinalView {
  let totalTokens = view.reduce((sum, item) => sum + item.data.tokenEstimate, 0);
  let droppedMessages = 0;

  if (totalTokens > budget.compactionHardLimit) {
    const firstMessageIdx = view.findIndex((item) => item.kind === "message");

    if (firstMessageIdx !== -1) {
      let start = firstMessageIdx;
      const messageCount = view.length - firstMessageIdx;
      const minKeep = Math.max(0, budget.recencyBufferMessages);

      while (totalTokens > budget.compactionHardLimit && view.length - start > minKeep) {
        totalTokens -= view[start].data.tokenEstimate;
        start++;
      }

      if (start > firstMessageIdx) {
        droppedMessages = start - firstMessageIdx;

        console.warn(
          `[Content Agent] Context hard limit (${budget.compactionHardLimit} tokens) hit - dropped the ${droppedMessages} oldest of ${messageCount} un-summarized message(s) from the prompt (they remain stored and will compact when distillation runs).`
        );
        view = [...view.slice(0, firstMessageIdx), ...view.slice(start)];
      }
    }
  }

  return {
    view,
    droppedMessages,
    totalTokens,
    needsCompaction: totalTokens > budget.compactionThreshold,
  };
}

function filterSubsumedSummaries(summaries: TemporalSummary[]): TemporalSummary[] {
  const sorted = [...summaries].sort((a, b) => b.orderNum - a.orderNum);
  const active: TemporalSummary[] = [];
  const coveredRanges: Array<{ startId: string; endId: string }> = [];

  for (const summary of sorted) {
    const isSubsumed = coveredRanges.some(
      (range) => summary.startId >= range.startId && summary.endId <= range.endId
    );

    if (!isSubsumed) {
      active.push(summary);
      coveredRanges.push({ startId: summary.startId, endId: summary.endId });
    }
  }

  return active.sort((a, b) => (a.startId < b.startId ? -1 : 1));
}

export function buildTemporalView(
  messages: TemporalMessage[],
  allSummaries: TemporalSummary[],
  budget: ContextBudget
): FinalView {
  // orderNum 0 is a search-only summary of the whole conversation: it must not count as
  // compaction coverage, or it would trim all raw history.
  const summaries = allSummaries.filter((summary) => summary.orderNum > 0);

  if (summaries.length === 0) {
    const view: TemporalViewItem[] = messages.map((message) => ({
      kind: "message",
      data: message,
    }));

    return finalizeView(view, budget);
  }

  const activeSummaries = filterSubsumedSummaries(summaries);

  const coveredRanges = activeSummaries.map((summary) => ({
    startId: summary.startId,
    endId: summary.endId,
  }));

  const uncoveredMessages = messages.filter((message) => {
    return !coveredRanges.some((range) => message.id >= range.startId && message.id <= range.endId);
  });

  const view: TemporalViewItem[] = [
    ...activeSummaries.map((summary) => ({ kind: "summary" as const, data: summary })),
    ...uncoveredMessages.map((message) => ({ kind: "message" as const, data: message })),
  ];

  return finalizeView(view, budget);
}

export function formatTemporalViewForMessages(
  view: TemporalViewItem[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const formatted: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const item of view) {
    if (item.kind === "summary") {
      const summary = item.data;
      const observations = summary.keyObservations
        .map((observation) => `  - ${observation}`)
        .join("\n");

      formatted.push({
        role: "assistant",
        content: `[Distilled summary from ${summary.startId} to ${summary.endId}, level ${summary.orderNum}]\n${summary.narrative}\n\nKey observations:\n${observations}`,
      });
    } else {
      const message = item.data;

      formatted.push({
        role: message.type === "user" ? "user" : "assistant",
        content: message.content,
      });
    }
  }

  return formatted;
}

export function formatPresentState(state: PresentState | null): string {
  if (!state) return "";

  const parts: string[] = ["## Present State"];

  if (state.mission) {
    parts.push(`**Mission**: ${state.mission}`);
  }

  if (state.status) {
    parts.push(`**Status**: ${state.status}`);
  }

  if (state.tasks.length > 0) {
    parts.push("**Tasks**:");

    for (const task of state.tasks) {
      const statusIcon =
        task.status === "completed"
          ? "[x]"
          : task.status === "in_progress"
            ? "[~]"
            : task.status === "blocked"
              ? "[!]"
              : "[ ]";
      let line = `- ${statusIcon} ${task.content}`;

      if (task.blockedReason) line += ` (blocked: ${task.blockedReason})`;
      parts.push(line);
    }
  }

  return parts.join("\n");
}

interface EntryOrigin {
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: Date | string | null;
}

/** Who wrote a memory entry last and on which day: an entry is a dated claim. */
export function entryOrigin({ createdBy, updatedBy, updatedAt }: EntryOrigin): string {
  const writer = updatedBy || createdBy;
  const date = updatedAt ? new Date(updatedAt) : null;
  const day = date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";

  return [writer ? `by ${writer}` : "", day ? `updated ${day}` : ""].filter(Boolean).join(", ");
}

const headingOf = (name: string, entry: LtmEntry): string => {
  const origin = entryOrigin(entry);

  return origin ? `## ${name} (${origin})` : `## ${name}`;
};

export function formatLtmForPrompt(identity: LtmEntry | null, behavior: LtmEntry | null): string {
  const parts: string[] = [];

  if (identity) {
    parts.push(`${headingOf("Identity", identity)}\n${identity.body}`);
  }

  if (behavior) {
    parts.push(`${headingOf("Behavior", behavior)}\n${behavior.body}`);
  }

  return parts.join("\n\n");
}

export function formatBackgroundReports(
  reports: BackgroundReport[]
): Array<{ role: "assistant"; content: string }> {
  return reports.map((report) => ({
    role: "assistant" as const,
    content: `[Background Activity - ${report.subsystem}]: ${
      typeof report.report.summary === "string"
        ? report.report.summary
        : JSON.stringify(report.report)
    }`,
  }));
}

// Positional: assumes the stored messages are exactly
// the user and assistant turns the client sends.
export function trimCoveredUiMessages<Message>(
  uiMessages: Message[],
  view: TemporalViewItem[],
  droppedMessages = 0
): Message[] {
  const summaryCount = view.filter((item) => item.kind === "summary").length;

  // With no summary the view and the client hold the same messages, so the messages the hard
  // limit dropped are the oldest of the client: the last one, the request, always stays.
  if (summaryCount === 0)
    return droppedMessages > 0
      ? uiMessages.slice(Math.min(droppedMessages, uiMessages.length - 1))
      : uiMessages;
  const uncovered = view.length - summaryCount;
  const covered = Math.max(0, uiMessages.length - uncovered);

  return covered > 0 ? uiMessages.slice(covered) : uiMessages;
}
