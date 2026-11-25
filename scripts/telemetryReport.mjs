#!/usr/bin/env node
//   node scripts/telemetryReport.mjs <database url> [--since 2026-11-01] [--prices prices.json] [--json]
//
// The database url is the one the plugin gets as `memoryDatabaseUrl` (also read from
// CONTENT_AGENT_DATABASE_URL). The script only reads. The price file gives the price of a
// million tokens per model id: { "<model id>": { "input": 2, "cachedInput": 0.2, "output": 8 } }.
import { readFileSync } from "node:fs";
import pg from "pg";
import { report } from "./lib/telemetryQueries.mjs";

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const url =
  args.find((a) => /^postgres(ql)?:\/\//u.test(a)) ?? process.env.CONTENT_AGENT_DATABASE_URL;

if (!url) {
  console.error(
    "Usage: node scripts/telemetryReport.mjs <database url> [--since YYYY-MM-DD] [--prices prices.json] [--json]"
  );
  process.exit(1);
}

const pricesFile = flag("--prices");
const prices = pricesFile ? JSON.parse(readFileSync(pricesFile, "utf-8")) : null;
const db = new pg.Client({ connectionString: url });

await db.connect();

try {
  const sections = await report(db, flag("--since"), prices);

  if (args.includes("--json")) console.log(JSON.stringify(sections, null, 2));
  else {
    for (const [title, rows] of Object.entries(sections)) {
      console.log(`\n## ${title}`);
      if (rows.length) console.table(rows);
      else console.log("(no rows)");
    }
  }
} finally {
  await db.end();
}
