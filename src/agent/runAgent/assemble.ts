import { convertToModelMessages } from "ai";
import type { ModelMessage, SystemModelMessage, UIMessage } from "ai";
import type { EditRecordRef } from "../../types.js";
import { trimCoveredUiMessages } from "../../memory/contextAssembler.js";
import { runModuleTurns } from "../../moduleHost.js";
import { prepareEarlierTurns } from "../earlierTurns.js";
import { buildSystemPrompt } from "../systemPrompt.js";
import { createEditRecorder, createTools } from "../tools/index.js";
import { getMcpTools } from "../mcpClient.js";
import {
  INSTRUCTION_SCOPES,
  buildInstructionsNote,
  describeInjectedInstructions,
  loadInstructions,
} from "../instructions.js";
import { cachedInstructions } from "../promptCache.js";
import {
  analyzeToolCoverage,
  warnMissingTools,
  warnSlugCollisions,
  buildToolAvailabilityNote,
} from "../toolCoverage.js";
import type { TurnScope } from "./scope.js";
import { createFoundUrls, noteToolResults } from "../tools/foundUrls.js";
import type { FoundUrls } from "../tools/foundUrls.js";
import { countFailedWrites } from "./failedWrites.js";
import { McpUnreachableError } from "../mcpUrl.js";

type McpTools = Awaited<ReturnType<typeof getMcpTools>>;
type ModuleTurn = Awaited<ReturnType<typeof runModuleTurns>>;
type AgentInstructions = Awaited<ReturnType<typeof loadInstructions>>;

export function createTurnRecorder(turn: TurnScope) {
  return createEditRecorder({
    memory: turn.activeMemory,
    conversationId: turn.conversationId,
    userId: turn.userId,
    schema: turn.schema,
    writeTracker: turn.writeTracker,
    modules: turn.options.modules,
    waitUntil: turn.waitUntil,
  });
}

async function siteMcpTools(url: string, apiKey: string): Promise<McpTools> {
  try {
    return await getMcpTools(url, apiKey);
  } catch (error) {
    throw new McpUnreachableError(url, error);
  }
}

export function connectTurn(
  turn: TurnScope,
  mcpAbsoluteUrl: string,
  recordEdits: (refs: EditRecordRef[]) => void
): Promise<[McpTools, ModuleTurn]> {
  const {
    payload,
    user,
    userId,
    schema,
    options,
    conversationId,
    timeZone,
    activeMemory,
    writeTracker,
  } = turn;

  const onReport = () => {
    writeTracker.reports += 1;
  };

  return Promise.all([
    siteMcpTools(mcpAbsoluteUrl, options.mcpApiKey),
    runModuleTurns(options.modules, {
      payload,
      user,
      userId,
      schema,
      conversationId,
      timeZone,
      db: activeMemory?.db ?? null,
      recordEdits,
      onReport,
    }),
  ]);
}

export function describeToolCoverage(
  turn: TurnScope,
  mcpTools: McpTools,
  mcpAbsoluteUrl: string
): string {
  const coverage = analyzeToolCoverage(turn.schema, mcpTools);
  // With `mcpOnly` the document layer has no Local API to fall back on.
  const hasLocalFallback = !turn.options.mcpOnly;

  warnMissingTools(coverage, mcpAbsoluteUrl, hasLocalFallback);
  warnSlugCollisions(turn.schema, mcpAbsoluteUrl);

  return buildToolAvailabilityNote(coverage, hasLocalFallback);
}

export async function loadAgentInstructions(turn: TurnScope): Promise<AgentInstructions> {
  const agentInstructions = await loadInstructions(turn.payload, turn.options.instructions);

  if (agentInstructions.length) {
    const injected = INSTRUCTION_SCOPES.map((scope) =>
      describeInjectedInstructions(agentInstructions, scope)
    ).filter(Boolean);

    console.log(`[Content Agent] Editorial instructions active - ${injected.join(" | ")}`);
  }

  return agentInstructions;
}

