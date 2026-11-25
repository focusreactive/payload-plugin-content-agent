#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { createClient } from "./lib/client.mjs";
import { conversationMetrics, waitForRun } from "../scripts/lib/telemetryQueries.mjs";
import { createOutsideAgent } from "./lib/outsideAgent.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The report holds what a run needs; the provider notes about tool schemas repeat on every step.
globalThis.AI_SDK_LOG_WARNINGS = false;
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const schema = opt("--schema", "blog");
const k = Number(opt("--k", "3"));
const only = opt("--only", "")?.split(",").filter(Boolean);
const maxInputTokens = Number(opt("--max-input-tokens", "20000000"));
const pricesFile = opt("--prices", null);
const prices = pricesFile ? JSON.parse(readFileSync(pricesFile, "utf-8")) : null;
const agentKind = opt("--agent", "chat");
const outsideModel = opt("--outside-model", null);
const outsideProvider = opt("--outside-provider", "openai");
const envFile = opt("--env-file", null);
const apiKeyVar = opt(
  "--api-key-var",
  outsideProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"
);
const stateDir = path.resolve(opt("--state-dir", path.join(HERE, "..", "lab", ".state", schema)));
const scenariosOption = opt("--scenarios", null);
const read = (file) => JSON.parse(readFileSync(path.join(stateDir, file), "utf-8"));

if (!existsSync(path.join(stateDir, "host.json"))) {
  console.error(
    `No host.json in ${stateDir}. Start the lab host: node lab/start.mjs --schema ${schema}, or pass --state-dir <folder with host.json and seed.json>.`
  );
  process.exit(1);
}

const host = read("host.json");
const seed = read("seed.json");
const runModel = agentKind === "outside" ? outsideModel : host.model;
const label = opt(
  "--label",
  `${schema}-${runModel}-${new Date().toISOString().slice(0, 16).replace(/[:T]/gu, "")}`
);

async function openOutsideAgent() {
  if (!outsideModel) {
    console.error("An outside agent needs a model: --outside-model <id>");
    process.exit(1);
  }

  if (envFile) process.loadEnvFile(path.resolve(envFile));

  if (!process.env[apiKeyVar]) {
    console.error(`No key in ${apiKeyVar}. Pass --env-file <path> or --api-key-var <NAME>.`);
    process.exit(1);
  }

  return createOutsideAgent({
    base: host.base,
    mcpKey: process.env.LAB_MCP_API_KEY || "lab-mcp-key-0000-0000",
    provider: outsideProvider,
    modelId: outsideModel,
    apiKey: process.env[apiKeyVar],
  });
}

const outside = agentKind === "outside" ? await openOutsideAgent() : null;

const api = createClient(host.base);

await api.login(seed.user.email, seed.user.password);
const db = new pg.Client({ connectionString: host.databaseUrl });

await db.connect();

const snapshotFile = path.join(stateDir, "snapshots.json");
const isGlobal = (name) => name.startsWith("global:");
const fetchNamed = (name, locale, options) =>
  isGlobal(name)
    ? api.getGlobal(name.slice(7), locale, options)
    : api.getDoc(seed.documents[name].collection, seed.documents[name].id, locale, options);
// Every locale but the default one is kept and restored on its own: a run can write any locale.
const otherLocales = seed.localization
  ? seed.localization.locales.filter((locale) => locale !== seed.localization.defaultLocale)
  : [];
const localeKey = (name, locale) => `${name}#${locale}`;
// The live version is kept apart from the draft: a seed document can be published with a newer
// draft over it, and a restore must give back both.
const liveKey = (name, locale) => (locale ? `${name}@live#${locale}` : `${name}@live`);
const scenarioFile = scenariosOption
  ? path.resolve(scenariosOption)
  : path.join(HERE, "scenarios", outside ? `${schema}.outside.mjs` : `${schema}.mjs`);

