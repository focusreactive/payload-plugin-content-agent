import pg from "pg";
import { EMBEDDING_VECTOR_DIM, MIGRATION_LOCK_KEY, MIGRATIONS, PG_SCHEMA } from "./migrations.js";

export { EMBEDDING_VECTOR_DIM, MIGRATIONS } from "./migrations.js";

const { Pool } = pg;

export type DatabasePool = pg.Pool;

// Lives on globalThis so a dev module reload reuses the pool instead of leaking a new one.
const POOLS_KEY = Symbol.for("payload-content-agent.pg-pools");

function poolRegistry(): Map<string, DatabasePool> {
  const globalStore = globalThis as Record<symbol, unknown>;

  if (!globalStore[POOLS_KEY]) globalStore[POOLS_KEY] = new Map<string, DatabasePool>();

  return globalStore[POOLS_KEY] as Map<string, DatabasePool>;
}

export function getPool(connectionString: string): DatabasePool {
  const pools = poolRegistry();
  let pool = pools.get(connectionString);

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.CONTENT_AGENT_DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
      application_name: "payload-content-agent",
    });
    // Without an 'error' listener, a dropped idle client is an uncaught exception
    // that crashes the server.
    pool.on("error", (err) => {
      console.warn(
        "[Content Agent] Idle DB client error (recovered, client discarded):",
        err instanceof Error ? err.message : err
      );
    });
    pools.set(connectionString, pool);
  }

  return pool;
}

/**
 * The name of a plugin table with its schema. Queries must not rely on `search_path`: it does
 * not survive transaction-mode pooling.
 * @public
 */
export function t(tableName: string): string {
  return `${PG_SCHEMA}.${tableName}`;
}

/** The names of the migrations this database has, in the order they were applied. */
export async function appliedMigrations(db: DatabasePool): Promise<string[]> {
  const { rows } = await db.query(`SELECT name FROM ${t("ca_migrations")} ORDER BY id`);

  return rows.map((row: { name: unknown }) => String(row.name));
}

export async function closePool(connectionString?: string): Promise<void> {
  const pools = poolRegistry();
  const targets = connectionString
    ? pools.has(connectionString)
      ? [connectionString]
      : []
    : [...pools.keys()];

  for (const key of targets) {
    const pool = pools.get(key);

    pools.delete(key);
    if (pool) await pool.end().catch(() => undefined);
  }
}

const VECTOR_SCHEMA_QUERY = `SELECT quote_ident(n.nspname) AS schema
  FROM pg_type ty JOIN pg_namespace n ON ty.typnamespace = n.oid
  WHERE ty.typname = 'vector' LIMIT 1`;

export async function resolveVectorSchema(db: DatabasePool): Promise<string | null> {
  try {
    const { rows } = await db.query(VECTOR_SCHEMA_QUERY);

    return rows[0]?.schema ?? null;
  } catch {
    return null;
  }
}

// Runs on every start, not as a recorded migration,
// so the columns appear when pgvector is installed later.
const ENSURE_VECTOR_COLUMNS_SQL = `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = '${PG_SCHEMA}' AND table_name = 'ca_ltm_entries' AND column_name = 'embedding'
    ) THEN
      ALTER TABLE ca_ltm_entries ADD COLUMN embedding vector(${EMBEDDING_VECTOR_DIM});
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = '${PG_SCHEMA}' AND table_name = 'ca_temporal_summaries' AND column_name = 'embedding'
    ) THEN
      ALTER TABLE ca_temporal_summaries ADD COLUMN embedding vector(${EMBEDDING_VECTOR_DIM});
    END IF;

    -- hnsw needs pgvector >= 0.5.0 - an older extension must degrade to "vectors
    -- without an index" (sequential scan), not abort the whole migration transaction
    -- and disable the entire memory subsystem.
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_ca_ltm_vec ON ca_ltm_entries
        USING hnsw (embedding vector_cosine_ops);
      CREATE INDEX IF NOT EXISTS idx_ca_temporal_sum_vec ON ca_temporal_summaries
        USING hnsw (embedding vector_cosine_ops);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'hnsw index creation failed (old pgvector?) - vector search will be unindexed';
    END;
  END IF;
END $$;
`;

// One transaction, `SET LOCAL` and a transaction-scoped advisory lock: session-level state
// does not hold through a transaction-mode pooler.
export async function runMigrations(
  db: DatabasePool,
  moduleMigrations: Array<{
    module: string;
    migrations: Array<{ name: string; sql: string }>;
  }> = [],
  core: Array<{ name: string; sql: string }> = MIGRATIONS
): Promise<void> {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);

      await client.query(`CREATE SCHEMA IF NOT EXISTS ${PG_SCHEMA}`);

      const { rows: vecRows } = await client.query(VECTOR_SCHEMA_QUERY);
      const vectorSchema: string | undefined = vecRows[0]?.schema;
      const extraPath = vectorSchema && vectorSchema !== "public" ? `, ${vectorSchema}` : "";

      await client.query(`SET LOCAL search_path TO ${PG_SCHEMA}, public${extraPath}`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ca_migrations (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          applied_at TIMESTAMPTZ DEFAULT now()
        )
      `);

      for (const migration of core) {
        const { rows } = await client.query("SELECT 1 FROM ca_migrations WHERE name = $1", [
          migration.name,
        ]);

        if (rows.length > 0) continue;

        await client.query(migration.sql);
        await client.query("INSERT INTO ca_migrations (name) VALUES ($1)", [migration.name]);
        console.log(`[Content Agent] Migration applied: ${migration.name}`);
      }

      await client.query(ENSURE_VECTOR_COLUMNS_SQL);

      for (const group of moduleMigrations) {
        await client.query("SAVEPOINT ca_module_migrations");

        try {
          for (const migration of group.migrations) {
            const name = `${group.module}:${migration.name}`;
            const { rows } = await client.query("SELECT 1 FROM ca_migrations WHERE name = $1", [
              name,
            ]);

            if (rows.length > 0) continue;
            await client.query(migration.sql);
            await client.query("INSERT INTO ca_migrations (name) VALUES ($1)", [name]);
            console.log(`[Content Agent] Migration applied: ${name}`);
          }

          await client.query("RELEASE SAVEPOINT ca_module_migrations");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT ca_module_migrations");
          console.error(
            `[Content Agent] module "${group.module}": migration failed, its tables are not ready (retried on the next start):`,
            err instanceof Error ? err.message : err
          );
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}
