import { describe, it, expect, vi } from "vitest";
import { createRatingHandlers } from "../src/api/ratingEndpoint.js";
import { contentAgentPlugin } from "../src/plugin.js";

const makeMemory = (ownerUserId: string, existingRating: any = null) =>
  ({
    conversations: {
      findById: vi.fn(async (id: string) => (id === "conv-1" ? { id, userId: ownerUserId } : null)),
    },
    chatRatings: {
      submit: vi.fn(
        async (conversationId: string, userId: string, rating: number, comment?: string) => ({
          conversationId,
          userId,
          rating,
          comment: comment?.trim() || null,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        })
      ),
      get: vi.fn(async () => existingRating),
    },
  }) as any;

const makeReq = (userId: string | null, body?: any, query?: string) =>
  ({
    user: userId ? { id: userId } : null,
    data: body,
    json: async () => body,
    url: `http://localhost/api/content-agent/rating${query ? `?${query}` : ""}`,
    payload: { config: { admin: { user: "users" } } },
  }) as any;

describe("rating endpoint", () => {
  describe("POST submit", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const memory = makeMemory("owner-user");
      const handler = createRatingHandlers(async () => memory).submit;
      const res = await handler(makeReq(null, { conversationId: "conv-1", rating: 5 }));

      expect((res as Response).status).toBe(401);
    });

    it("rejects a rating outside 1-5", async () => {
      const memory = makeMemory("owner-user");
      const handler = createRatingHandlers(async () => memory).submit;
      const res = await handler(makeReq("owner-user", { conversationId: "conv-1", rating: 6 }));

      expect((res as Response).status).toBe(400);
      expect(memory.chatRatings.submit).not.toHaveBeenCalled();
    });

    it("rejects a non-integer rating", async () => {
      const memory = makeMemory("owner-user");
      const handler = createRatingHandlers(async () => memory).submit;
      const res = await handler(makeReq("owner-user", { conversationId: "conv-1", rating: 3.5 }));

      expect((res as Response).status).toBe(400);
    });

    it("rejects an oversized comment", async () => {
      const memory = makeMemory("owner-user");
      const handler = createRatingHandlers(async () => memory).submit;
      const res = await handler(
        makeReq("owner-user", { conversationId: "conv-1", rating: 4, comment: "x".repeat(2001) })
      );

      expect((res as Response).status).toBe(400);
    });

    it("rejects rating ANOTHER user's conversation (IDOR) as not-found, not 403", async () => {
      const memory = makeMemory("owner-user");
      const handler = createRatingHandlers(async () => memory).submit;
      const res = await handler(
        makeReq("attacker-user", { conversationId: "conv-1", rating: 1, comment: "terrible" })
      );

      expect((res as Response).status).toBe(404);
      expect(memory.chatRatings.submit).not.toHaveBeenCalled();
    });

    it("rejects an unknown conversationId without probing existence", async () => {
      const memory = makeMemory("owner-user");
      const handler = createRatingHandlers(async () => memory).submit;
      const res = await handler(
        makeReq("owner-user", { conversationId: "conv-unknown", rating: 5 })
      );

      expect((res as Response).status).toBe(404);
    });

    it("saves the owner's own rating + comment", async () => {
      const memory = makeMemory("owner-user");
      const handler = createRatingHandlers(async () => memory).submit;
      const res = await handler(
        makeReq("owner-user", {
          conversationId: "conv-1",
          rating: 4,
          comment: "  missed the point  ",
        })
      );

      expect((res as Response).status).toBe(200);
      const body = await (res as Response).json();

      expect(body.rating).toBe(4);
      expect(memory.chatRatings.submit).toHaveBeenCalledWith(
        "conv-1",
        "owner-user",
        4,
        "  missed the point  "
      );
    });
  });

  describe("GET (check existing)", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const memory = makeMemory("owner-user");
      const handler = createRatingHandlers(async () => memory).get;
      const res = await handler(makeReq(null, undefined, "conversationId=conv-1"));

      expect((res as Response).status).toBe(401);
    });

    it("returns null for another user's conversation (IDOR), not the real rating", async () => {
      const existing = { rating: 2, comment: "bad", createdAt: new Date("2026-01-01T00:00:00Z") };
      const memory = makeMemory("owner-user", existing);
      const handler = createRatingHandlers(async () => memory).get;
      const res = await handler(makeReq("attacker-user", undefined, "conversationId=conv-1"));
      const body = await (res as Response).json();

      expect(body.rating).toBeNull();
      expect(memory.chatRatings.get).not.toHaveBeenCalled();
    });

    it("returns the owner's existing rating", async () => {
      const existing = { rating: 5, comment: null, createdAt: new Date("2026-01-01T00:00:00Z") };
      const memory = makeMemory("owner-user", existing);
      const handler = createRatingHandlers(async () => memory).get;
      const res = await handler(makeReq("owner-user", undefined, "conversationId=conv-1"));
      const body = await (res as Response).json();

      expect(body.rating).toEqual({
        rating: 5,
        comment: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("returns null when the conversation has not been rated yet", async () => {
      const memory = makeMemory("owner-user", null);
      const handler = createRatingHandlers(async () => memory).get;
      const res = await handler(makeReq("owner-user", undefined, "conversationId=conv-1"));
      const body = await (res as Response).json();

      expect(body.rating).toBeNull();
    });
  });
});

const apply = (chatRating?: boolean) =>
  contentAgentPlugin({
    provider: "anthropic",
    mcpApiKey: "k",
    ...(chatRating === undefined ? {} : { chatRating }),
  })({} as any) as any;
const ratingPaths = (config: any) =>
  (config.endpoints ?? [])
    .filter((e: any) => e.path === "/content-agent/rating")
    .map((e: any) => e.method);

describe("chatRating option", () => {
  it("registers the endpoint and shows the widget only when the option is on", () => {
    const on = apply(true);

    expect(ratingPaths(on).sort()).toEqual(["get", "post"]);
    expect((on.admin?.custom as any)?.contentAgent?.chatRating).toBe(true);

    for (const off of [apply(undefined), apply(false)]) {
      expect(ratingPaths(off)).toEqual([]);
      expect((off.admin?.custom as any)?.contentAgent?.chatRating).toBe(false);
    }
  });
});