if (!existsSync(scenarioFile)) {
  console.error(`No scenario file ${scenarioFile}. Pass --scenarios <file>.`);
  process.exit(1);
}

const allScenarios = (await import(pathToFileURL(scenarioFile))).default;
const scenarios = only?.length ? allScenarios.filter((s) => only.includes(s.id)) : allScenarios;
const snapshots = existsSync(snapshotFile) ? JSON.parse(readFileSync(snapshotFile, "utf-8")) : {};

for (const name of new Set(allScenarios.flatMap((s) => s.uses))) {
  if (!snapshots[name]) snapshots[name] = await fetchNamed(name);
  // A restore saves only drafts, so the live version on the host is still the seeded one.
  if (!snapshots[liveKey(name)])
    snapshots[liveKey(name)] = await fetchNamed(name, undefined, { draft: false });

  for (const locale of otherLocales) {
    const key = localeKey(name, locale);
    const live = liveKey(name, locale);

    if (!snapshots[key]) snapshots[key] = await fetchNamed(name, locale, { fallback: false });
    if (!snapshots[live])
      snapshots[live] = await fetchNamed(name, locale, { fallback: false, draft: false });
  }
}

writeFileSync(snapshotFile, JSON.stringify(snapshots, null, 1));

const content = ({
  id: _id,
  createdAt: _createdAt,
  updatedAt: _updatedAt,
  _status,
  globalType: _globalType,
  ...rest
}) => rest;

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// A read without the fallback leaves out a field that has no value in the locale. Sent as null,
// the field is emptied again when a run wrote it. A rich text value is one value.
function withEmptyFields(value, full) {
  if (value === undefined) return null;
  if (isPlain(full) && isPlain(value) && !("root" in value))
    return {
      ...Object.fromEntries(Object.keys(full).map((key) => [key, null])),
      ...Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, withEmptyFields(child, full[key])])
      ),
    };
  if (Array.isArray(full) && Array.isArray(value))
    return value.map((row) =>
      withEmptyFields(
        row,
        full.find((other) => isPlain(other) && isPlain(row) && other.id === row.id)
      )
    );

  return value;
}

const isPublished = (snapshot) => snapshot?._status === "published";

// A published seed document is published again from its live version, and gets its draft back
// over it only when the seed had one. A save of a draft alone would leave every used document
// as a draft over its live version.
async function restore(name) {
  const draftOf = (locale) => (locale ? snapshots[localeKey(name, locale)] : snapshots[name]);
  const liveOf = (locale) => snapshots[liveKey(name, locale)];

  if (!isPublished(liveOf())) {
    await saveVersion(name, draftOf);

    return;
  }

  const live = content(liveOf());

  // Only the default locale is published. A publish checks the required fields of its locale,
  // and a locale without a translation has them empty. A publish takes the other locales from
  // the latest version, so they are saved as drafts first; the first publish brings back a
  // document that a run deleted.
  await saveLocale(name, live, undefined, true);

  if (otherLocales.length) {
    await saveOtherLocales(name, liveOf, live);
    await saveLocale(name, live, undefined, true);
  }

  if (!isPublished(snapshots[name])) await saveVersion(name, draftOf);
}

async function saveVersion(name, snapshotOf) {
  const base = content(snapshotOf());

  await saveLocale(name, base, undefined, false);
  await saveOtherLocales(name, snapshotOf, base);
}

async function saveOtherLocales(name, snapshotOf, base) {
  for (const locale of otherLocales) {
    const snapshot = snapshotOf(locale);

    if (snapshot) await saveLocale(name, withEmptyFields(content(snapshot), base), locale, false);
  }
}

