import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { MemoryService } from "./index.js";
import type { TemporalMessage } from "./storage/temporal.js";
import { quiet } from "../promises.js";

const ltmActionItemSchema = z.object({
  type: z.enum(["create", "update", "archive", "none"]),
  slug: z.string().nullable(),
  parentSlug: z.string().nullable(),
  path: z.string().nullable(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  reason: z.string().nullable(),
});

export const ltmActionSchema = z.object({
  actions: z.array(ltmActionItemSchema),
});

type LtmAction = z.infer<typeof ltmActionItemSchema>;

interface CurationRun {
  userId: string;
  memory: MemoryService;
  changes: string[];
}

export const CURATOR_SYSTEM_PROMPT = `You are a Long-Term Memory curator for a Payload CMS Content Agent. After each conversation turn, you analyze the exchange and decide whether to capture, strengthen, or curate knowledge entries.

PRIORITIES (in order):
1. CAPTURE - Extract new insights from the conversation: user preferences, content patterns, important decisions, workflow habits
2. STRENGTHEN - Verify or update existing entries with new evidence
3. CURATE - Improve structure, merge related entries, archive stale ones

You manage a hierarchical knowledge tree with paths like:
- /identity - who the agent is, what CMS it serves
- /behavior - how to work, preferences, guidelines
- /content-map/* - map of content collections and their characteristics
- /user-preferences - user's working style and preferences
- /patterns - recurring patterns in content operations

Respond with JSON actions:
{
  "actions": [
    {"type": "create", "slug": "string", "parentSlug": "string|null", "path": "string", "title": "string", "body": "string"},
    {"type": "update", "slug": "string", "title": "string (optional)", "body": "string (optional)"},
    {"type": "archive", "slug": "string"},
    {"type": "none", "reason": "string"}
  ]
}

Be selective - only act when there is genuinely noteworthy information. Most turns won't need LTM updates.

Write each title and body in the language the conversation is in. Keep names, terms and quoted text exactly as they were written: do not translate them.`;

function isNoteworthy(messages: TemporalMessage[]): boolean {
  if (messages.length < 5) return false;

  return messages.some((message) => message.tokenEstimate > 200);
}

async function applyLtmAction(action: LtmAction, run: CurationRun): Promise<void> {
  const { userId, memory, changes } = run;

  if (action.type === "create" && action.slug && action.path && action.title && action.body) {
    await memory.ltm.create({
      slug: action.slug,
      userId,
      parentSlug: action.parentSlug ?? undefined,
      path: action.path,
      title: action.title,
      body: action.body,
      createdBy: "ltm-curator",
    });

    if (memory.embeddings) {
      void quiet(
        memory.embeddings.embedLtmEntry(userId, action.slug, `${action.title}\n${action.body}`)
      );
    }

    changes.push(`Created ${action.path}: ${action.title}`);
  } else if (action.type === "update" && action.slug) {
    const updated = await memory.ltm.update({
      slug: action.slug,
      userId,
      title: action.title ?? undefined,
      body: action.body ?? undefined,
      updatedBy: "ltm-curator",
    });

    if (updated) {
      if (
        memory.embeddings &&
        (typeof action.title === "string" || typeof action.body === "string")
      ) {
        void quiet(
          memory.embeddings.embedLtmEntry(userId, action.slug, `${updated.title}\n${updated.body}`)
        );
      }

      changes.push(`Updated ${action.slug}`);
    }
  } else if (action.type === "archive" && action.slug) {
    const archived = await memory.ltm.archive(userId, action.slug, "ltm-curator");

    if (archived) changes.push(`Archived ${action.slug}`);
  }
}

export async function runLtmCuration(
  conversationId: string,
  userId: string,
  memory: MemoryService,
  model: LanguageModel
): Promise<void> {
  const worker = await memory.backgroundReports.startWorkerIfNotRunning(
    "ltm-consolidate",
    conversationId
  );

  if (!worker) return;

  try {
    const messages = await memory.temporal.getMessages(conversationId);

    if (!isNoteworthy(messages)) {
      await memory.backgroundReports.completeWorker(worker.id);

      return;
    }

    const existingEntries = await memory.ltm.listAllWithShared(userId);
    const existingIndex = existingEntries
      .map((entry) => `- ${entry.path} (slug: ${entry.slug}): ${entry.title}`)
      .join("\n");

    const recentMessages = messages.slice(-20);
    const conversationText = recentMessages
      .map((message) => `[${message.type}] ${message.content}`)
      .join("\n\n---\n\n");

    const result = await generateText({
      model,
      instructions: CURATOR_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Existing LTM entries:\n${existingIndex || "(none)"}\n\nRecent conversation:\n${conversationText}\n\nAnalyze and respond with JSON actions.`,
        },
      ],
      maxOutputTokens: 2000,
      output: Output.object({ schema: ltmActionSchema }),
    });

    if (!result.output) {
      await memory.backgroundReports.failWorker(
        worker.id,
        "LTM curator returned no structured output"
      );

      return;
    }

    const parsed = result.output;

    const changes: string[] = [];

    const run: CurationRun = { userId, memory, changes };

    for (const action of parsed.actions) {
      await applyLtmAction(action, run);
    }

    if (changes.length > 0) {
      await memory.backgroundReports.addReport(conversationId, "ltm_curator", {
        summary: `LTM updates: ${changes.join("; ")}`,
      });
    }

    await memory.backgroundReports.completeWorker(worker.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";

    console.error("[Content Agent] LTM curation failed:", msg);
    await memory.backgroundReports.failWorker(worker.id, msg);
  }
}
