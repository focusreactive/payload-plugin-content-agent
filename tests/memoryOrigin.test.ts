import { describe, it, expect, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();

  return { ...actual, generateText: vi.fn().mockResolvedValue({ text: "answer" }) };
});

import { generateText } from "ai";
import { entryOrigin, formatLtmForPrompt } from "../src/memory/contextAssembler.js";
import { runReflection } from "../src/memory/reflect.js";

const entry = (over: Record<string, unknown>) =>
  ({
    path: "/notes/a",
    title: "A note",
    body: "The body.",
    userId: "__shared__",
    createdBy: "user-1",
    updatedBy: "user-2",
    updatedAt: new Date("2026-03-04T10:00:00Z"),
    ...over,
  }) as any;

describe("entryOrigin", () => {
  it("names the last author and the day of the last update", () => {
    expect(entryOrigin(entry({}))).toBe("by user-2, updated 2026-03-04");
    expect(entryOrigin(entry({ updatedBy: "" }))).toBe("by user-1, updated 2026-03-04");
    expect(entryOrigin(entry({ updatedAt: "2026-03-04T23:59:00Z" }))).toContain("2026-03-04");
  });

  it("leaves out what the row does not hold", () => {
    expect(entryOrigin({})).toBe("");
    expect(entryOrigin({ createdBy: "x", updatedAt: "not a date" })).toBe("by x");
  });
});

describe("formatLtmForPrompt", () => {
  it("puts the author and the date next to each entry", () => {
    const prompt = formatLtmForPrompt(entry({ body: "I am." }), entry({ body: "Rules." }));

    expect(prompt).toContain("## Identity (by user-2, updated 2026-03-04)\nI am.");
    expect(prompt).toContain("## Behavior (by user-2, updated 2026-03-04)\nRules.");
  });
});

const evidence = () => {
  const call = vi.mocked(generateText).mock.calls.at(-1)?.[0] as any;

  return String(call.messages[0].content);
};

const memory = (embeddings: unknown, found: unknown[]) =>
  ({
    temporal: { searchAllMessages: vi.fn(async () => []) },
    embeddings,
    ltm: { searchWithShared: vi.fn(async () => found) },
  }) as any;

describe("runReflection", () => {
  it("shows the author and the date of an entry found by full text", async () => {
    await runReflection("q", "user-1", memory(null, [entry({})]), {} as any);

    expect(evidence()).toContain(
      "[/notes/a] A note (scope: shared, by user-2, updated 2026-03-04): The body."
    );
  });

  it("shows them for an entry found by the hybrid search too", async () => {
    const embeddings = {
      searchSummaries: vi.fn(async () => []),
      hybridSearchLtm: vi.fn(async () => [entry({ userId: "user-1", score: 0.5 })]),
    };

    await runReflection("q", "user-1", memory(embeddings, []), {} as any);

    expect(evidence()).toContain(
      "[/notes/a] A note (scope: user:user-1, by user-2, updated 2026-03-04, score:0.500): The body."
    );
  });
});
