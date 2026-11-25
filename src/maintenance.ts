import { getPool } from "./memory/database.js";
import { pruneOldTelemetry } from "./memory/storage/telemetry.js";
import type { PruneResult } from "./memory/storage/telemetry.js";

export type { PruneResult };

/**
 * Deletes telemetry, background reports and worker rows older than `olderThanDays` (default 90).
 * The plugin runs no scheduler: call this from your own cron job
 * with the plugin's `memoryDatabaseUrl`.
 *
 * @example
 * import { pruneContentAgentData } from '@focus-reactive/payload-plugin-content-agent'
 * await pruneContentAgentData(process.env.DATABASE_URL!, { olderThanDays: 30 })
 */
export async function pruneContentAgentData(
  memoryDatabaseUrl: string,
  { olderThanDays = 90 }: { olderThanDays?: number } = {}
): Promise<PruneResult> {
  if (!memoryDatabaseUrl) throw new Error("pruneContentAgentData: memoryDatabaseUrl is required");

  if (!Number.isInteger(olderThanDays) || olderThanDays < 1) {
    throw new Error(
      `pruneContentAgentData: olderThanDays must be a whole number of days, 1 or more (got ${olderThanDays})`
    );
  }

  return pruneOldTelemetry(getPool(memoryDatabaseUrl), olderThanDays);
}
