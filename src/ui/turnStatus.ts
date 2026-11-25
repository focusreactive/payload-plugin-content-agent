import { isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { isRecord } from "./lib/narrow.js";

export type StepPhase = "pending" | "running" | "done" | "error" | "interrupted";

export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export function isTurnLive(isLastMessage: boolean, status: ChatStatus | string): boolean {
  return isLastMessage && (status === "submitted" || status === "streaming");
}

export function toolPhase(part: { state?: string }, live: boolean): StepPhase {
  switch (part.state) {
    case "output-available":
      return "done";
    case "output-error":
    case "output-denied":
      return "error";
    case "input-streaming":
      return live ? "pending" : "interrupted";
    default:
      return live ? "running" : "interrupted";
  }
}

const VERBS: Record<string, string> = {
  find: "Searching",
  search: "Searching",
  list: "Listing",
  lookup: "Looking up",
  read: "Reading",
  get: "Reading",
  create: "Creating",
  update: "Updating",
  delete: "Deleting",
  edit: "Editing",
  apply: "Applying",
  translate: "Translating",
  import: "Importing",
  clone: "Cloning",
  copy: "Copying",
  insert: "Inserting",
  move: "Moving",
  remove: "Removing",
  set: "Setting",
  review: "Reviewing",
  trim: "Trimming",
  bulk: "Updating",
};

const NAMED: Record<string, string> = {
  web: "Reading the web",
  reflect: "Recalling past conversations",
  findReplaceContent: "Replacing content",
  proposeGlossaryEntry: "Preparing a glossary line",
  present_table: "Preparing a table",
  present_metrics: "Preparing the figures",
  present_chart: "Preparing a chart",
};

const words = (text: string) =>
  text
    .replace(/[_-]+/gu, " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);

export function activityLabel(toolName: string): string {
  if (NAMED[toolName]) return NAMED[toolName];
  const sep = toolName.indexOf("__");

  if (sep > 0) return `${toolName.slice(0, sep)}: ${words(toolName.slice(sep + 2)).join(" ")}`;
  const [first = "", ...rest] = words(toolName);
  const verb = VERBS[first];

  if (verb) return rest.length ? `${verb} ${rest.join(" ")}` : verb;
  const all = [first, ...rest].join(" ");

  return all.charAt(0).toUpperCase() + all.slice(1);
}

// What a running step works on.
// Without it two steps of one tool at one time look like one step shown twice.
export function activityTarget(input: unknown): string {
  if (!isRecord(input)) return "";
  const target = input.collection ?? input.global;

  return typeof target === "string" ? target : "";
}

// A step in one of these states draws its own live line or its card, so the reply needs no
// second one. A step that waits for the answer of the person is not thinking.
const STEP_SHOWS_ITSELF = new Set([
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

/** A progress card after the step shows the work, so the step itself draws no loader. */
export const progressCardFollows = (parts: UIMessage["parts"], index: number): boolean =>
  parts.slice(index + 1).some((part) => part.type === "data-content-ops");

// The reply shows one live line at a time. A progress card counts by its latest state, the one
// the reply draws.
function replyShowsLiveLine(parts: UIMessage["parts"]): boolean {
  const progress = new Map<string, unknown>();

  for (const part of parts) {
    if (isToolUIPart(part) && STEP_SHOWS_ITSELF.has(part.state)) return true;
    if ((part.type === "text" || part.type === "reasoning") && part.state === "streaming")
      return true;
    if (part.type === "data-content-ops") progress.set(part.id ?? "", part.data);
  }

  return [...progress.values()].some((data) => !(isRecord(data) && data.phase === "done"));
}

export function showsThinking(
  lastMessage: { role?: string; parts?: UIMessage["parts"] } | undefined,
  status: ChatStatus | string
): boolean {
  if (status !== "submitted" && status !== "streaming") return false;
  if (!lastMessage || lastMessage.role !== "assistant") return true;
  const parts = lastMessage.parts ?? [];

  if (replyShowsLiveLine(parts)) return false;
  const trailing = parts[parts.length - 1];

  // The text is the last thing a step sends before a tool call or the end of the turn.
  // After the last text the server still saves the turn, and that is not thinking.
  return !(status === "streaming" && trailing?.type === "text" && trailing.state === "done");
}
