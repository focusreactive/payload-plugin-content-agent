import { budgetNote } from "../turnBudget.js";
import type { MemoryService } from "../../memory/index.js";
import type { AssembledContext } from "../../memory/contextAssembler.js";
import { collectVizParts } from "../vizParts.js";
import type { StoredToolPart } from "../vizParts.js";
import { awaitsPerson } from "../approvals.js";
import { cutOffNote, stepLimitNote } from "../turnEnd.js";
import type { createAgentCallbacks } from "../telemetry.js";
import type { TurnScope, WriteTracker } from "./scope.js";
import { caught, quiet } from "../../promises.js";

export const writeWarning = ({ failed }: WriteTracker): string =>
  `\n\n⚠ Check: no saved change was recorded in this turn. The agent called a write tool ${failed} time(s), and every call was refused or failed.`;

/** Read from the facts of the turn, never from the words of the reply. */
export const wroteNothingAfterTrying = (writeTracker: WriteTracker): boolean =>
  writeTracker.count === 0 && writeTracker.failed > 0;

/** None while a card waits for the person: the change in it may still save after the click. */
export const writeCheck = (
  writeTracker: WriteTracker,
  steps: Parameters<typeof awaitsPerson>[0]
): string =>
  wroteNothingAfterTrying(writeTracker) && !awaitsPerson(steps) ? writeWarning(writeTracker) : "";

interface StoredTurn {
  turn: TurnScope;
  activeMemory: MemoryService;
  conversationId: string;
}

async function titleConversation({ turn, activeMemory, conversationId }: StoredTurn) {
  const conv = await activeMemory.conversations.findById(conversationId);

  if (conv && !conv.title) {
    const firstUserMsg = turn.messages.find((message) => message.role === "user");

    if (firstUserMsg) {
      const msgText =
        firstUserMsg.parts
          ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join(" ") ?? "";
      const title = msgText.length > 80 ? msgText.slice(0, 77) + "..." : msgText;

      if (title) await activeMemory.conversations.updateTitle(conversationId, title);
    }
  }
}

function startBackgroundTasks(
  { turn, activeMemory, conversationId }: StoredTurn,
  assembledContext: AssembledContext
) {
  const bgModel = turn.options.backgroundModel ?? turn.options.model;
  const background = caught(
    activeMemory.runBackgroundTasks(conversationId, turn.userId, bgModel, assembledContext),
    (err) => console.error("[Content Agent] Background tasks error:", err)
  );

  turn.waitUntil?.(background);
}

async function persistAssistantTurn(stored: StoredTurn, text: string, vizParts: StoredToolPart[]) {
  const { turn, activeMemory, conversationId } = stored;

  try {
    // An empty answer still gets a row:
    // trimCoveredUiMessages counts stored messages against the client by position.
    await activeMemory.saveMessage(
      conversationId,
      "assistant",
      text || "[tool actions completed with no final text]",
      vizParts
    );

    await titleConversation(stored);

    if (turn.turnMemory.assembledContext) {
      startBackgroundTasks(stored, turn.turnMemory.assembledContext);
    }
  } catch (err) {
    console.error(
      "[Content Agent] onFinish persistence error:",
      err instanceof Error ? err.message : err
    );
  }
}

type FinishedSteps = ReadonlyArray<{
  toolResults?: ReadonlyArray<unknown>;
  content?: ReadonlyArray<unknown>;
}>;

/** Why the agent stopped with work still to do, as a note for the reply and an error for the
 *  telemetry. Empty when it finished. */
function stoppedEarly(
  turn: TurnScope,
  steps: FinishedSteps | undefined,
  finishReason: string | undefined
): { note: string; error?: string } {
  const cutOff = cutOffNote(finishReason);

  if (cutOff) {
    console.warn(
      `[Content Agent] The model's last step ended with finishReason "${finishReason}": the turn was cut off.`
    );

    return { note: cutOff, error: `cut off: ${finishReason}` };
  }

  const overBudget = budgetNote(turn.budget, finishReason);

  if (overBudget) {
    console.warn(
      `[Content Agent] The request used ${turn.budget.spent} tokens, the limit is ${turn.budget.limit} (turnTokenBudget): the agent was stopped.`
    );

    return { note: overBudget, error: "token budget reached" };
  }

  const stepLimit = awaitsPerson(steps) ? "" : stepLimitNote(steps?.length ?? 0, finishReason);

  if (!stepLimit) return { note: "" };
  console.warn(
    "[Content Agent] The request reached its step limit with work still to do: the agent was stopped."
  );

  return { note: stepLimit, error: "step limit reached" };
}

export function createOnFinish(
  turn: TurnScope,
  mainCallbacks: ReturnType<typeof createAgentCallbacks>
) {
  const { signal, activeMemory, conversationId } = turn;
  // An aborted turn never reaches onFinish, but its user message is already stored.
  // The flag makes the assistant row persist exactly once,
  // so stored history stays 1:1 with the client.
  const persistence = { assistantPersisted: false };

  const persistAbortPlaceholder = () => {
    if (persistence.assistantPersisted) return;
    persistence.assistantPersisted = true;

    if (activeMemory && conversationId) {
      void quiet(
        activeMemory.saveMessage(conversationId, "assistant", "[response stopped by user]")
      );
    }
  };

  if (signal?.aborted) persistAbortPlaceholder();
  else signal?.addEventListener("abort", persistAbortPlaceholder, { once: true });

  return async ({
    text: rawText,
    steps,
    finishReason,
  }: {
    text: string;
    steps?: FinishedSteps;
    finishReason?: string;
  }) => {
    const { note, error } = stoppedEarly(turn, steps, finishReason);
    const text = (
      (wroteNothingAfterTrying(turn.writeTracker)
        ? rawText + writeWarning(turn.writeTracker)
        : rawText) + note
    ).trimStart();
    const vizParts = collectVizParts(steps);

    mainCallbacks.runFinished({
      ok: !signal?.aborted && !note,
      finishReason,
      ...(signal?.aborted ? { error: "aborted" } : error ? { error } : {}),
    });
    signal?.removeEventListener("abort", persistAbortPlaceholder);
    if (persistence.assistantPersisted) return;
    persistence.assistantPersisted = true;
    // The reply is not complete while the chat waits for the person's click.
    // The request that follows the click stores it, so the history keeps one row per reply.
    if (awaitsPerson(steps)) return;
    if (!(activeMemory && conversationId)) return;
    await persistAssistantTurn({ turn, activeMemory, conversationId }, text, vizParts);
  };
}
