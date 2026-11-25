import { budgetNote } from "../turnBudget.js";
import { ToolLoopAgent, isStepCount, createUIMessageStream } from "ai";
import type { ModelMessage, SystemModelMessage } from "ai";
import type { TurnContext } from "../../borders.js";
import { approvalSecret, awaitsPerson, decideApproval } from "../approvals.js";
import { MAX_TURN_STEPS, cutOffNote, stepLimitNote } from "../turnEnd.js";
import { describeTurnError } from "../turnErrors.js";
import type { createTools } from "../tools/index.js";
import type { McpServerTools } from "../mcpClient.js";
import type { createAgentCallbacks } from "../telemetry.js";
import { writeCheck } from "./finish.js";
import type { createOnFinish } from "./finish.js";
import type { TurnScope } from "./scope.js";
import { lowerNumbersToMaximum } from "../repairToolCall.js";

export interface TurnStreamInput {
  turn: TurnScope;
  instructions: SystemModelMessage[];
  tools: ReturnType<typeof createTools<McpServerTools[string]>>;
  modelMessages: ModelMessage[];
  mainCallbacks: ReturnType<typeof createAgentCallbacks>;
  onFinish: ReturnType<typeof createOnFinish>;
}

export function createTurnStream({
  turn,
  instructions,
  tools,
  modelMessages,
  mainCallbacks,
  onFinish,
}: TurnStreamInput) {
  const { options, signal, writeTracker, approvals, budget } = turn;

  return createUIMessageStream({
    // The reply after the person's click goes on in the message that asked,
    // so the stream must carry the id of that message and not a new one.
    originalMessages: turn.messages,
    execute: async ({ writer }) => {
      const turnContext: TurnContext = {
        writer,
        requestStartedAt: Date.now(),
        contentEditorRuns: {},
      };
      const agent = new ToolLoopAgent({
        model: options.model,
        instructions,
        tools,
        repairToolCall: lowerNumbersToMaximum,
        stopWhen: [isStepCount(MAX_TURN_STEPS), () => budget.exceeded()],
        // Explicit: for a model id it does not know, the AI SDK falls back to a 4096-token default.
        maxOutputTokens: 16000,
        reasoning: options.reasoningEffort ?? "none",
        providerOptions: { openai: { reasoningSummary: "auto" } },
        // Tool names are known only at run time,
        // and the AI SDK types the context per static tool name.
        toolsContext: Object.fromEntries(
          Object.entries(tools)
            .filter(([, tool]) => tool?.contextSchema)
            .map(([name]) => [name, turnContext])
        ) as never,
        toolApproval: ({ toolCall }) => decideApproval(approvals, toolCall, signal),
        // Without the signature a client could send an approval the person never gave:
        // the server rebuilds the conversation from the messages of the request.
        experimental_toolApprovalSecret: approvalSecret(turn.payload.secret),
        onStepEnd: mainCallbacks.onStepFinish,
        onToolExecutionEnd: mainCallbacks.onToolExecutionEnd,
        onEnd: onFinish,
      });
      const result = await agent.stream({
        messages: modelMessages,
        ...(signal ? { abortSignal: signal } : {}),
      });

      writer.merge(result.toUIMessageStream({ onError: describeTurnError }));
      // A provider error or an abort before the first step never reaches onFinish.
      // This rejection is the only place such a run is recorded as failed.
      await Promise.resolve(result.text).catch((err) => {
        mainCallbacks.runFinished({
          ok: false,
          error: signal?.aborted ? "aborted" : err instanceof Error ? err.message : String(err),
        });

        return "";
      });

      const finishReason = signal?.aborted
        ? undefined
        : await Promise.resolve(result.finishReason).catch(() => undefined);
      const steps = signal?.aborted ? [] : await Promise.resolve(result.steps).catch(() => []);
      const check = writeCheck(writeTracker, steps);

      if (check) {
        writer.write({ type: "text-start", id: "write-check" });
        writer.write({ type: "text-delta", id: "write-check", delta: check });
        writer.write({ type: "text-end", id: "write-check" });
      }

      const note = signal?.aborted
        ? ""
        : cutOffNote(finishReason) ||
          budgetNote(budget, finishReason) ||
          (awaitsPerson(steps) ? "" : stepLimitNote(steps.length, finishReason));

      if (note) {
        writer.write({ type: "text-start", id: "cut-off" });
        writer.write({ type: "text-delta", id: "cut-off", delta: note.trimStart() });
        writer.write({ type: "text-end", id: "cut-off" });
      }
    },
    onError: (err) => {
      console.error("[Content Agent] Stream execute error:", err);

      return "An error occurred while processing your request.";
    },
  });
}
