import { isDocId, isRecord } from "../../borders.js";
import { t } from "../database.js";
import type { DatabasePool } from "../database.js";

export interface PendingBulk {
  ids: (string | number)[];
  instruction: string;
  locale?: string;
  to?: string;
  from?: string;
  modelDocument?: string;
  at: number;
}

const isOptionalText = (value: unknown) => value === undefined || typeof value === "string";

const isPendingBulk = (value: unknown): value is PendingBulk =>
  isRecord(value) &&
  Array.isArray(value.ids) &&
  value.ids.every(isDocId) &&
  typeof value.instruction === "string" &&
  typeof value.at === "number" &&
  isOptionalText(value.locale) &&
  isOptionalText(value.to) &&
  isOptionalText(value.from) &&
  isOptionalText(value.modelDocument);

export const PENDING_BULK_TTL_MS = 24 * 60 * 60 * 1000;

export class PendingBulkStorage {
  private db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  async get(conversationId: string, tool: string, collection: string): Promise<PendingBulk | null> {
    const { rows } = await this.db.query(
      `SELECT state FROM ${t("ca_pending_bulk")}
       WHERE conversation_id = $1 AND tool = $2 AND collection = $3
         AND updated_at > now() - ($4::int * interval '1 millisecond')`,
      [conversationId, tool, collection, PENDING_BULK_TTL_MS]
    );

    const state: unknown = rows[0]?.state;

    return isPendingBulk(state) ? state : null;
  }

  async set(
    conversationId: string,
    tool: string,
    collection: string,
    value: PendingBulk | null
  ): Promise<void> {
    if (!value) {
      await this.db.query(
        `DELETE FROM ${t("ca_pending_bulk")} WHERE conversation_id = $1 AND tool = $2 AND collection = $3`,
        [conversationId, tool, collection]
      );

      return;
    }

    await this.db.query(
      `INSERT INTO ${t("ca_pending_bulk")} (conversation_id, tool, collection, state, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (conversation_id, tool, collection)
       DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [conversationId, tool, collection, JSON.stringify(value)]
    );
  }
}
