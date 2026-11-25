import { pageTitleOf } from "./pageTitle.js";
import { createTurnBudget } from "./turnBudget.js";
import { createUIMessageStreamResponse } from "ai";
import type { UIMessage } from "ai";
import type { BasePayload, TypedUser } from "payload";
import type { SchemaContext, ResolvedPluginOptions } from "../types.js";
import type { MemoryService } from "../memory/index.js";
import { captureWaitUntil } from "./keepAlive.js";
import { createAgentCallbacks } from "./telemetry.js";
import { principalOf } from "../api/principal.js";
import type { TurnMemory, TurnScope } from "./runAgent/scope.js";
import {
  checkConversationOwner,
  loadTurnMemory,
  normalizeTurnAttachments,
} from "./runAgent/prepare.js";
import {
  assembleTools,
  buildInstructionMessages,
  buildModelMessages,
  connectTurn,
  createTurnRecorder,
  describeToolCoverage,
  loadAgentInstructions,
} from "./runAgent/assemble.js";
import { createOnFinish } from "./runAgent/finish.js";
import { createTurnStream } from "./runAgent/stream.js";
import { resolveMcpUrl } from "./mcpUrl.js";
import { requestApprovals } from "./content/manyDocuments.js";

export interface PageContext {
  collection?: string;
  documentId?: string;
  global?: string;
}

export interface AgentRequestParams {
  messages: UIMessage[];
  payload: BasePayload;
  user: TypedUser;
  schema: SchemaContext;
  options: ResolvedPluginOptions;
  pageContext?: PageContext;
  memory?: MemoryService | null;
  conversationId?: string;
  /** The IANA time zone of the person's browser. Modules read it for reports by day. */
  timeZone?: string;
  signal?: AbortSignal;
  /** The login headers of the chat request: a file of the site opens with the person's rights. */
  sessionHeaders?: Record<string, string>;
}

export async function runAgent({
  messages,
  payload,
  user,
  schema,
  options,
  pageContext,
  memory,
  conversationId,
  timeZone,
  signal,
  sessionHeaders,
}: AgentRequestParams): Promise<Response> {
  const userId = principalOf(user, payload);
  const waitUntil = captureWaitUntil();
  const turnMemory: TurnMemory = { promptAdditions: "", assembledContext: undefined };

  const { messages: normalizedMessages, outcomes: attachmentOutcomes } =
    await normalizeTurnAttachments(messages);

  messages = normalizedMessages;

  const owner = await checkConversationOwner({ memory, conversationId, userId });

  if (owner.refusal) return owner.refusal;
  const memoryOk = owner.memoryOk;

  if (memory && conversationId && memoryOk) {
    await loadTurnMemory(
      { memory, conversationId, userId, messages, attachmentOutcomes, schema },
      turnMemory
    );
  }

  const mcpAbsoluteUrl = resolveMcpUrl(options.mcpUrl, payload.config);
  const activeMemory = memoryOk ? memory : null;
  const telemetry = activeMemory?.telemetry ?? null;

  const writeTracker = { count: 0, reports: 0, failed: 0 };
  const turn: TurnScope = {
    messages,
    payload,
    user,
    schema,
    options,
    pageContext,
    pageTitle: await pageTitleOf({ payload, user, schema, mcpOnly: options.mcpOnly }, pageContext),
    conversationId,
    timeZone,
    signal,
    userId,
    waitUntil,
    activeMemory,
    telemetry,
    turnMemory,
    writeTracker,
    approvals: requestApprovals(messages),
    budget: createTurnBudget(options.turnTokenBudget),
    request: { sessionHeaders },
  };
  const recordEdits = createTurnRecorder(turn);

  const [mcpTools, moduleTurn] = await connectTurn(turn, mcpAbsoluteUrl, recordEdits);

  const toolAvailabilityNote = describeToolCoverage(turn, mcpTools, mcpAbsoluteUrl);
  const agentInstructions = await loadAgentInstructions(turn);
  const instructions = buildInstructionMessages(turn, {
    toolAvailabilityNote,
    moduleTurn,
    agentInstructions,
  });
  const tools = assembleTools(turn, { mcpTools, moduleTurn, agentInstructions, recordEdits });
  const modelMessages = await buildModelMessages(turn);

  const mainCallbacks = createAgentCallbacks("main", conversationId, telemetry, {
    model: options.model,
    budget: turn.budget,
  });
  const onFinish = createOnFinish(turn, mainCallbacks);

  const stream = createTurnStream({
    turn,
    instructions,
    tools,
    modelMessages,
    mainCallbacks,
    onFinish,
  });

  return createUIMessageStreamResponse({ stream });
}
