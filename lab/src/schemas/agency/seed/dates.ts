import type { Payload } from "payload";

const FIRST = "TIMESTAMPTZ '2023-01-02 08:00:00+00'";
const LAST = "TIMESTAMPTZ '2026-05-29 16:00:00+00'";
const minutes = `((id * 37) % 540) * INTERVAL '1 minute'`;

// The moment a document was created, when another field of the document does not give it.
const CREATED: Record<string, string> = {
  posts: `COALESCE(published_on, ${FIRST}) - INTERVAL '6 days' + ${minutes}`,
  form_submissions: "submitted_at",
  changelog: "released_on",
};

// A seed writes the current time into every row. The dates of a document come from its id here,
// so two seeds give the same history and no date is later than the day the texts were written.
export async function freezeDates(payload: Payload, collections: string[], globals: string[]) {
  const { pool } = payload.db as unknown as {
    pool: { query: (text: string) => Promise<{ rows: Record<string, string>[] }> };
  };
  const { rows } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const tables = new Set(rows.map((row) => row.table_name));

  for (const slug of collections) {
    const table = slug.replaceAll("-", "_");
    const versions = `_${table}_v`;

    await pool.query(
      `UPDATE "${table}" SET created_at = ${CREATED[table] ?? `${FIRST} + ((id * 7919) % 1240) * INTERVAL '1 day' + ${minutes}`}`
    );
    await pool.query(
      table === "form_submissions"
        ? `UPDATE "${table}" SET updated_at = created_at`
        : `UPDATE "${table}" SET updated_at = LEAST(created_at + ((id * 13) % 200) * INTERVAL '1 day' + INTERVAL '3 hours', ${LAST})`
    );
    if (!tables.has(versions)) continue;

    // A document with one version was never changed after it was created.
    await pool.query(
      `UPDATE "${table}" t SET updated_at = created_at WHERE (SELECT count(*) FROM "${versions}" v WHERE v.parent_id = t.id) = 1`
    );
    await pool.query(`
      WITH ranked AS (
        SELECT id, row_number() OVER (PARTITION BY parent_id ORDER BY id) AS n,
               count(*) OVER (PARTITION BY parent_id) AS c
        FROM "${versions}"
      )
      UPDATE "${versions}" v
      SET version_created_at = t.created_at,
          version_updated_at = t.created_at + (t.updated_at - t.created_at) * ((ranked.n - 1)::float8 / GREATEST(ranked.c - 1, 1)),
          created_at = t.created_at + (t.updated_at - t.created_at) * ((ranked.n - 1)::float8 / GREATEST(ranked.c - 1, 1)),
          updated_at = t.created_at + (t.updated_at - t.created_at) * ((ranked.n - 1)::float8 / GREATEST(ranked.c - 1, 1))
      FROM ranked, "${table}" t
      WHERE ranked.id = v.id AND t.id = v.parent_id`);
  }

  for (const table of globals.map((slug) => slug.replaceAll("-", "_"))) {
    await pool.query(
      `UPDATE "${table}" SET created_at = ${FIRST}, updated_at = TIMESTAMPTZ '2026-04-20 10:00:00+00'`
    );
    if (tables.has(`_${table}_v`))
      await pool.query(
        `UPDATE "_${table}_v" SET version_created_at = ${FIRST}, version_updated_at = TIMESTAMPTZ '2026-04-20 10:00:00+00', created_at = TIMESTAMPTZ '2026-04-20 10:00:00+00', updated_at = TIMESTAMPTZ '2026-04-20 10:00:00+00'`
      );
  }
}
