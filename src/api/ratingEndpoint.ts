import type { PayloadHandler } from "payload";
import type { MemoryService } from "../memory/index.js";
import { principalOf } from "./principal.js";
import { readJsonBody } from "./requestBody.js";

const MAX_COMMENT_LENGTH = 2000;

export function createRatingHandlers(getMemory: () => Promise<MemoryService | null>) {
  const submit: PayloadHandler = async (req) => {
    if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { conversationId, rating, comment } = await readJsonBody(req);

    if (
      typeof conversationId !== "string" ||
      !conversationId ||
      typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return Response.json(
        { error: "conversationId and an integer rating 1-5 are required" },
        { status: 400 }
      );
    }

    if (comment != null && (typeof comment !== "string" || comment.length > MAX_COMMENT_LENGTH)) {
      return Response.json(
        { error: `comment must be a string of at most ${MAX_COMMENT_LENGTH} chars` },
        { status: 400 }
      );
    }

    try {
      const memory = await getMemory();

      if (!memory) return Response.json({ error: "Not available" }, { status: 503 });

      const conv = await memory.conversations.findById(conversationId);

      if (!conv || String(conv.userId) !== principalOf(req.user, req.payload)) {
        return Response.json({ error: "Conversation not found" }, { status: 404 });
      }

      const saved = await memory.chatRatings.submit(
        conversationId,
        principalOf(req.user, req.payload),
        rating,
        comment ?? undefined
      );

      return Response.json({
        rating: saved.rating,
        comment: saved.comment,
        createdAt: saved.createdAt.toISOString(),
      });
    } catch (err) {
      console.error("[Content Agent] Rating endpoint error:", err);

      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };

  const get: PayloadHandler = async (req) => {
    if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(req.url || "", "http://localhost");
    const conversationId = url.searchParams.get("conversationId");

    if (!conversationId)
      return Response.json({ error: "conversationId is required" }, { status: 400 });

    try {
      const memory = await getMemory();

      if (!memory) return Response.json({ rating: null });

      const conv = await memory.conversations.findById(conversationId);

      if (!conv || String(conv.userId) !== principalOf(req.user, req.payload)) {
        return Response.json({ rating: null });
      }

      const existing = await memory.chatRatings.get(conversationId);

      return Response.json({
        rating: existing
          ? {
              rating: existing.rating,
              comment: existing.comment,
              createdAt: existing.createdAt.toISOString(),
            }
          : null,
      });
    } catch (err) {
      console.error("[Content Agent] Rating GET endpoint error:", err);

      return Response.json({ rating: null });
    }
  };

  return { submit, get };
}
