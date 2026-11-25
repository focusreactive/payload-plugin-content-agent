import type { PayloadHandler } from "payload";
import type { MemoryService } from "../memory/index.js";
import { principalOf } from "./principal.js";

export function createMessagesHandler(
  getMemory: () => Promise<MemoryService | null>
): PayloadHandler {
  return async (req) => {
    if (!req.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const memory = await getMemory();

    if (!memory) {
      return Response.json({ messages: [] });
    }

    try {
      const url = new URL(req.url || "", "http://localhost");
      const conversationId = url.searchParams.get("conversationId");

      if (!conversationId) {
        return Response.json({ error: "conversationId is required" }, { status: 400 });
      }

      // A foreign conversation returns an empty list, not 403,
      // so ids cannot be probed for existence.
      const conv = await memory.conversations.findById(conversationId);

      if (!conv || String(conv.userId) !== principalOf(req.user, req.payload)) {
        return Response.json({ messages: [] });
      }

      const messages = await memory.temporal.getMessages(conversationId);

      const chatMessages = messages
        .filter((message) => message.type === "user" || message.type === "assistant")
        .map((message) => ({
          id: message.id,
          role: message.type as "user" | "assistant",
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          ...(message.parts?.length ? { parts: message.parts } : {}),
        }));

      return Response.json({ messages: chatMessages });
    } catch (error) {
      console.error("[Content Agent] Messages endpoint error:", error);

      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
