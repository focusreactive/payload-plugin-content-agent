import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { MemoryService } from "./index.js";
import { entryOrigin } from "./contextAssembler.js";
import { SHARED_USER_ID } from "./storage/ltm.js";

interface FoundEntry {
  path: string;
  title: string;
  userId: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: Date | string | null;
}

function entryLine(entry: FoundEntry): string {
  const scope = entry.userId === SHARED_USER_ID ? "shared" : `user:${entry.userId}`;
  const origin = entryOrigin(entry);

  return `[${entry.path}] ${entry.title} (scope: ${scope}${origin ? `, ${origin}` : ""}`;
}

export const REFLECT_SYNTHESIS_INSTRUCTIONS =
  "You are a memory synthesis agent. Based on search results, provide a concise, factual answer to the question. Only state what the evidence supports. When mentioning actions by specific users, attribute them clearly. A memory entry is a dated claim: say who wrote it and when it was last updated, and when two entries disagree, take the later one and say so.";

async function messageResults(
  memory: MemoryService,
  userId: string,
  question: string
): Promise<string[]> {
  const results: string[] = [];
  const msgs = await memory.temporal.searchAllMessages(userId, question, 10);

  if (msgs.length > 0) {
    const formatted = msgs
      .map(
        (message) =>
          `[${message.type} by user:${message.userId} @ ${message.createdAt.toISOString()}] ${message.content.slice(0, 300)}`
      )
      .join("\n");

    results.push(`Message search "${question}":\n${formatted}`);
  }

  if (memory.embeddings) {
    const summaries = await memory.embeddings.searchSummaries(userId, question, 5);

    if (summaries.length > 0) {
      const formatted = summaries
        .map((summary) => `[summary score:${summary.score.toFixed(3)}] ${summary.narrative}`)
        .join("\n");

      results.push(`Summary search "${question}" (semantic):\n${formatted}`);
    }
  }

  return results;
}

async function ltmResults(
  memory: MemoryService,
  userId: string,
  question: string
): Promise<string[]> {
  if (memory.embeddings) {
    const entries = await memory.embeddings.hybridSearchLtm(userId, question, 5);
    const formatted = entries
      .map(
        (entry) =>
          `${entryLine(entry)}, score:${entry.score.toFixed(3)}): ${entry.body.slice(0, 300)}`
      )
      .join("\n");

    return entries.length ? [`LTM search "${question}" (hybrid):\n${formatted}`] : [];
  }

  const entries = await memory.ltm.searchWithShared(userId, question, 5);
  const formatted = entries
    .map((entry) => `${entryLine(entry)}): ${entry.body.slice(0, 300)}`)
    .join("\n");

  return entries.length ? [`LTM search "${question}":\n${formatted}`] : [];
}

export async function runReflection(
  question: string,
  userId: string,
  memory: MemoryService,
  model: LanguageModel
): Promise<string> {
  try {
    const searchResults = [
      ...(await messageResults(memory, userId, question)),
      ...(await ltmResults(memory, userId, question)),
    ];

    if (searchResults.length === 0) {
      return `No relevant memories found for: "${question}"`;
    }

    const synthesisResult = await generateText({
      model,
      instructions: REFLECT_SYNTHESIS_INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content: `Question: ${question}\n\nSearch results:\n${searchResults.join("\n\n---\n\n")}\n\nSynthesize a concise answer.`,
        },
      ],
      maxOutputTokens: 1000,
    });

    return synthesisResult.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";

    console.error("[Content Agent] Reflection failed:", msg);

    return `Memory search failed: ${msg}`;
  }
}
