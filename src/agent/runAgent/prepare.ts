import { isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import type { MemoryService } from "../../memory/index.js";
import { describeAttachments, normalizeAttachments } from "../attachments.js";
import type { AttachmentOutcome, NormalizedAttachments } from "../attachments.js";
import { changedDocumentsNote, titleFieldsOf } from "../changedDocuments.js";
import type { SchemaContext } from "../../types.js";
import type { TurnMemory } from "./scope.js";

export async function normalizeTurnAttachments(
  messages: UIMessage[]
): Promise<NormalizedAttachments> {
  const normalized = await normalizeAttachments(messages);
  const attachmentOutcomes = normalized.outcomes;

  if (attachmentOutcomes.length) {
    console.log(
      `[Content Agent] Attachments: ${attachmentOutcomes
        .map(
          (outcome) =>
            `${outcome.filename} → ${outcome.handling}${outcome.reason ? ` (${outcome.reason})` : ""}`
        )
        .join(", ")}`
    );
  }

  return normalized;
}

interface OwnerCheck {
  memoryOk: boolean;
  refusal: Response | null;
}

// The conversation id is client-supplied: verify ownership before any memory read or write.
// Fails closed: a foreign owner is a 404, and an error in the check skips memory for the turn.
export async function checkConversationOwner({
  memory,
  conversationId,
  userId,
}: {
  memory: MemoryService | null | undefined;
  conversationId: string | undefined;
  userId: string;
}): Promise<OwnerCheck> {
  if (memory && conversationId) {
    try {
      const conv = await memory.conversations.findOrCreate(conversationId, userId);

      if (String(conv.userId) !== String(userId)) {
        return {
          memoryOk: false,
          refusal: Response.json({ error: "Conversation not found" }, { status: 404 }),
        };
      }

      return { memoryOk: true, refusal: null };
    } catch (err) {
      console.error(
        "[Content Agent] Conversation ownership check failed - running WITHOUT memory this turn:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return { memoryOk: false, refusal: null };
}

// The reply may have saved changes before the question: only the change in the card did not run.
const UNANSWERED_CONFIRMATION =
  "[asked the person to confirm a change; they wrote a new message instead, so the change in the card was not made]";

const unansweredReply = (message: UIMessage): string =>
  [
    ...message.parts.flatMap((part) =>
      part.type === "text" && part.text.trim() ? [part.text] : []
    ),
    UNANSWERED_CONFIRMATION,
  ].join("\n\n");

/** The reply before this message stopped at a confirmation and was never stored. */
const leftUnanswered = (message: UIMessage | undefined): boolean =>
  message?.role === "assistant" &&
  message.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested");

export interface TurnMemoryInput {
  memory: MemoryService;
  conversationId: string;
  userId: string;
  messages: UIMessage[];
  attachmentOutcomes: AttachmentOutcome[];
  schema: SchemaContext;
}

export async function loadTurnMemory(
  { memory, conversationId, userId, messages, attachmentOutcomes, schema }: TurnMemoryInput,
  turnMemory: TurnMemory
): Promise<void> {
  try {
    // A request that carries the person's answer to a confirmation ends with the agent's
    // own message: the person's message before it is already stored.
    const lastUserMsg = messages.at(-1)?.role === "user" ? messages.at(-1) : undefined;

    if (lastUserMsg) {
      const previous = messages.at(-2);

      if (previous && leftUnanswered(previous)) {
        await memory.saveMessage(conversationId, "assistant", unansweredReply(previous));
      }

      const content =
        lastUserMsg.parts
          ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("\n") ?? "";
      const marker = describeAttachments(attachmentOutcomes);
      const saved = [content, marker].filter(Boolean).join("\n");

      if (saved) {
        await memory.saveMessage(conversationId, "user", saved);
      }
    }

    turnMemory.assembledContext = await memory.assembleContext(conversationId, userId);
    const changed = await memory.changesets.listChanged(conversationId, titleFieldsOf(schema));

    turnMemory.promptAdditions =
      memory.getSystemPromptAdditions(turnMemory.assembledContext) + changedDocumentsNote(changed);

    await memory.conversations.touch(conversationId);
  } catch (err) {
    console.error(
      "[Content Agent] Memory error (continuing without memory):",
      err instanceof Error ? err.message : err
    );
  }
}
