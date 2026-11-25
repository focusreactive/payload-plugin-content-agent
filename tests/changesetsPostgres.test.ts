// The changeset SQL on a real Postgres. Needs CA_TEST_DATABASE_URL, like tests/migrationsPostgres.test.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { runMigrations } from "../src/memory/database.js";
import { ChangesetStorage } from "../src/memory/storage/changesets.js";

const ADMIN_URL = process.env.CA_TEST_DATABASE_URL;
const NAME = `ca_test_changesets_${process.pid}_${Date.now()}`;

const admin = async (sql: string) => {
  const client = new pg.Client({ connectionString: ADMIN_URL });

  await client.connect();
  await client.query(sql);
  await client.end();
};

describe.skipIf(!ADMIN_URL)("changesets on Postgres", () => {
  let pool: pg.Pool;
  let changesets: ChangesetStorage;
  let conversationId: string;

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await admin(`CREATE DATABASE ${NAME}`);
    const url = new URL(ADMIN_URL!);

    url.pathname = `/${NAME}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await runMigrations(pool, []);
    const { rows } = await pool.query(
      "INSERT INTO content_agent.ca_conversations (user_id) VALUES ('u1') RETURNING id"
    );

    conversationId = rows[0].id;
    changesets = new ChangesetStorage(pool);
  });

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin(`DROP DATABASE IF EXISTS ${NAME}`).catch(() => {});
  });

  it("lists the changed documents with their titles and without their snapshots", async () => {
    const created = await pool.query(
      "INSERT INTO content_agent.ca_conversations (user_id) VALUES ('u1') RETURNING id"
    );
    const other: string = created.rows[0].id;

    await changesets.record(other, [
      { collection: "notes", id: 1, before: { heading: "Old" }, after: { heading: "New" } },
      { collection: "notes", id: 2, op: "create", before: {}, after: { heading: "Made" } },
      { collection: "global:footer", id: "footer", before: { text: "a" }, after: { text: "b" } },
    ]);
    const rows = await changesets.listChanged(other, { notes: "heading" });
    const byId = Object.fromEntries(rows.map((row) => [`${row.collection}:${row.id}`, row]));

    expect(byId["notes:1"]).toMatchObject({ title: "New", created: false });
    expect(byId["notes:2"]).toMatchObject({ title: "Made", created: true });
    expect(byId["global:footer:footer"]).toMatchObject({ title: undefined, created: false });
    expect(await changesets.listChanged(other, {})).toHaveLength(3);
  });

  it("keeps one change per written locale, each with the state of its first record", async () => {
    await changesets.record(conversationId, [
      { collection: "notes", id: 7, locale: "en", before: { text: "one" }, after: { text: "two" } },
      {
        collection: "notes",
        id: 7,
        locale: "de",
        before: { text: "one" },
        after: { text: "zwei" },
        restore: { text: null },
      },
    ]);
    await changesets.record(conversationId, [
      {
        collection: "notes",
        id: 7,
        locale: "de",
        before: { text: "zwei" },
        after: { text: "drei" },
        restore: { text: "zwei" },
      },
    ]);
    const stored = await changesets.listForDocument(conversationId, "notes", 7);

    expect(stored.map(({ locale, restore, after }) => ({ locale, restore, after }))).toEqual([
      { locale: "de", restore: { text: null }, after: { text: "drei" } },
      { locale: "en", restore: { text: "one" }, after: { text: "two" } },
    ]);
  });

  it("finds the versions of a document with or without its locale", async () => {
    const german = await changesets.getSnapshots(conversationId, "notes", 7, "de");
    const latest = await changesets.getSnapshots(conversationId, "notes", 7);

    expect(german?.after).toEqual({ text: "drei" });
    expect(latest?.after).toEqual({ text: "drei" });
    expect(await changesets.getSnapshots(conversationId, "notes", 7, "fr")).toBeNull();
  });

  it("marks a discarded change and keeps its first state for a later change", async () => {
    const change = { collection: "notes", id: "7", locale: "en" };

    await changesets.settle(conversationId, change, { after: { text: "one" }, discarded: true });
    const [english] = (await changesets.listForDocument(conversationId, "notes", 7)).filter(
      ({ locale }) => locale === "en"
    );

    expect(english).toMatchObject({ op: "discarded", after: { text: "one" } });
    await changesets.settle(
      conversationId,
      { ...change, locale: "de" },
      { after: { text: "x" }, discarded: false }
    );
    const refs = await changesets.list(conversationId);

    expect(refs.find((ref) => ref.locale === "de")?.op).not.toBe("discarded");
    await changesets.record(conversationId, [
      { ...change, id: 7, op: "edit", before: { text: "one" }, after: { text: "four" } },
    ]);
    const again = await changesets.listForDocument(conversationId, "notes", 7);

    expect(again.find(({ locale }) => locale === "en")).toMatchObject({
      op: "edit",
      restore: { text: "one" },
      after: { text: "four" },
    });
  });
});