export function buildInstructionMessages(
  turn: TurnScope,
  {
    toolAvailabilityNote,
    moduleTurn,
    agentInstructions,
  }: {
    toolAvailabilityNote: string;
    moduleTurn: ModuleTurn;
    agentInstructions: AgentInstructions;
  }
): SystemModelMessage[] {
  const { schema, options, pageContext, pageTitle, conversationId, activeMemory, turnMemory } =
    turn;
  const systemPromptParts = buildSystemPrompt({
    schemaContext: schema,
    customInstructions: options.customInstructions,
    pageContext,
    pageTitle,
    memoryAdditions: turnMemory.promptAdditions,
    toolAvailabilityNote,
    schemaPromptMode: options.schemaPromptMode,
    memoryEnabled: Boolean(activeMemory && conversationId),
    glossaryEnabled: Boolean(options.instructions),
    moduleNote: moduleTurn.note,
    alwaysInstructionsNote: buildInstructionsNote(agentInstructions, "always"),
    modulePrompt: moduleTurn.prompt,
  });
  const instructions: SystemModelMessage[] = [cachedInstructions(systemPromptParts.stable)];

  if (systemPromptParts.volatile) {
    instructions.push({ role: "system", content: systemPromptParts.volatile });
  }

  return instructions;
}

const textsOf = (message: UIMessage): string[] =>
  (message.parts ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text);

/** What the agent may fetch: the addresses in the conversation so far, the hosts the person
 *  named and the site itself. Tool results of this turn are added as they come. */
export function foundUrlsOf(messages: UIMessage[], siteUrl?: string): FoundUrls {
  const found = createFoundUrls(siteUrl);

  found.note(messages);
  for (const message of messages)
    if (message.role === "user") for (const text of textsOf(message)) found.noteHosts(text);

  return found;
}

export function lastPersonMessage(messages: UIMessage[]): string | undefined {
  const last = messages.filter((message) => message.role === "user").at(-1);
  const text = last?.parts
    ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  return text || undefined;
}

export function assembleTools(
  turn: TurnScope,
  {
    mcpTools,
    moduleTurn,
    agentInstructions,
    recordEdits,
  }: {
    mcpTools: McpTools;
    moduleTurn: ModuleTurn;
    agentInstructions: AgentInstructions;
    recordEdits: (refs: EditRecordRef[]) => void;
  }
) {
  const foundUrls = foundUrlsOf(turn.messages, turn.payload?.config?.serverURL);
  const tools = createTools(mcpTools, turn.schema, turn.options, {
    memory: turn.activeMemory ?? undefined,
    conversationId: turn.conversationId,
    userId: turn.userId,
    telemetry: turn.telemetry,
    payload: turn.payload,
    user: turn.user,
    request: turn.request,
    moduleTools: moduleTurn.tools,
    agentInstructions,
    writeTracker: turn.writeTracker,
    recordEdits,
    personMessage: lastPersonMessage(turn.messages),
    foundUrls,
    approvals: turn.approvals,
    budget: turn.budget,
  });

  return countFailedWrites(noteToolResults(tools, foundUrls), turn.writeTracker);
}

export async function buildModelMessages(turn: TurnScope): Promise<ModelMessage[]> {
  const { messages, activeMemory } = turn;
  const { assembledContext } = turn.turnMemory;
  // The reply the person just confirmed is not stored yet:
  // the stored history is counted against the messages before it.
  const reply = messages.at(-1)?.role === "assistant" ? messages.slice(-1) : [];
  const earlier = reply.length ? messages.slice(0, -1) : messages;
  const covered = assembledContext
    ? [
        ...trimCoveredUiMessages(
          earlier,
          assembledContext.temporalView,
          assembledContext.droppedMessages
        ),
        ...reply,
      ]
    : messages;
  const uiMessages = prepareEarlierTurns(covered);
  const modelMessages = await convertToModelMessages(uiMessages);

  // Memory context goes in as one user message:
  // Anthropic rejects a conversation that starts with an assistant message.
  if (assembledContext && activeMemory) {
    const contextMsgs = activeMemory.getContextMessages(assembledContext);

    if (contextMsgs.length > 0) {
      const block = contextMsgs
        .map((message) =>
          message.role === "assistant" ? message.content : `[user earlier]: ${message.content}`
        )
        .join("\n\n");

      modelMessages.unshift({
        role: "user",
        content: `<conversation-context>\nThe following is prior context from this conversation (background activity and compacted earlier history). Treat it as already-established context, not a new request:\n\n${block}\n</conversation-context>`,
      });
    }
  }

  return modelMessages;
}
