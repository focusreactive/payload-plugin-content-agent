import { describe, expect, it } from "vitest";

import { createAgentCallbacks } from "../src/agent/telemetry.js";

const recorder = (keepsContent: boolean) => {
  const events: any[] = [];

  return {
    events,
    storage: {
      keepsContent,
      record: async (event: any) => {
        events.push(event);
      },
    } as any,
  };
};

const step: any = {
  stepNumber: 0,
  finishReason: "tool-calls",
  usage: { inputTokens: 10, outputTokens: 2 },
  toolCalls: [{ toolName: "setValues" }, { toolName: "readDocument" }],
  toolResults: [
    { toolName: "setValues", toolCallId: "c1", input: { value: "secret" }, output: { ok: true } },
  ],
  content: [
    {
      type: "tool-error",
      toolName: "readDocument",
      toolCallId: "c2",
      input: { id: "secret" },
      error: new Error("not found"),
    },
  ],
};

const toolRows = (keepsContent: boolean) => {
  const { events, storage } = recorder(keepsContent);

  createAgentCallbacks("main", "conv1", storage).onStepFinish(step);

  return events.filter((event) => event.eventType === "tool_call");
};

describe("telemetry content", () => {
  it("keeps no input and no result of a tool call by default", () => {
    const rows = toolRows(false);

    expect(rows.map((row) => row.toolName)).toEqual(["setValues", "readDocument"]);
    expect(rows.map((row) => row.success)).toEqual([true, false]);
    expect(rows[1].error).toBe("not found");
    expect(JSON.stringify(rows)).not.toContain("secret");

    for (const row of rows) {
      expect(row.metadata).not.toHaveProperty("input");
      expect(row.metadata).not.toHaveProperty("outputPreview");
      expect(row.metadata.toolCallId).toBeTruthy();
    }
  });

  it("keeps the input and the start of the result when the host asks for full rows", () => {
    const [result, thrown] = toolRows(true);

    expect(result.metadata.input).toContain("secret");
    expect(result.metadata.outputPreview).toBe('{"ok":true}');
    expect(thrown.metadata.input).toContain("secret");
  });
});
