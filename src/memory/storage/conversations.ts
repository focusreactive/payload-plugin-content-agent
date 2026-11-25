import { t } from "../database.js";
import type { DatabasePool } from "../database.js";
import { dateOf, rowOf, stringOf } from "./rows.js";

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ConversationStorage {
  private db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  async findById(id: string): Promise<Conversation | null> {
    const { rows } = await this.db.query(`SELECT * FROM ${t("ca_conversations")} WHERE id = $1`, [
      id,
    ]);

    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async findOrCreate(id: string, userId: string): Promise<Conversation> {
    const existing = await this.findById(id);

    if (existing) return existing;

    const { rows } = await this.db.query(
      `INSERT INTO ${t("ca_conversations")} (id, user_id)
       VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING *`,
      [id, userId]
    );

    if (rows[0]) return this.mapRow(rows[0]);

    return (await this.findById(id))!;
  }

  async listForUser(
    userId: string,
    limit = 50,
    cursor?: string
  ): Promise<{ conversations: Conversation[]; nextCursor: string | null }> {
    const params: unknown[] = [userId, limit + 1];
    let cursorClause = "";

    // The cursor has millisecond precision, so ORDER BY and the comparison truncate updated_at
    // to milliseconds; otherwise rows that share the boundary millisecond are skipped.
    if (cursor) {
      const [timestamp, id] = cursor.split("|");

      cursorClause = `AND (date_trunc('milliseconds', updated_at), id) < ($3::timestamptz, $4::uuid)`;
      params.push(timestamp, id);
    }

    const { rows } = await this.db.query(
      `SELECT * FROM ${t("ca_conversations")}
       WHERE user_id = $1 ${cursorClause}
       ORDER BY date_trunc('milliseconds', updated_at) DESC, id DESC
       LIMIT $2`,
      params
    );
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(this.mapRow);
    const last = items[items.length - 1];
    const nextCursor = hasMore ? `${last.updatedAt.toISOString()}|${last.id}` : null;

    return { conversations: items, nextCursor };
  }

  async updateTitle(id: string, title: string): Promise<void> {
    await this.db.query(
      `UPDATE ${t("ca_conversations")} SET title = $1, updated_at = now() WHERE id = $2`,
      [title, id]
    );
  }

  async touch(id: string): Promise<void> {
    await this.db.query(`UPDATE ${t("ca_conversations")} SET updated_at = now() WHERE id = $1`, [
      id,
    ]);
  }

  private mapRow(value: unknown): Conversation {
    const row = rowOf(value);

    return {
      id: stringOf(row.id) ?? "",
      userId: stringOf(row.user_id) ?? "",
      title: stringOf(row.title) ?? null,
      createdAt: dateOf(row.created_at),
      updatedAt: dateOf(row.updated_at),
    };
  }
}
