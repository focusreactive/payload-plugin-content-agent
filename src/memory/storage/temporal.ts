import { monotonicFactory } from "ulid";
import { t } from "../database.js";
import type { DatabasePool } from "../database.js";
import { estimateTokens } from "../tokenUtils.js";
import { dateOf, numberOf, rowOf, stringOf } from "./rows.js";
import { textMatch, textRank } from "./textMatch.js";

// Monotonic: everything here sorts by id, and plain ulid() does not keep insertion order
// within one millisecond.
const ulid = monotonicFactory();

export type MessageType = "user" | "assistant" | "tool_call" | "tool_result";

const isMessageType = (value: unknown): value is MessageType =>
  value === "user" || value === "assistant" || value === "tool_call" || value === "tool_result";

export interface TemporalMessage {
  id: string;
  conversationId: string;
  type: MessageType;
  content: string;
  tokenEstimate: number;
  createdAt: Date;
  parts?: unknown[] | null;
}

export interface TemporalSummary {
  id: string;
  conversationId: string;
  orderNum: number;
  startId: string;
  endId: string;
  narrative: string;
  keyObservations: string[];
  tags: string[];
  tokenEstimate: number;
  createdAt: Date;
}

function safeJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export class TemporalStorage {
  private db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  async addMessage(
    conversationId: string,
    type: MessageType,
    content: string,
    parts?: unknown[]
  ): Promise<TemporalMessage> {
    const id = ulid();
    const tokenEstimate = estimateTokens(content);
    const { rows } = await this.db.query(
      `INSERT INTO ${t("ca_temporal_messages")} (id, conversation_id, type, content, token_estimate, parts)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        id,
        conversationId,
        type,
        content,
        tokenEstimate,
        parts?.length ? JSON.stringify(parts) : null,
      ]
    );

    return this.mapMessage(rows[0]);
  }

  async getMessages(conversationId: string): Promise<TemporalMessage[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM ${t("ca_temporal_messages")}
       WHERE conversation_id = $1
       ORDER BY id ASC`,
      [conversationId]
    );

    return rows.map(this.mapMessage);
  }

  async searchAllMessages(
    userId: string,
    query: string,
    limit = 20
  ): Promise<(TemporalMessage & { userId: string })[]> {
    const { rows } = await this.db.query(
      `SELECT m.*, c.user_id FROM ${t("ca_temporal_messages")} m
       JOIN ${t("ca_conversations")} c ON c.id = m.conversation_id
       WHERE c.user_id = $1 AND ${textMatch(query, "m.tsv", "m.content", "$2")}
       ORDER BY ${textRank("m.tsv", "$2")} DESC
       LIMIT $3`,
      [userId, query, limit]
    );

    return rows.map((row: unknown) => ({
      ...this.mapMessage(row),
      userId: stringOf(rowOf(row).user_id) ?? "",
    }));
  }

  async addSummary(params: {
    conversationId: string;
    orderNum: number;
    startId: string;
    endId: string;
    narrative: string;
    keyObservations: string[];
    tags?: string[];
  }): Promise<TemporalSummary> {
    const id = ulid();
    const tokenEstimate = estimateTokens([params.narrative, ...params.keyObservations].join("\n"));
    const { rows } = await this.db.query(
      `INSERT INTO ${t("ca_temporal_summaries")}
       (id, conversation_id, order_num, start_id, end_id, narrative, key_observations, tags, token_estimate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        id,
        params.conversationId,
        params.orderNum,
        params.startId,
        params.endId,
        params.narrative,
        JSON.stringify(params.keyObservations),
        JSON.stringify(params.tags ?? []),
        tokenEstimate,
      ]
    );

    return this.mapSummary(rows[0]);
  }

  /** Writes a newer text over a summary of the same conversation; the caller embeds it again. */
  async replaceSummary(
    id: string,
    params: {
      startId: string;
      endId: string;
      narrative: string;
      keyObservations: string[];
      tags?: string[];
    }
  ): Promise<TemporalSummary> {
    const tokenEstimate = estimateTokens([params.narrative, ...params.keyObservations].join("\n"));
    const { rows } = await this.db.query(
      `UPDATE ${t("ca_temporal_summaries")}
       SET start_id = $2, end_id = $3, narrative = $4, key_observations = $5, tags = $6, token_estimate = $7
       WHERE id = $1 RETURNING *`,
      [
        id,
        params.startId,
        params.endId,
        params.narrative,
        JSON.stringify(params.keyObservations),
        JSON.stringify(params.tags ?? []),
        tokenEstimate,
      ]
    );

    return this.mapSummary(rows[0]);
  }

  async getSummaries(conversationId: string): Promise<TemporalSummary[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM ${t("ca_temporal_summaries")}
       WHERE conversation_id = $1
       ORDER BY order_num ASC, id ASC`,
      [conversationId]
    );

    return rows.map(this.mapSummary);
  }

  async getMaxOrderNum(conversationId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COALESCE(MAX(order_num), 0) as max_order
       FROM ${t("ca_temporal_summaries")} WHERE conversation_id = $1`,
      [conversationId]
    );

    return numberOf(rowOf(rows[0]).max_order) ?? 0;
  }

  private mapMessage(value: unknown): TemporalMessage {
    const row = rowOf(value);

    return {
      id: stringOf(row.id) ?? "",
      conversationId: stringOf(row.conversation_id) ?? "",
      type: isMessageType(row.type) ? row.type : "assistant",
      content: stringOf(row.content) ?? "",
      tokenEstimate: numberOf(row.token_estimate) ?? 0,
      createdAt: dateOf(row.created_at),
      parts: Array.isArray(row.parts) ? row.parts : null,
    };
  }

  private mapSummary(value: unknown): TemporalSummary {
    const row = rowOf(value);

    return {
      id: stringOf(row.id) ?? "",
      conversationId: stringOf(row.conversation_id) ?? "",
      orderNum: numberOf(row.order_num) ?? 0,
      startId: stringOf(row.start_id) ?? "",
      endId: stringOf(row.end_id) ?? "",
      narrative: stringOf(row.narrative) ?? "",
      keyObservations: safeJsonArray(stringOf(row.key_observations)),
      tags: safeJsonArray(stringOf(row.tags)),
      tokenEstimate: numberOf(row.token_estimate) ?? 0,
      createdAt: dateOf(row.created_at),
    };
  }
}
