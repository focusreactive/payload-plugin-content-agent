#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const LAB = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(LAB);
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const has = (name) => args.includes(name);

const schema = opt("--schema", "blog");
const port = opt(
  "--port",
  { blog: "3100", docs: "3101", shop: "3102", agency: "3103" }[schema] ?? "3100"
);
const model = opt("--model", "openai");
const envFile = opt("--env-file", null);

if (envFile) process.loadEnvFile(path.resolve(envFile));

const adminUrl = new URL(process.env.LAB_POSTGRES_URL || "postgres://localhost:5432/postgres");
const dbName = `ca_lab_${schema}`;
const dbUrl = new URL(adminUrl);

dbUrl.pathname = `/${dbName}`;

// Only LAB_* names reach the host config, so a DATABASE_URL in an env file is never used.
const env = {
  ...process.env,
  LAB_SCHEMA: schema,
  LAB_PORT: port,
  LAB_MODEL: model,
  LAB_DATABASE_URL: dbUrl.toString(),
  PORT: port,
};

delete env.NODE_ENV;
if (env.LAB_MODULES) env.LAB_MODULES = path.resolve(env.LAB_MODULES);
const keyVar = opt("--api-key-var", null);

if (keyVar) {
  if (!process.env[keyVar]) {
    console.error(`[lab] ${keyVar} is not set`);
    process.exit(1);
  }

  env.LAB_API_KEY = process.env[keyVar];
}

const stateDir = path.join(LAB, ".state", schema);

mkdirSync(stateDir, { recursive: true });
const run = (cmd, cmdArgs, extra = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: LAB, env, stdio: "inherit", ...extra });
const step = (text) => console.log(`\n[lab] ${text}`);

async function json(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const pidFile = path.join(stateDir, "server.pid");

if (existsSync(pidFile)) {
  try {
    process.kill(Number(readFileSync(pidFile, "utf-8")), "SIGTERM");
  } catch {}

  rmSync(pidFile);
  await new Promise((r) => setTimeout(r, 1500));
}

if (!existsSync(path.join(LAB, "node_modules", "next"))) {
  step("installing the host dependencies (first run)");
  run("npm", ["install", "--no-audit", "--no-fund"]);
}

if (
  !has("--skip-pack") ||
  !existsSync(path.join(LAB, "node_modules", "@focus-reactive", "payload-plugin-content-agent"))
) {
  step("building and packing the plugin");
  execFileSync("npm", ["run", "build"], { cwd: REPO, stdio: ["ignore", "ignore", "inherit"] });
  for (const f of readdirSync(LAB)) if (f.endsWith(".tgz")) rmSync(path.join(LAB, f));
  execFileSync("npm", ["pack", "--pack-destination", LAB], {
    cwd: REPO,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tgz = readdirSync(LAB).find((f) => f.endsWith(".tgz"));

  run("npm", ["install", "--no-save", "--no-audit", "--no-fund", `./${tgz}`]);
}

const admin = new pg.Client({ connectionString: adminUrl.toString() });

await admin.connect();

if (has("--fresh")) {
  step(`dropping ${dbName}`);
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  rmSync(path.join(stateDir, "seed.json"), { force: true });
  rmSync(path.join(stateDir, "snapshots.json"), { force: true });
}

const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);

if (!rows.length) await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();

// Not in production mode: Payload creates its tables.
step(`setting up ${dbName}`);
run("npx", ["payload", "generate:importmap"]);
run("npx", ["payload", "run", "scripts/setup.ts"]);
if (has("--setup-only")) process.exit(0);

step("building the host");
rmSync(path.join(LAB, ".next"), { recursive: true, force: true });
const buildLog = path.join(stateDir, "build.log");

try {
  execFileSync("npx", ["next", "build"], {
    cwd: LAB,
    env,
    stdio: ["ignore", openSync(buildLog, "w"), openSync(buildLog, "a")],
  });
} catch {
  console.error(`[lab] the build failed, see ${buildLog}`);
  process.exit(1);
}

const serverLog = path.join(stateDir, "server.log");
const out = openSync(serverLog, "w");
const server = spawn("npx", ["next", "start", "-p", port], {
  cwd: LAB,
  env,
  detached: true,
  stdio: ["ignore", out, out],
});

server.unref();
writeFileSync(pidFile, String(server.pid));

const base = `http://localhost:${port}`;
let ready = false;

for (let i = 0; i < 90 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  ready = await fetch(`${base}/admin/login`)
    .then((r) => r.status === 200)
    .catch(() => false);
}

if (!ready) {
  console.error(`[lab] the host did not start, see ${serverLog}`);
  process.exit(1);
}

// The same scan as the Initialize button of the chat: a person starts with a knowledge base.
if (!has("--no-init")) {
  step("building the knowledge base");
  const post = (route, init) => fetch(`${base}/api${route}`, { method: "POST", ...init });
  const login = await post("/users/login", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.LAB_USER_EMAIL || "lab@example.com",
      password: process.env.LAB_USER_PASSWORD || "lab-password",
    }),
  }).then(json);
  const headers = { Authorization: `JWT ${login?.token}` };
  const status = await fetch(`${base}/api/content-agent/init`, { headers }).then(json);
  const scan = status?.initialized
    ? { ok: true }
    : await post("/content-agent/init", { headers }).then(json);

  if (!scan?.ok) {
    console.error(`[lab] the knowledge base was not built: ${scan?.error ?? "no answer"}`);
    process.exit(1);
  }
}

writeFileSync(
  path.join(stateDir, "host.json"),
  JSON.stringify({ schema, base, model, databaseUrl: dbUrl.toString(), pid: server.pid }, null, 2) +
    "\n"
);
console.log(
  `\n[lab] ${schema} is up: ${base}/admin  (login lab@example.com / lab-password, model: ${model})`
);
console.log(`[lab] stop it with: kill ${server.pid}   log: ${serverLog}`);
