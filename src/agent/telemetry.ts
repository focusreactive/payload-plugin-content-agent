import type { LanguageModel } from "ai";
import type { AgentStepEvent } from "../borders.js";
import { isRecord } from "../borders.js";
import type { TelemetryStorage } from "../memory/storage/telemetry.js";
import type { TurnBudget } from "./turnBudget.js";
import { ulid } from "ulid";
import { mcpWriteError } from "./mcpParse.js";
import { quiet } from "../promises.js";

const TOOL_INPUT_CAP = 8000;
const TOOL_OUTPUT_CAP = 2000;

function capJson(value: unknown, cap: number): string | undefined {
  if (value === undefined) return undefined;
  let json: string;

  try {
    json = JSON.stringify(value);
  } catch {
    return undefined;
  }

  if (typeof json !== "string") return undefined;

  return json.length > cap ? `${json.slice(0, cap)}…[+${json.length - cap} chars]` : json;
}

/** What started a run: its model, and the tool call of the agent above it. */
export interface RunOrigin {
  model?: LanguageModel;
  parentToolCallId?: string;
  /** The tokens of the chat request: every step of the run counts against it. */
  budget?: TurnBudget;
}

export const modelFacts = (model: LanguageModel | undefined): Record<string, string> =>
  !model
    ? {}
    : typeof model === "string"
      ? { model }
      : { model: model.modelId, provider: model.provider };

interface ToolExecutionEvent {
  toolExecutionMs: number;
  toolCall: { toolCallId: string };
}

export interface AgentCallbacks {
  /** Absent without a telemetry store. */
  runId?: string;
  onStepFinish: (event: AgentStepEvent) => Promise<void> | void;
  onToolExecutionEnd: (event: ToolExecutionEvent) => void;
  runFinished: (extra?: { ok?: boolean; error?: string; finishReason?: string }) => void;
}

const untrackedCallbacks = (budget: TurnBudget | undefined): AgentCallbacks => ({
  onStepFinish: (event) => budget?.add(event.usage),
  onToolExecutionEnd: () => undefined,
  runFinished: () => undefined,
});

interface RunScope {
  telemetry: TelemetryStorage;
  conversationId: string;
  agentId: string;
  runId: string;
  origin: Record<string, string>;
  startedAt: number;
  lastAt: number;
  steps: number;
  finished: boolean;
  toolMs: Map<string, number>;
}

function toolResultError(output: unknown): string | undefined {
  if (isRecord(output) && typeof output.error === "string") {
    return output.error;
  }

  if (isRecord(output) && (output.isError || Array.isArray(output.content))) {
    return mcpWriteError(output) ?? undefined;
  }

  return undefined;
}

function thrownErrorText(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === "string"
      ? err
      : (capJson(err, 500) ?? "tool error");
}

function recordModelCall(scope: RunScope, event: AgentStepEvent, durationMs: number): void {
  const { telemetry, conversationId, agentId, runId, origin } = scope;
  const toolNames = event.toolCalls?.map((toolCall) => toolCall.toolName) ?? [];

  void quiet(
    telemetry.record({
      conversationId,
      agentId,
      stepNumber: event.stepNumber ?? undefined,
      eventType: "step",
      toolName: toolNames.length > 0 ? toolNames.join(",") : undefined,
      durationMs,
      inputTokens: event.usage?.inputTokens,
      outputTokens: event.usage?.outputTokens,
      cacheReadTokens: event.usage?.inputTokenDetails?.cacheReadTokens,
      cacheWriteTokens: event.usage?.inputTokenDetails?.cacheWriteTokens,
      success: true,
      metadata: {
        runId,
        ...origin,
        finishReason: event.finishReason,
        toolNames,
      },
    })
  );
}

function takeToolMs(scope: RunScope, toolCallId: string): number | undefined {
  const ms = scope.toolMs.get(toolCallId);

  scope.toolMs.delete(toolCallId);

  return ms;
}

