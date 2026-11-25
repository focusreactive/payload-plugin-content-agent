import { ulid } from "ulid";
import { isRecord } from "../../borders.js";
import { t } from "../database.js";
import type { DatabasePool } from "../database.js";
import { dateOf, nullableDateOf, rowOf, stringOf } from "./rows.js";

const isWorkerStatus = (value: unknown): value is Worker["status"] =>
  value === "running" || value === "completed" || value === "failed";

export interface BackgroundReport {
  id: string;
  conversationId: string;
  subsystem: string;
  report: Record<string, unknown>;
  surfacedAt: Date | null;
  createdAt: Date;
}

export interface Worker {
  id: string;
  conversationId: string | null;
  type: string;
  status: "running" | "completed" | "failed";
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

export class BackgroundReportStorage {
  private db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  async addReport(
    conversationId: string,
    subsystem: string,
    report: Record<string, unknown>
  ): Promise<BackgroundReport> {
    const id = ulid();
    const { rows } = await this.db.query(
      `INSERT INTO ${t("ca_background_reports")} (id, conversation_id, subsystem, report)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, conversationId, subsystem, JSON.stringify(report)]
    );

    return this.mapReport(rows[0]);
  }

  async getUnsurfaced(conversationId: string): Promise<BackgroundReport[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM ${t("ca_background_reports")}
       WHERE conversation_id = $1 AND surfaced_at IS NULL
       ORDER BY created_at ASC`,
      [conversationId]
    );

    return rows.map(this.mapReport);
  }

  async markSurfaced(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.query(
      `UPDATE ${t("ca_background_reports")}
       SET surfaced_at = now()
       WHERE id = ANY($1)`,
      [ids]
    );
  }

  async startWorkerIfNotRunning(
    type: string,
    conversationId?: string,
    staleMinutes = 10
  ): Promise<Worker | null> {
    await this.db.query(
      `UPDATE ${t("ca_workers")} SET status = 'failed', error = 'stale - expired by the next run', completed_at = now()
       WHERE type = $1 AND status = 'running'
         AND ($2::uuid IS NULL OR conversation_id = $2::uuid)
         AND started_at <= now() - make_interval(mins => $3)`,
      [type, conversationId ?? null, staleMinutes]
    );
    const id = ulid();
    // ON CONFLICT relies on the partial unique indexes on running workers: under READ COMMITTED
    // two concurrent transactions can both pass NOT EXISTS.
    const { rows } = await this.db.query(
      `INSERT INTO ${t("ca_workers")} (id, conversation_id, type, status, started_at)
       SELECT $1, $2, $3, 'running', now()
       WHERE NOT EXISTS (
         SELECT 1 FROM ${t("ca_workers")}
         WHERE type = $3 AND status = 'running'
           AND ($2::uuid IS NULL OR conversation_id = $2::uuid)
       )
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [id, conversationId ?? null, type]
    );

    return rows[0] ? this.mapWorker(rows[0]) : null;
  }

  async getLastCompletedWorker(type: string): Promise<Worker | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM ${t("ca_workers")}
       WHERE type = $1 AND status = 'completed'
       ORDER BY completed_at DESC NULLS LAST
       LIMIT 1`,
      [type]
    );

    return rows[0] ? this.mapWorker(rows[0]) : null;
  }

  async completeWorker(id: string): Promise<void> {
    await this.db.query(
      `UPDATE ${t("ca_workers")} SET status = 'completed', completed_at = now()
       WHERE id = $1`,
      [id]
    );
  }

  async failWorker(id: string, error: string): Promise<void> {
    await this.db.query(
      `UPDATE ${t("ca_workers")} SET status = 'failed', completed_at = now(), error = $2
       WHERE id = $1`,
      [id, error]
    );
  }

  private mapReport(value: unknown): BackgroundReport {
    const row = rowOf(value);
    const report: unknown = typeof row.report === "string" ? JSON.parse(row.report) : row.report;

    return {
      id: stringOf(row.id) ?? "",
      conversationId: stringOf(row.conversation_id) ?? "",
      subsystem: stringOf(row.subsystem) ?? "",
      report: isRecord(report) ? report : {},
      surfacedAt: nullableDateOf(row.surfaced_at),
      createdAt: dateOf(row.created_at),
    };
  }

  private mapWorker(value: unknown): Worker {
    const row = rowOf(value);

    return {
      id: stringOf(row.id) ?? "",
      conversationId: stringOf(row.conversation_id) ?? null,
      type: stringOf(row.type) ?? "",
      status: isWorkerStatus(row.status) ? row.status : "failed",
      startedAt: nullableDateOf(row.started_at),
      completedAt: nullableDateOf(row.completed_at),
      error: stringOf(row.error) ?? null,
    };
  }
}
