import type { DatabasePool } from "./database.js";
import { MIGRATION_LOCK_KEY, PG_SCHEMA } from "./migrations.js";

const VECTOR_COLUMNS = [
  { table: "ca_ltm_entries", index: "idx_ca_ltm_vec" },
  { table: "ca_temporal_summaries", index: "idx_ca_temporal_sum_vec" },
];

const DIMENSIONS_QUERY = `SELECT c.relname AS table_name, a.atttypmod AS dimension
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relname = ANY($2) AND a.attname = 'embedding' AND NOT a.attisdropped`;

/**
 * Gives the embedding columns the size of the embedding model. Vectors of another size come
 * from another model and cannot be compared with the new ones, so a resized column starts
 * empty and the backfill fills it again from the stored text.
 * Returns the tables it resized.
 */
export async function fitVectorColumns(
  db: DatabasePool,
  vectorSchema: string,
  dimension: number
): Promise<string[]> {
  if (!Number.isInteger(dimension) || dimension < 1) {
    throw new Error(`The embedding model returned a vector of ${dimension} dimensions.`);
  }

  const resized: string[] = [];
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    const { rows } = await client.query(DIMENSIONS_QUERY, [
      PG_SCHEMA,
      VECTOR_COLUMNS.map((column) => column.table),
    ]);
    const current = new Map<string, number>(
      rows.map((row: { table_name: string; dimension: number }) => [
        row.table_name,
        Number(row.dimension),
      ])
    );

    for (const { table, index } of VECTOR_COLUMNS) {
      const size = current.get(table);

      if (size === undefined || size === dimension) continue;
      await client.query(`DROP INDEX IF EXISTS ${PG_SCHEMA}.${index}`);
      await client.query(`ALTER TABLE ${PG_SCHEMA}.${table} DROP COLUMN embedding`);
      await client.query(
        `ALTER TABLE ${PG_SCHEMA}.${table} ADD COLUMN embedding ${vectorSchema}.vector(${dimension})`
      );
      resized.push(table);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  for (const { table, index } of VECTOR_COLUMNS) {
    if (!resized.includes(table)) continue;

    // The index has a size limit and needs a recent pgvector. Without it the search still
    // works, by a sequential scan.
    await db
      .query(
        `CREATE INDEX IF NOT EXISTS ${index} ON ${PG_SCHEMA}.${table}
         USING hnsw (embedding ${vectorSchema}.vector_cosine_ops)`
      )
      .catch((err: unknown) => {
        console.warn(
          `[Content Agent] No vector index on ${table} (${dimension} dimensions), the search scans the table:`,
          err instanceof Error ? err.message : err
        );
      });
  }

  return resized;
}
