import { describe, it, expect, vi, afterEach } from "vitest";
import { APICallError, InvalidToolInputError, NoSuchToolError, RetryError } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import * as mcpClient from "../src/agent/mcpClient.js";
import { describeTurnError } from "../src/agent/turnErrors.js";
import type { SchemaContext } from "../src/types.js";
import { turnBody } from "./harness.js";

afterEach(() => vi.restoreAllMocks());

const quiet = () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  return vi.spyOn(console, "error").mockImplementation(() => {});
};

describe("describeTurnError", () => {
  it("names the step whose input the model got wrong", () => {
    quiet();
    const error = new InvalidToolInputError({
      toolName: "web",
      toolInput: "{}",
      cause: new Error("action: Required"),
    });

    expect(describeTurnError(error)).toBe(
      "The model sent input that the web step does not accept."
    );
  });

  it("names a step that does not exist", () => {
    quiet();
    expect(describeTurnError(new NoSuchToolError({ toolName: "webSearch" }))).toBe(
      "The model called a step that does not exist: webSearch."
    );
  });

  it("says what the provider rejected, also after retries", () => {
    quiet();
    const rejected = new APICallError({
      message: "Item 'msg_1' was provided without its required 'reasoning' item.",
      url: "https://api.openai.com/v1/responses",
      requestBodyValues: {},
      statusCode: 400,
    });

    expect(describeTurnError(rejected)).toBe(
      "The AI provider rejected the request (400): Item 'msg_1' was provided without its required 'reasoning' item."
    );
    const retried = new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [rejected],
    });

    expect(describeTurnError(retried)).toContain("(400)");
  });

  it("shows the message of any other error on one short line, and logs the error", () => {
    const log = quiet();
    const error = new Error("fetch failed:\n  connect ECONNREFUSED " + "x".repeat(400));
    const text = describeTurnError(error);

    expect(text.startsWith("fetch failed: connect ECONNREFUSED")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(300);
    expect(log).toHaveBeenCalledWith("[Content Agent] Turn error:", error);
    expect(describeTurnError("?")).toBe("Something went wrong. The server log has the details.");
  });
});

describe("a turn that fails", () => {
  const schema: SchemaContext = { globals: [], collections: [] };

  it('tells the chat why, not "An error occurred."', async () => {
    const log = quiet();

    vi.spyOn(mcpClient, "getMcpTools").mockResolvedValue({});
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "error", error: new Error("the provider went away") },
          ] as any[],
        }),
      }),
    });
    const body = await turnBody({
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Hi" }] }],
      schema,
      options: { model },
    });

    expect(body).toContain("the provider went away");
    expect(body).not.toContain("An error occurred.");
    expect(log).toHaveBeenCalledWith("[Content Agent] Turn error:", expect.any(Error));
  });
});
