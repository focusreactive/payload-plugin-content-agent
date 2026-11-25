import { t } from "../database.js";
import type { DatabasePool } from "../database.js";
import { dateOf, rowOf, numberOf, stringOf } from "./rows.js";

export interface ChatRating {
  conversationId: string;
  userId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
}

export class ChatRatingStorage {
  private db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  // A resubmit returns the original rating: a rating is immutable once given.
  async submit(
    conversationId: string,
    userId: string,
    rating: number,
    comment?: string
  ): Promise<ChatRating> {
    const { rows } = await this.db.query(
      `INSERT INTO ${t("ca_chat_ratings")} (conversation_id, user_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversation_id) DO NOTHING
       RETURNING *`,
      [conversationId, userId, rating, comment?.trim() || null]
    );
    const row = rows[0] ?? (await this.getRow(conversationId));

    return this.mapRow(row);
  }

  async get(conversationId: string): Promise<ChatRating | null> {
    const row = await this.getRow(conversationId);

    return row ? this.mapRow(row) : null;
  }

  private async getRow(conversationId: string): Promise<unknown> {
    const { rows } = await this.db.query(
      `SELECT * FROM ${t("ca_chat_ratings")} WHERE conversation_id = $1`,
      [conversationId]
    );

    return rows[0];
  }

  private mapRow(value: unknown): ChatRating {
    const row = rowOf(value);

    return {
      conversationId: stringOf(row.conversation_id) ?? "",
      userId: stringOf(row.user_id) ?? "",
      rating: numberOf(row.rating) ?? 0,
      comment: stringOf(row.comment) ?? null,
      createdAt: dateOf(row.created_at),
    };
  }
}
