import type { PayloadHandler } from "payload";
import type { MemoryService } from "../memory/index.js";
import { principalOf } from "./principal.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The `nextCursor` of the page before: the time and the id of its last conversation. */
export function historyCursor(raw: string | null): string | undefined {
  const [timestamp, id, ...rest] = (raw ?? "").split("|");

  return Number.isFinite(Date.parse(timestamp)) && id !== undefined && UUID.test(id) && !rest.length
    ? raw!
    : undefined;
}

export function createConversationsHandler(
  getMemory: () => Promise<MemoryService | null>
): PayloadHandler {
  return async (req) => {
    if (!req.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const memory = await getMemory();

    if (!memory) {
      return Response.json({ conversations: [], memoryEnabled: false });
    }

    try {
      const userId = principalOf(req.user, req.payload);
      const url = new URL(req.url || "", "http://localhost");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), 50);
      const { conversations, nextCursor } = await memory.conversations.listForUser(
        userId,
        limit,
        historyCursor(url.searchParams.get("cursor"))
      );

      return Response.json({
        conversations: conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString(),
        })),
        nextCursor,
        memoryEnabled: true,
      });
    } catch (error) {
      console.error("[Content Agent] Conversations endpoint error:", error);

      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
