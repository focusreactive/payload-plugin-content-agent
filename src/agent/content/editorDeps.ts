import type { TurnBudget } from "../turnBudget.js";
import type { LanguageModel } from "ai";
import type { AgentInstruction, SchemaContext } from "../../types.js";
import type { TelemetryStorage } from "../../memory/storage/telemetry.js";
import type { DocumentIO } from "./documentIo.js";
import type { LinkProbe } from "./links.js";
import type { EditRecordRef } from "../../types.js";
import type { PendingBulkStore } from "./editorBulk.js";
import type { TurnApprovals } from "../approvals.js";

type EditedDocRef = EditRecordRef;

export interface ContentEditorDeps {
  io: DocumentIO;
  schema: SchemaContext;
  model: LanguageModel;
  concurrency: number;
  bulkTimeBudgetMs?: number;
  telemetry?: TelemetryStorage | null;
  conversationId?: string;
  pendingStore?: PendingBulkStore;
  /** The person's clicks of this request. Without it a run above the threshold is refused. */
  approvals?: TurnApprovals;
  recordEdits?: (refs: EditedDocRef[]) => void;
  config?: import("payload").SanitizedConfig;
  agentInstructions?: AgentInstruction[];
  probeLink?: LinkProbe;
  /** The tokens of this chat request. A bulk run starts no new document once it is used up. */
  budget?: TurnBudget;
  /** The text of the person's last message in the chat, as they wrote it. */
  personMessage?: string;
}

export const LLM_MAX_RETRIES = 5;
