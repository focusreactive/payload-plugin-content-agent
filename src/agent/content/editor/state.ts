import type { ChangeClass } from "../changeClass.js";
import type { SchemaField } from "../../../types.js";
import type { DocumentWorkspace } from "../blockTools.js";
import type { DocTarget } from "../documentIo.js";
import type { ContentEditorDeps } from "../editorDeps.js";
import type { LinkIssues, UnresolvedLink } from "../links.js";
import type { CriterionResult, OutcomeState } from "../outcomeCriteria.js";

export interface EditorRunOptions {
  deps: ContentEditorDeps;
  target: DocTarget;
  id: string | number | undefined;
  instruction: string;
  /** The document the task names as the model for this one, as the caller declared it. */
  modelDocument?: string;
  /** One document in a chat turn: the editor may stop with a question for the person. */
  canAsk?: boolean;
  signal?: AbortSignal;
  locale?: string;
  writeLocale?: string;
  maxSteps?: number;
  /** The tool call of the agent above that started this run. */
  parentToolCallId?: string;
  onStep?: (info: { step: number; lastTool?: string }) => void;
  /** Called right before the draft is written. */
  onSaveStart?: () => void;
}

export type EditorRunResult = {
  id: string | number;
  status: "done" | "unchanged" | "rejected" | "error" | "needsInput";
  question?: string;
  summary?: string;
  reviewReason?: string;
  error?: string;
  issues?: string[];
  changes?: string[];
  changeClass?: ChangeClass;
};

/** Shared by the steps of one editor session: every step reads and writes the same object. */
interface SessionState {
  finishCalls: number;
  /** The last finishEdit accepted a changed document: the session ends there. */
  finished: boolean;
  unresolvedLinks: UnresolvedLink[];
  criteriaResults: CriterionResult[];
  retargeted: LinkIssues["retargeted"];
  summary: string;
  reviewReason: string;
  question: string;
  /** The telemetry id of the editor run. */
  runId?: string;
}

export interface SessionContext {
  run: EditorRunOptions;
  docId: string | number;
  workspace: DocumentWorkspace;
  fields: SchemaField[];
  outcome: OutcomeState;
  isTranslation: boolean;
  shrinkRatio: () => number | null;
  state: SessionState;
}

export const docChanged = ({ workspace }: SessionContext) =>
  JSON.stringify(workspace.ref.current) !== JSON.stringify(workspace.original);

/** The workspace differed from the original, yet the save found no changed field. */
export const savedNothing = (saved: object): boolean =>
  "changed" in saved &&
  Array.isArray(saved.changed) &&
  saved.changed.length === 0 &&
  !("revertedShared" in saved);
