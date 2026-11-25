import { describe, it, expect, vi } from "vitest";
import { collectVizParts } from "../src/agent/vizParts.js";
import { createMessagesHandler } from "../src/api/messagesEndpoint.js";
import { visualResult } from "../src/sdk/visual.js";

describe("collectVizParts", () => {
  const table = visualResult("table", { title: "History", columns: [], rows: [] });
  const steps = [
    {
      toolResults: [
        {
          toolName: "readDocument",
          toolCallId: "c1",
          input: { id: "1" },
          output: { documents: [] },
        },
      ],
    },
    {
      toolResults: [
        {
          toolName: "present_table",
          toolCallId: "c2",
          input: { title: "History", columns: [], rows: [] },
          output: table,
        },
      ],
    },
    {
      toolResults: [
        {
          toolName: "someModule__trend",
          toolCallId: "c3",
          input: {},
          output: visualResult("chart", { title: "T", series: [] }),
        },
      ],
    },
    { toolResults: [] },
  ];

  it("returns only the visual results, whatever the tool name, as finished tool parts in call order", () => {
    const parts = collectVizParts(steps);

    expect(parts.map((p) => p.toolCallId)).toEqual(["c2", "c3"]);
    expect(parts[0]).toEqual({
      type: "tool-present_table",
      toolCallId: "c2",
      state: "output-available",
      input: { title: "History", columns: [], rows: [] },
      output: table,
    });
  });

  it("does not keep a result by its tool name alone", () => {
    expect(
      collectVizParts([
        {
          toolResults: [
            { toolName: "present_table", toolCallId: "x", input: {}, output: { ok: true } },
          ],
        },
      ])
    ).toEqual([]);
  });

  it("is empty for a turn that rendered nothing, and tolerates missing steps", () => {
    expect(
      collectVizParts([
        { toolResults: [{ toolName: "readDocument", toolCallId: "x", input: {}, output: {} }] },
      ])
    ).toEqual([]);
    expect(collectVizParts(undefined)).toEqual([]);
  });

  it("stops at the size cap instead of storing an unbounded blob", () => {
    const big = {
      toolName: "present_table",
      toolCallId: "b",
      input: {},
      output: visualResult("table", {
        title: "Big",
        columns: [],
        rows: [{ x: "x".repeat(200_000) }],
      }),
    };
    const parts = collectVizParts([{ toolResults: [big, big] }]);

    expect(parts).toHaveLength(1);
  });
});

const row = (over: any) => ({
  id: "m1",
  conversationId: "conv",
  type: "assistant",
  content: "Here is your history.",
  tokenEstimate: 5,
  createdAt: new Date("2026-10-27T10:00:00Z"),
  ...over,
});
const memoryWith = (messages: any[]) =>
  ({
    conversations: { findById: vi.fn().mockResolvedValue({ id: "conv", userId: "7" }) },
    temporal: { getMessages: vi.fn().mockResolvedValue(messages) },
  }) as any;

describe("GET /content-agent/messages: saved parts", () => {
  const user = { id: 7, collection: "users" };

  const call = async (memory: any) => {
    const handler = createMessagesHandler(async () => memory);
    const res = await handler({
      user,
      url: "http://x/api/content-agent/messages?conversationId=conv",
      payload: { config: { admin: { user: "users" } } },
    } as any);

    return (await res.json()).messages;
  };

  it("returns the saved visual parts with the assistant message", async () => {
    const parts = [
      {
        type: "tool-present_table",
        toolCallId: "c2",
        state: "output-available",
        input: {},
        output: { ok: true },
      },
    ];
    const [m] = await call(memoryWith([row({ parts })]));

    expect(m.parts).toEqual(parts);
    expect(m.content).toBe("Here is your history.");
  });

  it("returns no parts for a message saved without visual parts", async () => {
    const [m] = await call(memoryWith([row({ parts: null })]));

    expect("parts" in m).toBe(false);
  });
});
