import type { UIMessage } from "ai";
import type { PayloadHandler } from "payload";
import { isRecord } from "../borders.js";
import type { SchemaContext, ResolvedPluginOptions } from "../types.js";
import type { MemoryService } from "../memory/index.js";
import { runAgent } from "../agent/index.js";
import { McpUnreachableError } from "../agent/mcpUrl.js";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from "../agent/attachments.js";
import { principalOf } from "./principal.js";
import { readJsonBody } from "./requestBody.js";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const MAX_MESSAGES_COUNT = 200;
const MAX_MESSAGES_BYTES = 300_000;
const BASE64_INFLATION = 1.4;
const MAX_REQUEST_BYTES =
  MAX_MESSAGES_BYTES +
  Math.ceil(MAX_ATTACHMENT_BYTES * MAX_ATTACHMENTS_PER_MESSAGE * BASE64_INFLATION);

function inlineAttachmentChars(messages: unknown[]): number {
  let total = 0;

  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.parts)) continue;
    const parts: unknown[] = message.parts;

    for (const part of parts) {
      if (
        isRecord(part) &&
        part.type === "file" &&
        typeof part.url === "string" &&
        part.url.startsWith("data:")
      ) {
        total += part.url.length;
      }
    }
  }

  return total;
}

const isMessagePart = (value: unknown) => isRecord(value) && typeof value.type === "string";

// The role and the list of typed parts: what the agent reads. A part keeps the shape it came in.
const isChatMessage = (value: unknown): value is UIMessage =>
  isRecord(value) &&
  (value.role === "user" || value.role === "assistant") &&
  Array.isArray(value.parts) &&
  value.parts.every(isMessagePart);

const textOf = (value: unknown) => (typeof value === "string" && value ? value : undefined);

const MAX_TIME_ZONE_LENGTH = 64;

function timeZoneOf(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.length > MAX_TIME_ZONE_LENGTH) return undefined;

  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

const SESSION_HEADERS = ["cookie", "authorization"];

// What logs the person in: the agent opens a file of the site with it, as the person.
function sessionHeadersOf(headers?: Headers): Record<string, string> {
  return Object.fromEntries(
    SESSION_HEADERS.map((name) => [name, headers?.get(name)]).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""
    )
  );
}

const requestFactsOf = (req: { headers?: Headers }) => ({
  sessionHeaders: sessionHeadersOf(req.headers),
});

function pageContextOf(value: unknown) {
  if (!isRecord(value)) return undefined;

  return {
    collection: textOf(value.collection),
    documentId: textOf(value.documentId),
    global: textOf(value.global),
  };
}

const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(userId);

  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(userId, { count: 1, windowStart: now });

    return false;
  }

  bucket.count += 1;

  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

export function createChatHandler(
  schema: SchemaContext,
  options: ResolvedPluginOptions,
  memory?: MemoryService | null
): PayloadHandler {
  return async (req) => {
    if (!req.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = principalOf(req.user, req.payload);

    if (isRateLimited(userId)) {
      return Response.json({ error: "Too many requests, please slow down" }, { status: 429 });
    }

    try {
      const body = await readJsonBody(req);
      const { messages } = body;

      if (!messages || !Array.isArray(messages)) {
        return Response.json(
          { error: "Invalid request: messages array required" },
          { status: 400 }
        );
      }

      // A client-sent system message would reach the model after the plugin's instructions
      // and could override them.
      if (!messages.every(isChatMessage)) {
        return Response.json(
          {
            error:
              "Invalid request: each message needs the role user or assistant and a list of parts",
          },
          { status: 400 }
        );
      }

      if (body.conversationId != null && typeof body.conversationId !== "string") {
        return Response.json(
          { error: "Invalid request: conversationId must be a string" },
          { status: 400 }
        );
      }

      const totalChars = JSON.stringify(messages).length;
      const attachmentChars = inlineAttachmentChars(messages);

      if (totalChars > MAX_REQUEST_BYTES) {
        return Response.json(
          {
            error: `Those attachments are too large to send (limit: ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB per file, up to ${MAX_ATTACHMENTS_PER_MESSAGE} files). Attach fewer or smaller files.`,
          },
          { status: 413 }
        );
      }

      if (
        messages.length > MAX_MESSAGES_COUNT ||
        totalChars - attachmentChars > MAX_MESSAGES_BYTES
      ) {
        return Response.json(
          { error: "This conversation has gotten too long to continue - please start a new chat." },
          { status: 400 }
        );
      }

      const pageContext = pageContextOf(body.pageContext);
      const conversationId = body.conversationId || undefined;

      const result = await runAgent({
        messages,
        payload: req.payload,
        user: req.user,
        schema,
        options,
        pageContext,
        memory,
        conversationId,
        timeZone: timeZoneOf(body.timeZone),
        signal: req.signal ?? undefined,
        ...requestFactsOf(req),
      });

      return result;
    } catch (error) {
      console.error("[Content Agent] Chat endpoint error:", error);

      if (error instanceof McpUnreachableError)
        return Response.json({ error: error.message }, { status: 503 });

      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
