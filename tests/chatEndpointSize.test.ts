import { describe, it, expect, vi } from "vitest";
import { createChatHandler } from "../src/api/chatEndpoint.js";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from "../src/agent/attachments.js";
import type { SchemaContext, ResolvedPluginOptions } from "../src/types.js";

vi.mock("../src/agent/index.js", () => ({
  runAgent: vi.fn(async () => new Response("ok", { status: 200 })),
}));

const schema: SchemaContext = { globals: [], collections: [] };
const options = { schemaPromptMode: "auto" } as ResolvedPluginOptions;

function imageDataUrl(bytes: number): string {
  return `data:image/png;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;
}

const userMessage = (parts: any[]) => ({ id: "m1", role: "user", parts });

// A distinct user id per request keeps the per-user rate limiter out of the way.
let seq = 0;

function request(messages: any[]) {
  seq++;

  return {
    user: { id: `u${seq}`, collection: "users" },
    json: async () => ({ messages }),
  } as any;
}

async function errorOf(res: Response): Promise<string> {
  return (await res.json()).error as string;
}

describe("chat endpoint size guards", () => {
  it("accepts a screenshot: an image does not count as conversation length", async () => {
    const res = await createChatHandler(
      schema,
      options
    )(
      request([
        userMessage([
          { type: "text", text: "what is on this screenshot?" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "s.png",
            url: imageDataUrl(1024 * 1024),
          },
        ]),
      ])
    );

    expect(res.status).toBe(200);
  });

  it("still rejects a genuinely long conversation, and says so", async () => {
    const messages = [userMessage([{ type: "text", text: "x".repeat(400_000) }])];
    const res = await createChatHandler(schema, options)(request(messages));

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatch(/conversation has gotten too long/u);
  });

  it("blames the attachment, not the conversation, when the payload is oversized", async () => {
    const tooBig = MAX_ATTACHMENT_BYTES * MAX_ATTACHMENTS_PER_MESSAGE + 5 * 1024 * 1024;
    const res = await createChatHandler(
      schema,
      options
    )(
      request([
        userMessage([
          { type: "file", mediaType: "image/png", filename: "huge.png", url: imageDataUrl(tooBig) },
        ]),
      ])
    );

    expect(res.status).toBe(413);
    const err = await errorOf(res);

    expect(err).toMatch(/too large/u);
    expect(err).not.toMatch(/conversation/u);
  });

  it("does not let attachment bytes mask an over-long conversation", async () => {
    const res = await createChatHandler(
      schema,
      options
    )(
      request([
        userMessage([
          { type: "text", text: "y".repeat(400_000) },
          {
            type: "file",
            mediaType: "image/png",
            filename: "s.png",
            url: imageDataUrl(512 * 1024),
          },
        ]),
      ])
    );

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatch(/conversation has gotten too long/u);
  });

  it("counts a hosted attachment URL as conversation, not as attachment bytes", async () => {
    const res = await createChatHandler(
      schema,
      options
    )(
      request([
        userMessage([
          { type: "text", text: "z".repeat(400_000) },
          { type: "file", mediaType: "image/png", url: "https://example.com/a.png" },
        ]),
      ])
    );

    expect(res.status).toBe(400);
  });

  it("still rejects too many messages", async () => {
    const messages = Array.from({ length: 201 }, () => userMessage([{ type: "text", text: "hi" }]));
    const res = await createChatHandler(schema, options)(request(messages));

    expect(res.status).toBe(400);
  });
});
