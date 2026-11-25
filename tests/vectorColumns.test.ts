import { describe, it, expect, vi } from "vitest";

import { fitVectorColumns } from "../src/memory/vectorColumns.js";

function fakePool(dimensions: Record<string, number>, failIndex = false) {
  const statements: string[] = [];

  const run = async (sql: string) => {
    statements.push(sql.replace(/\s+/gu, " ").trim());

    if (sql.includes("pg_attribute")) {
      return {
        rows: Object.entries(dimensions).map(([table_name, dimension]) => ({
          table_name,
          dimension,
        })),
      };
    }

    if (failIndex && sql.includes("CREATE INDEX")) throw new Error("column too wide for hnsw");

    return { rows: [] };
  };

  const client = { query: vi.fn(run), release: vi.fn() };
  const pool = { connect: vi.fn(async () => client), query: vi.fn(run) } as any;

  return { pool, client, statements };
}

describe("the embedding columns take the size of the embedding model", () => {
  it("leaves columns of the right size alone", async () => {
    const { pool, statements } = fakePool({ ca_ltm_entries: 768, ca_temporal_summaries: 768 });

    expect(await fitVectorColumns(pool, "public", 768)).toEqual([]);
    expect(statements.some((sql) => sql.startsWith("ALTER TABLE"))).toBe(false);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("resizes a column of another size and builds its index again", async () => {
    const { pool, statements } = fakePool({ ca_ltm_entries: 1536, ca_temporal_summaries: 768 });

    expect(await fitVectorColumns(pool, "ext", 768)).toEqual(["ca_ltm_entries"]);
    expect(statements).toContain("DROP INDEX IF EXISTS content_agent.idx_ca_ltm_vec");
    expect(statements).toContain(
      "ALTER TABLE content_agent.ca_ltm_entries ADD COLUMN embedding ext.vector(768)"
    );
    expect(statements.at(-1)).toBe(
      "CREATE INDEX IF NOT EXISTS idx_ca_ltm_vec ON content_agent.ca_ltm_entries USING hnsw (embedding ext.vector_cosine_ops)"
    );
    expect(statements.join("\n")).not.toContain("ca_temporal_summaries ADD COLUMN");
  });

  it("does nothing to a table that has no embedding column", async () => {
    const { pool } = fakePool({});

    expect(await fitVectorColumns(pool, "public", 3072)).toEqual([]);
  });

  it("keeps the resized column when the index cannot be built", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { pool } = fakePool({ ca_ltm_entries: 1536, ca_temporal_summaries: 1536 }, true);

    expect(await fitVectorColumns(pool, "public", 3072)).toEqual([
      "ca_ltm_entries",
      "ca_temporal_summaries",
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("rolls back and reports when a statement fails", async () => {
    const { pool, client } = fakePool({ ca_ltm_entries: 1536 });

    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_attribute")) {
        return { rows: [{ table_name: "ca_ltm_entries", dimension: 1536 }] };
      }

      if (sql.startsWith("ALTER TABLE")) throw new Error("no permission");

      return { rows: [] };
    });

    await expect(fitVectorColumns(pool, "public", 768)).rejects.toThrow("no permission");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });

  it("refuses a size that is not a whole positive number", async () => {
    const { pool } = fakePool({});

    await expect(fitVectorColumns(pool, "public", 0)).rejects.toThrow("0 dimensions");
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