async function saveLocale(name, data, locale, publish) {
  const body = publish ? { ...data, _status: "published" } : data;
  const options = { draft: !publish };

  if (isGlobal(name)) {
    await api.patchGlobal(name.slice(7), body, locale, options);

    return;
  }

  const ref = seed.documents[name];

  try {
    await api.patchDoc(ref.collection, ref.id, body, locale, options);
  } catch (err) {
    if (locale || err.status !== 404) throw err;
    // A run deleted the document: create it again and remember the new id.
    const created = await api.req("POST", `/api/${ref.collection}?depth=0`, {
      ...data,
      _status: "published",
    });

    ref.id = created.doc.id;
    writeFileSync(path.join(stateDir, "seed.json"), JSON.stringify(seed, null, 2) + "\n");
  }
}

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);

  return s.length
    ? s.length % 2
      ? s[(s.length - 1) / 2]
      : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
    : 0;
};

const results = [];
let spentInput = 0;
let runIndex = Date.now() % 100000;

// A scenario that the token limit stopped before its k runs has no verdict: it is not counted as
// failed, and not as a regression.
const notRun = [];
let budgetSpent = false;

for (const scenario of scenarios) {
  const runs = [];

  for (let i = 1; i <= k && !budgetSpent; i++) {
    if (spentInput > maxInputTokens) {
      console.error(
        `\nStopped: ${spentInput} input tokens spent, the limit is ${maxInputTokens} (--max-input-tokens).`
      );
      budgetSpent = true;
      break;
    }

    let run;

    try {
      for (const name of scenario.uses) await restore(name);
      const ctx = {
        api,
        docs: seed.documents,
        faults: seed.faults,
        runIndex: runIndex++,
        read: (name, locale) => fetchNamed(name, locale),
        send: outside
          ? (prompt) => outside.send(prompt)
          : (prompt, options) => api.send(prompt, options),
        ...(outside ? { call: outside.call, endpointTools: outside.toolNames } : {}),
      };
      const { ok, details, turn, lines } = await scenario.run(ctx);
      const stored = turn && !outside ? await waitForRun(db, turn.conversationId) : false;
      const metrics = outside
        ? (turn?.metrics ?? null)
        : turn
          ? await conversationMetrics(db, turn.conversationId, prices)
          : null;

      run = {
        ok: Boolean(ok),
        details,
        ...(lines ? { lines } : {}),
        ...(turn?.calls ? { calls: turn.calls } : {}),
        conversationId: turn?.conversationId,
        tools: turn?.tools,
        ...(turn?.instructions?.length
          ? { instructions: turn.instructions.map((text) => text.slice(0, 1500)) }
          : {}),
        reply: turn?.text.slice(0, 1200),
        ...(turn?.shown?.length ? { shown: turn.shown.join(" | ").slice(0, 2000) } : {}),
        streamError: turn?.error,
        finishReason: turn?.finishReason,
        seconds: turn?.seconds,
        telemetryStored: stored,
        metrics,
      };
      spentInput += metrics?.inputTokens ?? 0;
    } catch (err) {
      run = { ok: false, harnessError: String(err?.stack ?? err).slice(0, 800) };
    }

    runs.push(run);
    const m = run.metrics;

    for (const line of run.lines ?? [])
      if (!line.ok) console.log(`      ${line.kind.toUpperCase()} failed: ${line.text}`);

    console.log(
      `${run.ok ? "PASS" : "FAIL"}  ${scenario.id} #${i}  ${run.seconds?.toFixed(0) ?? "-"}s  steps ${m?.steps ?? "-"}  in ${m?.inputTokens ?? "-"}  failed tools ${m?.failedToolCalls ?? "-"}${run.harnessError ? `  HARNESS: ${run.harnessError.split("\n")[0]}` : ""}`
    );
  }

  if (runs.length < k) notRun.push(scenario.id);
  if (!runs.length) continue;
  for (const name of scenario.uses) await restore(name).catch(() => undefined);
  const of = (pick) => runs.map((r) => pick(r)).filter((x) => x !== undefined && x !== null);

  results.push({
    id: scenario.id,
    title: scenario.title,
    passed: runs.filter((r) => r.ok).length,
    runs: runs.length,
    ...(runs.length < k ? { stopped: true } : {}),
    passK: runs.length === k && runs.every((r) => r.ok),
    median: {
      seconds: median(of((r) => r.seconds)),
      steps: median(of((r) => r.metrics?.steps)),
      inputTokens: median(of((r) => r.metrics?.inputTokens)),
      outputTokens: median(of((r) => r.metrics?.outputTokens)),
      cachedShare: median(of((r) => r.metrics?.cachedShare)),
      ...(prices ? { cost: median(of((r) => r.metrics?.cost)) } : {}),
    },
    toolCalls: of((r) => r.metrics?.toolCalls).reduce((a, b) => a + b, 0),
    failedToolCalls: of((r) => r.metrics?.failedToolCalls).reduce((a, b) => a + b, 0),
    runDetails: runs,
  });
}

