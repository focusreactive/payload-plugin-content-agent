import { describe, it, expect } from "vitest";
import { InvalidToolInputError, tool } from "ai";
import { z } from "zod";
import { lowerNumbersToMaximum } from "../src/agent/repairToolCall.js";

const schema = z.object({
  collection: z.string(),
  limit: z.number().int().min(1).max(100).optional(),
});
const tools = { list: tool({ inputSchema: schema, execute: async () => ({}) }) };

function failure(input: unknown) {
  const parsed = schema.safeParse(input);

  return new InvalidToolInputError({
    toolName: "list",
    toolInput: JSON.stringify(input),
    cause: { name: "AI_TypeValidationError", cause: parsed.error },
  });
}

const repair = (input: unknown) =>
  lowerNumbersToMaximum({
    instructions: undefined,
    system: undefined,
    messages: [],
    tools,
    inputSchema: async () => ({}),
    toolCall: {
      type: "tool-call",
      toolCallId: "c1",
      toolName: "list",
      input: JSON.stringify(input),
    },
    error: failure(input),
  });

describe("a tool call with a number above the maximum", () => {
  it("runs with the maximum", async () => {
    const repaired = await repair({ collection: "pages", limit: 200 });

    expect(JSON.parse(repaired!.input)).toEqual({ collection: "pages", limit: 100 });
    expect(schema.safeParse(JSON.parse(repaired!.input)).success).toBe(true);
  });

  it("stays invalid when the input has another fault too", async () => {
    expect(await repair({ collection: 5, limit: 200 })).toBeNull();
    expect(await repair({ collection: "pages", limit: 0 })).toBeNull();
  });
});
