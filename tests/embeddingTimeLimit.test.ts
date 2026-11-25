import { describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  embed: vi.fn(async () => ({ embedding: [0.1, 0.2] })),
  embedMany: vi.fn(async ({ values }: { values: string[] }) => ({
    embeddings: values.map(() => [0.1, 0.2]),
  })),
}));

import { embed, embedMany } from "ai";
import { EmbeddingService } from "../src/memory/embeddings.js";

describe("an embedding call", () => {
  it("has a time limit, so a stalled provider cannot hold the chat", async () => {
    const service = new EmbeddingService({} as any, "some-embedding-model" as any);

    await service.embedText("one");
    await service.embedTexts(["one", "two"]);

    expect(vi.mocked(embed).mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
    expect(vi.mocked(embedMany).mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
  });
});
