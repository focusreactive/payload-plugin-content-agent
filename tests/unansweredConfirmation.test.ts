import { describe, expect, it, vi } from "vitest";
import { loadTurnMemory } from "../src/agent/runAgent/prepare.js";

const memory = () =>
  ({
    saveMessage: vi.fn(async () => undefined),
    assembleContext: vi.fn(async () => ({})),
    getSystemPromptAdditions: () => "",
    changesets: { listChanged: vi.fn(async () => []) },
    conversations: { touch: vi.fn(async () => undefined) },
  }) as any;

describe("a reply that stopped at a confirmation the person did not answer", () => {
  it("is stored with what it said, and says only that the change in the card was not made", async () => {
    const stored = memory();
    const messages: any[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Retitle the posts" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "I retitled five posts." },
          {
            type: "tool-updateDocument",
            toolCallId: "c6",
            state: "approval-requested",
            input: {},
            approval: { id: "p1" },
          },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "stop" }] },
    ];

    await loadTurnMemory(
      {
        memory: stored,
        conversationId: "c",
        userId: "u",
        messages,
        attachmentOutcomes: [],
        schema: { collections: [], globals: [] },
      },
      {} as any
    );
    const [, role, text] = stored.saveMessage.mock.calls[0];

    expect(role).toBe("assistant");
    expect(text).toContain("I retitled five posts.");
    expect(text).toContain("the change in the card was not made");
    expect(text).not.toContain("nothing was changed");
  });
});
