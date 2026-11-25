import { describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  embed: vi.fn(async () => ({ embedding: [0.1, 0.2] })),
}));

import { EmbeddingService } from "../src/memory/embeddings.js";

const UNSPACED = "価格ページの書き換え";

describe("the full-text half of a hybrid memory search", () => {
  it("also matches a query in a script without spaces as a substring", async () => {
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);

        return { rows: [] };
      }),
    } as any;
    const service = new EmbeddingService(db, "some-embedding-model" as any);

    await service.searchSummaries("u", UNSPACED);
    await service.hybridSearchLtm("u", UNSPACED);

    expect(queries).toHaveLength(2);

    for (const sql of queries) expect(sql).toContain("strpos(lower(");
  });
});
