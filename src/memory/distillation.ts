import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { MemoryService } from "./index.js";
import type { ContextBudget } from "./contextAssembler.js";
import type { TemporalMessage, TemporalSummary } from "./storage/temporal.js";
import { caught } from "../promises.js";

export const distillationSchema = z.object({
  narrative: z.string(),
  keyObservations: z.array(z.string()),
  tags: z.array(z.string()).nullable(),
});

export const DISTILLATION_SYSTEM_PROMPT = `You are a conversation compaction agent. Your job is to distill conversation history into concise summaries that preserve critical information.

PRESERVE:
- File paths, collection names, document IDs
- Decisions made and their reasoning
- User preferences and corrections
- Specific values, configurations, field names
- Errors encountered and their solutions
- Task progress and outcomes

REMOVE:
- Dead-end debugging attempts
- Verbose explanations that can be summarized
- Redundant tool call details (keep outcomes, not raw data)
- Pleasantries and filler

Create a distillation that captures the essential narrative and key facts. Be concise but don't lose important details.

Write in the language the conversation is in. Keep names, terms and quoted text exactly as they were written: do not translate them.`;

function uncoveredMessages(
  messages: TemporalMessage[],
  summaries: TemporalSummary[]
): TemporalMessage[] {
  const coveredIds = new Set<string>();

  for (const entry of summaries) {
    for (const message of messages) {
      if (message.id >= entry.startId && message.id <= entry.endId) coveredIds.add(message.id);
    }
  }

  return messages.filter((message) => !coveredIds.has(message.id));
}

export async function runDistillation(
  conversationId: string,
  memory: MemoryService,
  model: LanguageModel,
  budget: ContextBudget
): Promise<void> {
  const worker = await memory.backgroundReports.startWorkerIfNotRunning(
    "temporal-compact",
    conversationId
  );

  if (!worker) return;

  try {
    const messages = await memory.temporal.getMessages(conversationId);
    // Same coverage rule as buildTemporalView: orderNum 0 is search-only and does not count,
    // or the first messages would drop out of the prompt.
    const summaries = (await memory.temporal.getSummaries(conversationId)).filter(
      (entry) => entry.orderNum > 0
    );

    const uncovered = uncoveredMessages(messages, summaries);

    if (uncovered.length <= budget.recencyBufferMessages) {
      await memory.backgroundReports.completeWorker(worker.id);

      return;
    }

    const toDistill = uncovered.slice(0, uncovered.length - budget.recencyBufferMessages);

    if (toDistill.length < 4) {
      await memory.backgroundReports.completeWorker(worker.id);

      return;
    }

    const startId = toDistill[0].id;
    const endId = toDistill[toDistill.length - 1].id;

    const conversationText = toDistill
      .map((message) => `[${message.type}] ${message.content}`)
      .join("\n\n---\n\n");

    const maxOrderNum = await memory.temporal.getMaxOrderNum(conversationId);

    const result = await generateText({
      model,
      instructions: DISTILLATION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Distill the following conversation segment (${toDistill.length} messages, ~${toDistill.reduce((total, message) => total + message.tokenEstimate, 0)} tokens) into a concise summary.\n\n${conversationText}\n\nRespond with JSON:\n{"narrative": "concise summary paragraph", "keyObservations": ["fact 1", "fact 2", ...], "tags": ["tag1", "tag2"]}`,
        },
      ],
      maxOutputTokens: 2000,
      output: Output.object({ schema: distillationSchema }),
    });

    if (!result.output) {
      await memory.backgroundReports.failWorker(
        worker.id,
        "Distillation returned no structured output"
      );

      return;
    }

    const parsed = result.output;

    const summary = await memory.temporal.addSummary({
      conversationId,
      orderNum: maxOrderNum + 1,
      startId,
      endId,
      narrative: parsed.narrative,
      keyObservations: parsed.keyObservations,
      tags: parsed.tags ?? undefined,
    });

    if (memory.embeddings) {
      void caught(memory.embeddings.embedSummary(summary.id, parsed.narrative), (err) => {
        console.error(
          "[Content Agent] Summary embedding failed:",
          err instanceof Error ? err.message : err
        );
      });
    }

    await memory.backgroundReports.addReport(conversationId, "distillation", {
      summary: `Distilled ${toDistill.length} messages into summary (level ${maxOrderNum + 1}). Range: ${startId}..${endId}`,
    });

    await memory.backgroundReports.completeWorker(worker.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";

    console.error("[Content Agent] Distillation failed:", msg);
    await memory.backgroundReports.failWorker(worker.id, msg);
  }
}

const MIN_MESSAGES_FOR_SUMMARY = 3;
// Three turns: the summary is made again when the conversation went on by that much.
const SUMMARY_REFRESH_MESSAGES = 6;

const newerThan = (messages: { id: string }[], endId: string): number => {
  const end = messages.findIndex((message) => message.id === endId);

  return end === -1 ? messages.length : messages.length - end - 1;
};

export async function runConversationSummary(
  conversationId: string,
  memory: MemoryService,
  model: LanguageModel
): Promise<void> {
  if (!memory.embeddings) return;

  const worker = await memory.backgroundReports.startWorkerIfNotRunning(
    "conversation-summary",
    conversationId
  );

  if (!worker) return;

  try {
    const summaries = await memory.temporal.getSummaries(conversationId);
    // A distilled conversation is found by the summaries of its distillation.
    const distilled = summaries.some((summary) => summary.orderNum > 0);
    const own = summaries.find((summary) => summary.orderNum === 0);
    const messages = await memory.temporal.getMessages(conversationId);
    const meaningful = messages.filter(
      (message) => message.type === "user" || message.type === "assistant"
    );

    if (
      distilled ||
      meaningful.length < MIN_MESSAGES_FOR_SUMMARY ||
      (own && newerThan(meaningful, own.endId) < SUMMARY_REFRESH_MESSAGES)
    ) {
      await memory.backgroundReports.completeWorker(worker.id);

      return;
    }

    const conversationText = meaningful
      .map((message) => `[${message.type}] ${message.content}`)
      .join("\n\n---\n\n");

    const result = await generateText({
      model,
      instructions: DISTILLATION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Distill the following short conversation (${meaningful.length} messages) into a concise summary.\n\n${conversationText}\n\nRespond with JSON:\n{"narrative": "concise summary paragraph", "keyObservations": ["fact 1", "fact 2", ...], "tags": ["tag1", "tag2"]}`,
        },
      ],
      maxOutputTokens: 1000,
      output: Output.object({ schema: distillationSchema }),
    });

    if (!result.output) {
      console.error("[Content Agent] Conversation summary failed: no structured output");

      return;
    }

    const parsed = result.output;

    const startId = meaningful[0].id;
    const endId = meaningful[meaningful.length - 1].id;

    const text = {
      startId,
      endId,
      narrative: parsed.narrative,
      keyObservations: parsed.keyObservations,
      tags: parsed.tags ?? undefined,
    };
    const summary = own
      ? await memory.temporal.replaceSummary(own.id, text)
      : // orderNum 0 marks a search-only summary; buildTemporalView excludes it from coverage.
        await memory.temporal.addSummary({ conversationId, orderNum: 0, ...text });

    await memory.embeddings.embedSummary(summary.id, parsed.narrative);
    await memory.backgroundReports.completeWorker(worker.id);
  } catch (err) {
    console.error(
      "[Content Agent] Conversation summary failed:",
      err instanceof Error ? err.message : err
    );
    await memory.backgroundReports
      .failWorker(worker.id, err instanceof Error ? err.message : "Unknown error")
      .catch(() => undefined);
  }
}
