import { embed, embedMany } from "ai";
import type { EmbeddingModel } from "ai";
import { embeddingTimeLimit } from "../modelCallTimeout.js";
import { t } from "./database.js";
import type { DatabasePool } from "./database.js";
import { rowOf, stringOf } from "./storage/rows.js";
import { textMatch, textRank } from "./storage/textMatch.js";
import { SHARED_USER_ID } from "./storage/ltm.js";

function pgVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export class EmbeddingService {
  private readonly vecType: string;
  private readonly cosOp: string;
  private db: DatabasePool;
  private model: EmbeddingModel;

  constructor(db: DatabasePool, model: EmbeddingModel, vectorSchema = "public") {
    this.db = db;
    this.model = model;
    // Type and operator are schema-qualified so vector queries do not depend on search_path,
    // which a transaction-mode pooler does not preserve.
    this.vecType = `${vectorSchema}.vector`;
    this.cosOp = `OPERATOR(${vectorSchema}.<=>)`;
  }

  async embedText(text: string): Promise<number[]> {
    const { embedding } = await embed({ model: this.model, value: text, ...embeddingTimeLimit() });

    return embedding;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const { embeddings } = await embedMany({
      model: this.model,
      values: texts,
      ...embeddingTimeLimit(),
    });

    return embeddings;
  }

  async embedLtmEntry(userId: string, slug: string, text: string): Promise<void> {
    const vector = await this.embedText(text);

    await this.db.query(
      `UPDATE ${t("ca_ltm_entries")} SET embedding = $1::${this.vecType} WHERE user_id = $2 AND slug = $3`,
      [pgVector(vector), userId, slug]
    );
  }

  async embedSummary(summaryId: string, narrative: string): Promise<void> {
    const vector = await this.embedText(narrative);

    await this.db.query(
      `UPDATE ${t("ca_temporal_summaries")} SET embedding = $1::${this.vecType} WHERE id = $2`,
      [pgVector(vector), summaryId]
    );
  }

  async searchSummaries(
    userId: string,
    query: string,
    limit = 10
  ): Promise<
    Array<{
      id: string;
      conversationId: string;
      narrative: string;
      keyObservations: string[];
      score: number;
    }>
  > {
    const queryVector = await this.embedText(query);

    const { rows } = await this.db.query(
      `WITH fts AS (
        SELECT s.id, s.conversation_id, s.narrative, s.key_observations,
               ROW_NUMBER() OVER (ORDER BY ${textRank("s.tsv", "$2")} DESC) as fts_rank
        FROM ${t("ca_temporal_summaries")} s
        JOIN ${t("ca_conversations")} c ON c.id = s.conversation_id
        WHERE c.user_id = $1 AND ${textMatch(query, "s.tsv", "s.narrative", "$2")}
        ORDER BY ${textRank("s.tsv", "$2")} DESC
        LIMIT 30
      ),
      vec AS (
        SELECT s.id, s.conversation_id, s.narrative, s.key_observations,
               ROW_NUMBER() OVER (ORDER BY s.embedding ${this.cosOp} $3::${this.vecType}) as vec_rank
        FROM ${t("ca_temporal_summaries")} s
        JOIN ${t("ca_conversations")} c ON c.id = s.conversation_id
        WHERE c.user_id = $1 AND s.embedding IS NOT NULL
        ORDER BY s.embedding ${this.cosOp} $3::${this.vecType}
        LIMIT 30
      ),
      combined AS (
        SELECT COALESCE(f.id, v.id) as id,
               COALESCE(f.conversation_id, v.conversation_id) as conversation_id,
               COALESCE(f.narrative, v.narrative) as narrative,
               COALESCE(f.key_observations, v.key_observations) as key_observations,
               COALESCE(1.0 / (60 + f.fts_rank), 0) + COALESCE(1.0 / (60 + v.vec_rank), 0) as rrf_score
        FROM fts f
        FULL OUTER JOIN vec v ON f.id = v.id
      )
      SELECT * FROM combined ORDER BY rrf_score DESC LIMIT $4`,
      [userId, query, pgVector(queryVector), limit]
    );

    return rows.map(rowOf).map((row) => ({
      id: stringOf(row.id) ?? "",
      conversationId: stringOf(row.conversation_id) ?? "",
      narrative: stringOf(row.narrative) ?? "",
      keyObservations: (() => {
        try {
          const parsed = JSON.parse(String(row.key_observations));

          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })(),
      score: Number(row.rrf_score),
    }));
  }

  async hybridSearchLtm(
    userId: string,
    query: string,
    limit = 10
  ): Promise<
    Array<{
      slug: string;
      userId: string;
      path: string;
      title: string;
      body: string;
      score: number;
      createdBy: string;
      updatedBy: string;
      updatedAt: Date | null;
    }>
  > {
    const queryVector = await this.embedText(query);

    const { rows } = await this.db.query(
      `WITH fts AS (
        SELECT slug, user_id, path, title, body, created_by, updated_by, updated_at,
               ROW_NUMBER() OVER (ORDER BY ${textRank("tsv", "$3")} DESC) as fts_rank
        FROM ${t("ca_ltm_entries")}
        WHERE (user_id = $1 OR user_id = $2) AND archived_at IS NULL
          AND ${textMatch(query, "tsv", "title || ' ' || body", "$3")}
        ORDER BY ${textRank("tsv", "$3")} DESC
        LIMIT 30
      ),
      vec AS (
        SELECT slug, user_id, path, title, body, created_by, updated_by, updated_at,
               ROW_NUMBER() OVER (ORDER BY embedding ${this.cosOp} $4::${this.vecType}) as vec_rank
        FROM ${t("ca_ltm_entries")}
        WHERE (user_id = $1 OR user_id = $2) AND archived_at IS NULL
          AND embedding IS NOT NULL
        ORDER BY embedding ${this.cosOp} $4::${this.vecType}
        LIMIT 30
      ),
      combined AS (
        SELECT COALESCE(f.slug, v.slug) as slug,
               COALESCE(f.user_id, v.user_id) as user_id,
               COALESCE(f.path, v.path) as path,
               COALESCE(f.title, v.title) as title,
               COALESCE(f.body, v.body) as body,
               COALESCE(f.created_by, v.created_by) as created_by,
               COALESCE(f.updated_by, v.updated_by) as updated_by,
               COALESCE(f.updated_at, v.updated_at) as updated_at,
               COALESCE(1.0 / (60 + f.fts_rank), 0) + COALESCE(1.0 / (60 + v.vec_rank), 0) as rrf_score
        FROM fts f
        FULL OUTER JOIN vec v ON f.slug = v.slug AND f.user_id = v.user_id
      )
      SELECT * FROM combined ORDER BY rrf_score DESC LIMIT $5`,
      [userId, SHARED_USER_ID, query, pgVector(queryVector), limit]
    );

    return rows.map(rowOf).map((row) => ({
      slug: stringOf(row.slug) ?? "",
      userId: stringOf(row.user_id) ?? "",
      path: stringOf(row.path) ?? "",
      title: stringOf(row.title) ?? "",
      body: stringOf(row.body) ?? "",
      score: Number(row.rrf_score),
      createdBy: stringOf(row.created_by) ?? "",
      updatedBy: stringOf(row.updated_by) ?? "",
      updatedAt: row.updated_at instanceof Date ? row.updated_at : null,
    }));
  }

  async backfillLtm(batchSize = 50): Promise<number> {
    let total = 0;

    while (true) {
      const result = await this.db.query(
        `SELECT user_id, slug, title, body FROM ${t("ca_ltm_entries")}
         WHERE embedding IS NULL AND archived_at IS NULL
         ORDER BY slug ASC LIMIT $1`,
        [batchSize]
      );
      const rows = result.rows.map(rowOf);

      if (rows.length === 0) break;

      const texts = rows.map((row) => `${row.title}\n${row.body}`);
      const vectors = await this.embedTexts(texts);

      for (let i = 0; i < rows.length; i++) {
        await this.db.query(
          `UPDATE ${t("ca_ltm_entries")} SET embedding = $1::${this.vecType} WHERE user_id = $2 AND slug = $3`,
          [pgVector(vectors[i]), rows[i].user_id, rows[i].slug]
        );
      }

      total += rows.length;
    }

    return total;
  }

  async backfillSummaries(batchSize = 50): Promise<number> {
    let total = 0;

    while (true) {
      const result = await this.db.query(
        `SELECT id, narrative FROM ${t("ca_temporal_summaries")}
         WHERE embedding IS NULL
         ORDER BY id ASC LIMIT $1`,
        [batchSize]
      );
      const rows = result.rows.map(rowOf);

      if (rows.length === 0) break;

      const vectors = await this.embedTexts(rows.map((row) => stringOf(row.narrative) ?? ""));

      for (let i = 0; i < rows.length; i++) {
        await this.db.query(
          `UPDATE ${t("ca_temporal_summaries")} SET embedding = $1::${this.vecType} WHERE id = $2`,
          [pgVector(vectors[i]), rows[i].id]
        );
      }

      total += rows.length;
    }

    return total;
  }
}
