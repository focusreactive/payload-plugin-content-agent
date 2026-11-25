import { createHash } from "node:crypto";
import type { PayloadRequest } from "payload";
import { isRecord } from "../borders.js";
import type { EditRecordRef, SchemaContext } from "../types.js";
import type { MemoryService } from "../memory/index.js";
import { principalOf } from "../api/principal.js";
import { createEditRecorder } from "../agent/tools/index.js";
import { sharedRuntimeOf } from "../plugin/shared.js";
import type { McpAccessSettings } from "./host.js";
import { caught } from "../promises.js";

interface KeyIdentity {
  id: string;
  title: string;
}

function keyOf(settings: McpAccessSettings): KeyIdentity {
  const id = typeof settings.id === "string" || typeof settings.id === "number" ? settings.id : "";
  const label = typeof settings.label === "string" ? settings.label.trim() : "";

  return { id: String(id), title: label ? `MCP: ${label}` : "MCP" };
}

/** The same id for every write of one key and one user on one day (UTC). */
export function conversationIdOf(keyId: string, userId: string, day: string): string {
  const hex = createHash("sha256").update(`mcp\n${keyId}\n${userId}\n${day}`).digest("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function openConversation(
  memory: MemoryService,
  key: KeyIdentity,
  userId: string
): Promise<string> {
  const id = conversationIdOf(key.id, userId, new Date().toISOString().slice(0, 10));
  const conversation = await memory.conversations.findOrCreate(id, userId);

  if (conversation.title === key.title) await memory.conversations.touch(id);
  else await memory.conversations.updateTitle(id, key.title);

  return id;
}

export interface LayerHistory {
  recordEdits: (refs: EditRecordRef[]) => void;
  /** Resolves when every change of the call is stored. */
  settled: () => Promise<void>;
}

/**
 * Keeps the writes of an MCP call in the history of the content agent: one conversation per key
 * and day, owned by the user of the key. Without the plugin or its memory database the writes
 * keep no history.
 */
export function createLayerHistory(
  req: PayloadRequest,
  settings: McpAccessSettings,
  schema: SchemaContext
): LayerHistory {
  const pending: Promise<unknown>[] = [];

  const record = async (refs: EditRecordRef[]): Promise<void> => {
    const shared = sharedRuntimeOf(req.payload.config);

    if (!shared) return;
    const memory = await shared.getMemory();
    const userId = principalOf(isRecord(req.user) ? req.user : null, req.payload);
    const conversationId = memory
      ? await openConversation(memory, keyOf(settings), userId)
      : undefined;
    const stored: Promise<unknown>[] = [];

    createEditRecorder({
      memory,
      conversationId,
      userId,
      schema,
      modules: shared.getModules(),
      waitUntil: (saved) => stored.push(saved),
    })(refs);
    await Promise.all(stored);
  };

  return {
    recordEdits: (refs) => {
      pending.push(
        caught(record(refs), (err) => {
          console.warn(
            "[Content Agent] An MCP write was saved, but its change could not be kept in the history:",
            err instanceof Error ? err.message : err
          );
        })
      );
    },
    settled: async () => {
      await Promise.all(pending);
    },
  };
}
