import { describe, it, expect, vi } from "vitest";
import { getPool, closePool } from "../src/memory/database.js";
import { createMessagesHandler } from "../src/api/messagesEndpoint.js";

describe("getPool: HMR-safe, DSN-keyed registry", () => {
  it("returns the same pool for the same DSN and different pools per DSN", async () => {
    const a1 = getPool("postgres://test-host-a/db");
    const a2 = getPool("postgres://test-host-a/db");
    const b = getPool("postgres://test-host-b/db");

    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
    await closePool();
  });

  it("attaches an error handler so an idle-client drop cannot crash the process", async () => {
    const pool = getPool("postgres://test-host-c/db");

    expect(pool.listenerCount("error")).toBeGreaterThanOrEqual(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    pool.emit("error", new Error("server closed the connection unexpectedly"));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await closePool();
  });

  it("closePool(dsn) removes only that pool; a later getPool creates a fresh one", async () => {
    const a = getPool("postgres://test-host-d/db");
    const b = getPool("postgres://test-host-e/db");

    await closePool("postgres://test-host-d/db");
    expect(getPool("postgres://test-host-d/db")).not.toBe(a);
    expect(getPool("postgres://test-host-e/db")).toBe(b);
    await closePool();
  });
});

const makeMemory = (ownerUserId: string) =>
  ({
    conversations: {
      findById: vi.fn(async (id: string) => (id === "conv-1" ? { id, userId: ownerUserId } : null)),
    },
    temporal: {
      getMessages: vi.fn(async () => [
        { id: "m1", type: "user", content: "secret question", createdAt: new Date() },
        { id: "m2", type: "assistant", content: "secret answer", createdAt: new Date() },
      ]),
    },
  }) as any;

const makeReq = (userId: string | null, conversationId?: string) =>
  ({
    user: userId ? { id: userId } : null,
    url: `http://localhost/api/content-agent/messages${conversationId ? `?conversationId=${conversationId}` : ""}`,
  }) as any;

describe("messages endpoint: conversation ownership (IDOR)", () => {
  it("returns another user's conversation as EMPTY, without touching messages", async () => {
    const memory = makeMemory("owner-user");
    const handler = createMessagesHandler(async () => memory);
    const res = await handler(makeReq("attacker-user", "conv-1"));
    const body = await (res as Response).json();

    expect(body.messages).toEqual([]);
    expect(memory.temporal.getMessages).not.toHaveBeenCalled();
  });

  it("returns an unknown conversation as empty (no existence probing)", async () => {
    const memory = makeMemory("owner-user");
    const handler = createMessagesHandler(async () => memory);
    const res = await handler(makeReq("attacker-user", "conv-unknown"));
    const body = await (res as Response).json();

    expect(body.messages).toEqual([]);
  });

  it("returns the owner's own messages normally", async () => {
    const memory = makeMemory("owner-user");
    const handler = createMessagesHandler(async () => memory);
    const res = await handler(makeReq("owner-user", "conv-1"));
    const body = await (res as Response).json();

    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toBe("secret question");
  });

  it("still rejects unauthenticated requests with 401", async () => {
    const handler = createMessagesHandler(async () => makeMemory("owner-user"));
    const res = await handler(makeReq(null, "conv-1"));

    expect((res as Response).status).toBe(401);
  });
});