await db.end();
await outside?.close();

const total = (pick) => results.reduce((n, r) => n + pick(r), 0);
const complete = results.filter((r) => !r.stopped);
const report = {
  label,
  schema,
  model: runModel,
  ...(outside ? { agent: "outside", endpointTools: outside.toolNames } : {}),
  k,
  date: new Date().toISOString(),
  summary: {
    scenarios: complete.length,
    passK: complete.filter((r) => r.passK).length,
    ...(notRun.length ? { notRun } : {}),
    runs: total((r) => r.runs),
    runsPassed: total((r) => r.passed),
    toolCalls: total((r) => r.toolCalls),
    failedToolCalls: total((r) => r.failedToolCalls),
    inputTokens: spentInput,
    ...(prices
      ? {
          cost: total((r) => r.runDetails.reduce((n, run) => n + (run.metrics?.cost ?? 0), 0)),
          unpricedModels: [
            ...new Set(
              results.flatMap((r) => r.runDetails.flatMap((run) => run.metrics?.unpriced ?? []))
            ),
          ],
        }
      : {}),
  },
  results,
};

mkdirSync(path.join(HERE, "results"), { recursive: true });
const outFile = path.join(HERE, "results", `${label}.json`);

writeFileSync(outFile, JSON.stringify(report, null, 1));

console.log(
  `\n${label}: ${report.summary.passK}/${report.summary.scenarios} scenarios pass all ${k} runs, ${report.summary.runsPassed}/${report.summary.runs} runs pass`
);
if (notRun.length)
  console.log(
    `Not run to the end, stopped by --max-input-tokens (${notRun.length}): ${notRun.join(", ")}`
  );
console.table(
  results.map((r) => ({
    scenario: r.id,
    pass: `${r.passed}/${r.runs}`,
    seconds: Math.round(r.median.seconds),
    steps: r.median.steps,
    input: Math.round(r.median.inputTokens),
    cached: `${Math.round(r.median.cachedShare * 100)}%`,
    ...(prices ? { cost: r.median.cost?.toFixed(4) ?? "-" } : {}),
    "failed tools": `${r.failedToolCalls}/${r.toolCalls}`,
  }))
);

if (prices) {
  const { cost, unpricedModels } = report.summary;

  console.log(
    `Cost of the session: ${cost.toFixed(2)}${unpricedModels.length ? `. No price for: ${unpricedModels.join(", ")}` : ""}`
  );
}

console.log(`Report: ${outFile}`);

const baselineFile = opt("--baseline", null);

if (baselineFile) {
  const base = JSON.parse(readFileSync(baselineFile, "utf-8"));
  const regressions = complete
    .filter((r) => base.results.find((b) => b.id === r.id)?.passK && !r.passK)
    .map((r) => r.id);

  console.log(
    regressions.length
      ? `REGRESSIONS against ${base.label}: ${regressions.join(", ")}`
      : `No regression against ${base.label}.`
  );
  if (regressions.length) process.exit(2);
}
