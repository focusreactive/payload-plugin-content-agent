import { describe, it, expect, vi } from "vitest";
import { pruneContentAgentData } from "../src/index.js";
import { pruneOldTelemetry } from "../src/memory/storage/telemetry.js";

describe("pruneContentAgentData", () => {
  it("refuses a missing URL or a bad number of days before it touches the database", async () => {
    await expect(pruneContentAgentData("")).rejects.toThrow(/memoryDatabaseUrl is required/u);

    for (const olderThanDays of [0, -5, 1.5, Number.NaN]) {
      await expect(
        pruneContentAgentData("postgres://unused/db", { olderThanDays })
      ).rejects.toThrow(/olderThanDays/u);
    }
  });
});

describe("pruneOldTelemetry", () => {
  it("deletes from the three tables with the given age and reports the counts", async () => {
    const counts = [4, 2, 1];
    const db = { query: vi.fn(async () => ({ rowCount: counts.shift() })) } as any;

    expect(await pruneOldTelemetry(db, 30)).toEqual({
      telemetry: 4,
      backgroundReports: 2,
      workers: 1,
    });
    const sql = db.query.mock.calls.map((c: any[]) => c[0]).join("\n");

    expect(sql).toMatch(/ca_agent_telemetry/u);
    expect(sql).toMatch(/ca_background_reports/u);
    expect(sql).toMatch(/ca_workers/u);
    expect(db.query.mock.calls.every((c: any[]) => c[1][0] === 30)).toBe(true);
  });
});
