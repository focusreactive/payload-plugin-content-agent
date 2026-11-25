import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();

  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({ text: "synthesized answer" }),
  };
});

import { runReflection } from "../src/memory/reflect.js";

describe("runReflection: user scoping (IDOR)", () => {
  const CONTENT_A = "user A secret: quarterly budget numbers";
  const CONTENT_B = "user B secret: unreleased feature plan";
  const LTM_A = "user A fact: prefers short intros";
  const LTM_B = "user B fact: launch date of the private beta";

  const makeMemory = ({ embeddings = true } = {}) => {
    const allMessages = [
      { id: "m1", type: "user", content: CONTENT_A, createdAt: new Date(), userId: "user-a" },
      { id: "m2", type: "user", content: CONTENT_B, createdAt: new Date(), userId: "user-b" },
    ];
    const allSummaries = [
      {
        id: "s1",
        conversationId: "c1",
        narrative: `summary of: ${CONTENT_A}`,
        keyObservations: [],
        score: 0.9,
        userId: "user-a",
      },
      {
        id: "s2",
        conversationId: "c2",
        narrative: `summary of: ${CONTENT_B}`,
        keyObservations: [],
        score: 0.9,
        userId: "user-b",
      },
    ];

    const allEntries = [
      { path: "notes/a", title: "A", body: LTM_A, score: 0.8, userId: "user-a" },
      { path: "notes/b", title: "B", body: LTM_B, score: 0.8, userId: "user-b" },
    ];
    const entriesOf = async (userId: string) =>
      allEntries.filter((entry) => entry.userId === userId);

    return {
      temporal: {
        searchAllMessages: vi.fn(async (userId: string) =>
          allMessages.filter((m) => m.userId === userId)
        ),
      },
      embeddings: embeddings
        ? {
            searchSummaries: vi.fn(async (userId: string) =>
              allSummaries.filter((s) => s.userId === userId)
            ),
            hybridSearchLtm: vi.fn(entriesOf),
          }
        : undefined,
      ltm: {
        searchWithShared: vi.fn(entriesOf),
      },
    } as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the requesting userId down to searchAllMessages and searchSummaries", async () => {
    const memory = makeMemory();

    await runReflection("what happened", "user-a", memory, {} as any);
    expect(memory.temporal.searchAllMessages).toHaveBeenCalledWith("user-a", "what happened", 10);
    expect(memory.embeddings.searchSummaries).toHaveBeenCalledWith("user-a", "what happened", 5);
    expect(memory.embeddings.hybridSearchLtm).toHaveBeenCalledWith("user-a", "what happened", 5);
  });

  it.each([
    { search: "the hybrid search", embeddings: true },
    { search: "the search without embeddings", embeddings: false },
  ])("$search of long-term memory is scoped to the user", async ({ embeddings }) => {
    const memory = makeMemory({ embeddings });

    await runReflection("what happened", "user-a", memory, {} as any);

    const ai = await import("ai");
    const spy = vi.mocked(ai.generateText as any);

    expect(spy).toHaveBeenCalledTimes(1);
    const promptSentToSynthesis = spy.mock.calls[0][0].messages[0].content as string;

    expect(promptSentToSynthesis).toContain(CONTENT_A);
    expect(promptSentToSynthesis).toContain(LTM_A);
    expect(promptSentToSynthesis).not.toContain(CONTENT_B);
    expect(promptSentToSynthesis).not.toContain(LTM_B);
    if (!embeddings)
      expect(memory.ltm.searchWithShared).toHaveBeenCalledWith("user-a", "what happened", 5);
  });
});
