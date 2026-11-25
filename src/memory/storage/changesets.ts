import { isRecord } from "../../borders.js";
import type { DocFields } from "../../borders.js";
import { t } from "../database.js";
import type { DatabasePool } from "../database.js";
import { rowOf, stringOf } from "./rows.js";
import type { Row } from "./rows.js";

export interface ChangesetRef {
  collection: string;
  id: string | number;
  op?: string;
  locale?: string;
  before?: unknown;
  after?: unknown;
  /** The written locale before the change, when `before` is not that state. */
  restore?: unknown;
  report?: unknown;
}

export interface StoredChange {
  collection: string;
  id: string;
  op?: string;
  locale?: string;
  before: DocFields | null;
  after: DocFields | null;
  /** The state a discard brings back: the written locale before the first change. */
  restore: DocFields | null;
  report: unknown;
}

export interface ChangedDocumentRow {
  collection: string;
  id: string;
  op?: string;
  locale?: string;
  title?: string;
  /** The conversation created the document: its first stored state is empty. */
  created: boolean;
}

export const DISCARDED_OP = "discarded";

const snapshotOf = (value: unknown): DocFields | null => (isRecord(value) ? value : null);

const storedChangeOf = (row: Row): StoredChange => ({
  collection: stringOf(row.collection) ?? "",
  id: stringOf(row.doc_id) ?? "",
  op: stringOf(row.op),
  locale: stringOf(row.locale) || undefined,
  before: snapshotOf(row.before_snapshot),
  after: snapshotOf(row.after_snapshot),
  restore: snapshotOf(row.restore_snapshot) ?? snapshotOf(row.before_snapshot),
  report: row.report,
});

const STORED_COLUMNS =
  "collection, doc_id, op, locale, before_snapshot, after_snapshot, restore_snapshot, report";

// The locale column is part of the primary key, so the default locale is '' and not NULL.
const NO_LOCALE = "";

export class ChangesetStorage {
  private db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  async record(conversationId: string, refs: ChangesetRef[]): Promise<void> {
    if (!conversationId || !refs?.length) return;
    const seen = new Set<string>();

    for (const ref of refs) {
      if (!ref?.collection || ref.id == null || String(ref.id).trim() === "") continue;
      const locale = ref.locale ?? NO_LOCALE;
      const key = `${ref.collection}:${ref.id}:${locale}`;

      if (seen.has(key)) continue;
      seen.add(key);
      await this.db.query(
        `INSERT INTO ${t("ca_changesets")} (conversation_id, collection, doc_id, locale, op, before_snapshot, after_snapshot, report, restore_snapshot, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (conversation_id, collection, doc_id, locale)
         DO UPDATE SET op = EXCLUDED.op, updated_at = now(),
           -- keep the EARLIEST before-snapshot (true pre-session state); refresh after-snapshot
           -- to the latest edit, so the diff stays cumulative (first-before vs latest-after).
           before_snapshot = COALESCE(${t("ca_changesets")}.before_snapshot, EXCLUDED.before_snapshot),
           after_snapshot = COALESCE(EXCLUDED.after_snapshot, ${t("ca_changesets")}.after_snapshot),
           report = COALESCE(EXCLUDED.report, ${t("ca_changesets")}.report),
           restore_snapshot = CASE
             WHEN ${t("ca_changesets")}.before_snapshot IS NULL
             THEN COALESCE(${t("ca_changesets")}.restore_snapshot, EXCLUDED.restore_snapshot)
             ELSE ${t("ca_changesets")}.restore_snapshot
           END`,
        [
          conversationId,
          ref.collection,
          String(ref.id),
          locale,
          ref.op ?? null,
          ref.before !== undefined ? JSON.stringify(ref.before) : null,
          ref.after !== undefined ? JSON.stringify(ref.after) : null,
          ref.report !== undefined ? JSON.stringify(ref.report) : null,
          ref.restore != null ? JSON.stringify(ref.restore) : null,
        ]
      );
    }
  }