function recordToolCalls(scope: RunScope, event: AgentStepEvent, durationMs: number): void {
  const { telemetry, conversationId, agentId, runId } = scope;

  for (const toolResult of event.toolResults ?? []) {
    const output: unknown = toolResult.output;
    const errorText = toolResultError(output);

    void quiet(
      telemetry.record({
        conversationId,
        agentId,
        stepNumber: event.stepNumber ?? undefined,
        eventType: "tool_call",
        toolName: toolResult.toolName,
        durationMs: takeToolMs(scope, toolResult.toolCallId),
        success: !errorText,
        error: errorText?.slice(0, 500),
        metadata: {
          runId,
          toolCallId: toolResult.toolCallId,
          stepDurationMs: durationMs,
          ...(telemetry.keepsContent
            ? {
                input: capJson(toolResult.input, TOOL_INPUT_CAP),
                outputPreview: capJson(output, TOOL_OUTPUT_CAP),
              }
            : {}),
        },
      })
    );
  }
}

// A thrown execute() or a call the SDK refused is a `tool-error` content part,
// not a tool result.
function recordToolErrors(scope: RunScope, event: AgentStepEvent, durationMs: number): void {
  const { telemetry, conversationId, agentId, runId } = scope;

  for (const part of event.content ?? []) {
    if (part?.type !== "tool-error") continue;
    const errorText = thrownErrorText(part.error);

    void quiet(
      telemetry.record({
        conversationId,
        agentId,
        stepNumber: event.stepNumber ?? undefined,
        eventType: "tool_call",
        toolName: part.toolName,
        durationMs: takeToolMs(scope, part.toolCallId),
        success: false,
        error: errorText.slice(0, 500),
        metadata: {
          runId,
          toolCallId: part.toolCallId,
          stepDurationMs: durationMs,
          ...(telemetry.keepsContent ? { input: capJson(part.input, TOOL_INPUT_CAP) } : {}),
          thrown: true,
        },
      })
    );
  }
}

function recordRunFinished(
  scope: RunScope,
  extra?: { ok?: boolean; error?: string; finishReason?: string }
): void {
  if (scope.finished) return;
  scope.finished = true;
  void quiet(
    scope.telemetry.record({
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      eventType: "agent_run",
      durationMs: Date.now() - scope.startedAt,
      success: extra?.ok ?? true,
      error: extra?.error?.slice(0, 500),
      metadata: {
        runId: scope.runId,
        ...scope.origin,
        steps: scope.steps,
        ...(extra?.finishReason ? { finishReason: extra.finishReason } : {}),
      },
    })
  );
}

export function createAgentCallbacks(
  agentId: string,
  conversationId?: string,
  telemetry?: TelemetryStorage | null,
  { model, parentToolCallId, budget }: RunOrigin = {}
): AgentCallbacks {
  if (!telemetry || !conversationId) return untrackedCallbacks(budget);

  const startedAt = Date.now();
  const scope: RunScope = {
    telemetry,
    conversationId,
    agentId,
    runId: ulid(),
    origin: { ...modelFacts(model), ...(parentToolCallId ? { parentToolCallId } : {}) },
    startedAt,
    lastAt: startedAt,
    steps: 0,
    finished: false,
    toolMs: new Map(),
  };

  return {
    runId: scope.runId,
    // A tool_call row is written with its step; the time of the call itself comes from here.
    onToolExecutionEnd: (event) => {
      scope.toolMs.set(event.toolCall.toolCallId, Math.round(event.toolExecutionMs));
    },
    onStepFinish: (event) => {
      const now = Date.now();
      const durationMs = now - scope.lastAt;

      scope.lastAt = now;
      scope.steps += 1;
      budget?.add(event.usage);
      recordModelCall(scope, event, durationMs);
      recordToolCalls(scope, event, durationMs);
      recordToolErrors(scope, event, durationMs);
    },

    runFinished: (extra) => recordRunFinished(scope, extra),
  };
}
