// Runs the migrations on a real Postgres. Needs CA_TEST_DATABASE_URL: a connection string whose role
// may create databases, for example postgres://localhost:5432/postgres.
// Without the variable the tests are skipped locally; in CI a missing variable is a failure.
import { afterAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { MIGRATIONS, runMigrations } from "../src/memory/database.js";

const ADMIN_URL = process.env.CA_TEST_DATABASE_URL;
const ALL_NAMES = MIGRATIONS.map((m) => m.name);

const created: string[] = [];
let counter = 0;

async function freshDatabase(): Promise<pg.Pool> {
  const name = `ca_test_${process.pid}_${Date.now()}_${counter++}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });

  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  created.push(name);
  const url = new URL(ADMIN_URL!);

  url.pathname = `/${name}`;

  return new pg.Pool({ connectionString: url.toString(), max: 2 });
}

const pools: pg.Pool[] = [];

async function database() {
  const pool = await freshDatabase();

  pools.push(pool);

  return pool;
}

const applied = async (db: pg.Pool) =>
  (await db.query("SELECT name FROM content_agent.ca_migrations ORDER BY id")).rows.map(
    (r) => r.name as string
  );

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end().catch(() => {})));
  if (!ADMIN_URL || !created.length) return;
  const admin = new pg.Client({ connectionString: ADMIN_URL });

  await admin.connect();
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => {});
  await admin.end();
});

describe("migrations on Postgres: setup", () => {
  it("has a database in CI", () => {
    if (process.env.CI) expect(ADMIN_URL, "set CA_TEST_DATABASE_URL in CI").toBeTruthy();
  });
});

describe.skipIf(!ADMIN_URL)("migrations on Postgres", () => {
  vi.spyOn(console, "log").mockImplementation(() => {});

  it("applies every migration to an empty database, and a second run applies nothing", async () => {
    const db = await database();

    await runMigrations(db);
    expect(await applied(db)).toEqual(ALL_NAMES);

    const { rows: tables } = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'content_agent' ORDER BY 1`
    );

    expect(tables.map((r) => r.table_name)).toEqual([
      "ca_agent_telemetry",
      "ca_background_reports",
      "ca_changesets",
      "ca_chat_ratings",
      "ca_conversations",
      "ca_ltm_entries",
      "ca_migrations",
      "ca_pending_bulk",
      "ca_present_state",
      "ca_temporal_messages",
      "ca_temporal_summaries",
      "ca_workers",
    ]);

    await runMigrations(db);
    expect(await applied(db)).toEqual(ALL_NAMES);
  });

  it("adds the embedding columns only when the vector extension exists", async () => {
    const db = await database();

    await runMigrations(db);
    const { rows: ext } = await db.query(`SELECT 1 FROM pg_type WHERE typname = 'vector'`);
    const { rows: cols } = await db.query(
      `SELECT table_name FROM information_schema.columns WHERE table_schema = 'content_agent' AND column_name = 'embedding' ORDER BY 1`
    );

    expect(cols.map((r) => r.table_name)).toEqual(
      ext.length ? ["ca_ltm_entries", "ca_temporal_summaries"] : []
    );
  });

  it("a failing module migration leaves the core committed and is retried on the next run", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await database();
    const bad = {
      module: "bad",
      migrations: [
        { name: "001-ok", sql: "CREATE TABLE ca_bad (id INT)" },
        { name: "002-broken", sql: "SELECT * FROM no_such_table" },
      ],
    };

    await runMigrations(db, [bad]);
    const names = await applied(db);

    expect(names).not.toContain("bad:001-ok");
    expect(names).toContain("001-init");
    expect(
      (await db.query(`SELECT to_regclass('content_agent.ca_bad') AS t`)).rows[0].t
    ).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