  async getSnapshots(
    conversationId: string,
    collection: string,
    docId: string | number,
    locale?: string
  ): Promise<{ before: DocFields | null; after: DocFields | null } | null> {
    if (!conversationId) return null;
    const res = await this.db.query(
      `SELECT before_snapshot, after_snapshot FROM ${t("ca_changesets")}
       WHERE conversation_id = $1 AND collection = $2 AND doc_id = $3 AND ($4 = '' OR locale = $4)
       ORDER BY updated_at DESC LIMIT 1`,
      [conversationId, collection, String(docId), locale ?? NO_LOCALE]
    );

    if (!res.rows[0]) return null;
    const row = rowOf(res.rows[0]);

    return {
      before: isRecord(row.before_snapshot) ? row.before_snapshot : null,
      after: isRecord(row.after_snapshot) ? row.after_snapshot : null,
    };
  }

  /** Every change of the conversation with its two snapshots: the input of the review summary. */
  async listStored(conversationId: string): Promise<StoredChange[]> {
    if (!conversationId) return [];
    const res = await this.db.query(
      `SELECT ${STORED_COLUMNS} FROM ${t("ca_changesets")}
       WHERE conversation_id = $1 AND trim(doc_id) <> '' ORDER BY updated_at DESC`,
      [conversationId]
    );

    return res.rows.map(rowOf).map(storedChangeOf);
  }

  /** The stored changes of one document, one per written locale, the latest first. */
  async listForDocument(
    conversationId: string,
    collection: string,
    docId: string | number
  ): Promise<StoredChange[]> {
    if (!conversationId) return [];
    const res = await this.db.query(
      `SELECT ${STORED_COLUMNS} FROM ${t("ca_changesets")}
       WHERE conversation_id = $1 AND collection = $2 AND doc_id = $3 ORDER BY updated_at DESC`,
      [conversationId, collection, String(docId)]
    );

    return res.rows.map(rowOf).map(storedChangeOf);
  }

  /** After a discard: the document as it is now, and whether every change is gone. */
  async settle(
    conversationId: string,
    change: Pick<StoredChange, "collection" | "id" | "locale">,
    outcome: { after: DocFields; discarded: boolean }
  ): Promise<void> {
    await this.db.query(
      `UPDATE ${t("ca_changesets")}
       SET after_snapshot = $5, op = CASE WHEN $6 THEN '${DISCARDED_OP}' ELSE op END, updated_at = now()
       WHERE conversation_id = $1 AND collection = $2 AND doc_id = $3 AND locale = $4`,
      [
        conversationId,
        change.collection,
        change.id,
        change.locale ?? NO_LOCALE,
        JSON.stringify(outcome.after),
        outcome.discarded,
      ]
    );
  }

  /** The changed documents without their snapshots, each with the value of its title field. */
  async listChanged(
    conversationId: string,
    titleFields: Record<string, string>
  ): Promise<ChangedDocumentRow[]> {
    if (!conversationId) return [];
    const res = await this.db.query(
      `SELECT c.collection, c.doc_id, c.op, c.locale,
              c.after_snapshot ->> f.field AS title,
              (c.before_snapshot = '{}'::jsonb) AS created
       FROM ${t("ca_changesets")} c
       LEFT JOIN unnest($2::text[], $3::text[]) AS f(collection, field) ON f.collection = c.collection
       WHERE c.conversation_id = $1 AND trim(c.doc_id) <> '' ORDER BY c.updated_at DESC`,
      [conversationId, Object.keys(titleFields), Object.values(titleFields)]
    );

    return res.rows.map(rowOf).map((row) => ({
      collection: stringOf(row.collection) ?? "",
      id: stringOf(row.doc_id) ?? "",
      op: stringOf(row.op),
      locale: stringOf(row.locale) || undefined,
      title: stringOf(row.title) || undefined,
      created: row.created === true,
    }));
  }

  async list(
    conversationId: string
  ): Promise<
    Array<{ collection: string; id: string; op?: string; locale?: string; updatedAt?: string }>
  > {
    if (!conversationId) return [];
    const res = await this.db.query(
      `SELECT collection, doc_id, op, locale, updated_at FROM ${t("ca_changesets")}
       WHERE conversation_id = $1 AND trim(doc_id) <> '' ORDER BY updated_at DESC`,
      [conversationId]
    );

    return res.rows.map(rowOf).map((row) => ({
      collection: stringOf(row.collection) ?? "",
      id: stringOf(row.doc_id) ?? "",
      op: stringOf(row.op),
      locale: stringOf(row.locale) || undefined,
      updatedAt:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : stringOf(row.updated_at),
    }));
  }
}
