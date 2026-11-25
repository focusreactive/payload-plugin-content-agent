// The memory text search on a real Postgres. Needs CA_TEST_DATABASE_URL, like tests/migrationsPostgres.test.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { runMigrations } from "../src/memory/database.js";
import { TemporalStorage } from "../src/memory/storage/temporal.js";

const ADMIN_URL = process.env.CA_TEST_DATABASE_URL;
const NAME = `ca_test_memory_search_${process.pid}_${Date.now()}`;

const admin = async (sql: string) => {
  const client = new pg.Client({ connectionString: ADMIN_URL });

  await client.connect();
  await client.query(sql);
  await client.end();
};

describe.skipIf(!ADMIN_URL)("memory text search on Postgres", () => {
  let pool: pg.Pool;
  let temporal: TemporalStorage;

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await admin(`CREATE DATABASE ${NAME}`);
    const url = new URL(ADMIN_URL!);

    url.pathname = `/${NAME}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await runMigrations(pool, []);
    temporal = new TemporalStorage(pool);

    const { rows } = await pool.query(
      "INSERT INTO content_agent.ca_conversations (user_id) VALUES ('u1') RETURNING id"
    );

    await temporal.addMessage(rows[0].id, "user", "The header colour is now green.");
    await temporal.addMessage(
      rows[0].id,
      "user",
      "We removed the pricing table from the migration guide because of ticket LGL-7."
    );
  });

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin(`DROP DATABASE IF EXISTS ${NAME}`).catch(() => {});
  });

  it("a question finds the message that answers it, though the message lacks some of its words", async () => {
    const found = await temporal.searchAllMessages(
      "u1",
      "Why did we remove the pricing table from the migration guide?",
      5
    );

    expect(found[0]?.content).toContain("LGL-7");
  });

  it("a query with no word in any message finds nothing", async () => {
    expect(await temporal.searchAllMessages("u1", "quarterly forecast", 5)).toEqual([]);
  });
});
