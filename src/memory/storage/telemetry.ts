import { ulid } from "ulid";
import { t } from "../database.js";
import type { DatabasePool } from "../database.js";

export interface TelemetryEvent {
  id?: string;
  conversationId: string;
  agentId: string;
  stepNumber?: number | null;
  eventType: string;
  toolName?: string | null;
  durationMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  success?: boolean | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class TelemetryStorage {
  /** Whether a tool call row keeps the input and the start of the result: content of the site. */
  keepsContent = false;

  private db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  async record(event: TelemetryEvent): Promise<void> {
    const id = event.id ?? ulid();

    await this.db.query(
      `INSERT INTO ${t("ca_agent_telemetry")} (id, conversation_id, agent_id, step_number, event_type, tool_name, duration_ms, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, success, error, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        event.conversationId,
        event.agentId,
        event.stepNumber ?? null,
        event.eventType,
        event.toolName ?? null,
        event.durationMs ?? null,
        event.inputTokens ?? null,
        event.outputTokens ?? null,
        event.cacheReadTokens ?? null,
        event.cacheWriteTokens ?? null,
        event.success ?? true,
        event.error ?? null,
        JSON.stringify(event.metadata ?? {}),
      ]
    );
  }
}

export interface PruneResult {
  telemetry: number;
  backgroundReports: number;
  workers: number;
}

export async function pruneOldTelemetry(
  db: DatabasePool,
  olderThanDays = 90
): Promise<PruneResult> {
  const { rowCount: telemetry } = await db.query(
    `DELETE FROM ${t("ca_agent_telemetry")} WHERE created_at < now() - make_interval(days => $1)`,
    [olderThanDays]
  );
  const { rowCount: backgroundReports } = await db.query(
    `DELETE FROM ${t("ca_background_reports")} WHERE created_at < now() - make_interval(days => $1)`,
    [olderThanDays]
  );
  const { rowCount: workers } = await db.query(
    `DELETE FROM ${t("ca_workers")} WHERE started_at < now() - make_interval(days => $1)`,
    [olderThanDays]
  );

  return {
    telemetry: telemetry ?? 0,
    backgroundReports: backgroundReports ?? 0,
    workers: workers ?? 0,
  };
}
