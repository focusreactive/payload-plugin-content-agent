import type { TurnBudget } from "../turnBudget.js";
import type { UIMessage } from "ai";
import type { BasePayload, TypedUser } from "payload";
import type { SchemaContext, ResolvedPluginOptions } from "../../types.js";
import type { MemoryService } from "../../memory/index.js";
import type { AssembledContext } from "../../memory/contextAssembler.js";
import type { TelemetryStorage } from "../../memory/storage/telemetry.js";
import type { WaitUntil } from "../keepAlive.js";
import type { PageContext } from "../index.js";
import type { TurnApprovals } from "../approvals.js";
import type { ChatRequestFacts } from "../tools/index.js";

export interface TurnMemory {
  promptAdditions: string;
  assembledContext: AssembledContext | undefined;
}

export interface WriteTracker {
  count: number;
  reports: number;
  /** Calls of a write tool that ended with nothing saved. */
  failed: number;
}

export interface TurnScope {
  messages: UIMessage[];
  payload: BasePayload;
  user: TypedUser;
  schema: SchemaContext;
  options: ResolvedPluginOptions;
  pageContext: PageContext | undefined;
  /** The title of the open document, read as the person. Text of the CMS: data. */
  pageTitle: string | undefined;
  conversationId: string | undefined;
  timeZone: string | undefined;
  signal: AbortSignal | undefined;
  userId: string;
  waitUntil: WaitUntil | undefined;
  activeMemory: MemoryService | null | undefined;
  telemetry: TelemetryStorage | null;
  turnMemory: TurnMemory;
  writeTracker: WriteTracker;
  approvals: TurnApprovals;
  budget: TurnBudget;
  request?: ChatRequestFacts;
}
