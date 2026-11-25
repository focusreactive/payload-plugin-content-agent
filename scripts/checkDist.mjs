#!/usr/bin/env node
// dist/ is not in git, but the build also writes src/ui/generatedStyles.ts and src/buildInfo.ts,
// which are: a stale copy ships old styles or a wrong build hash.
// To fix a failure: `git add src/ui/generatedStyles.ts src/buildInfo.ts`, then run it again.
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf-8" });
const PATHS = "dist src/ui/generatedStyles.ts src/buildInfo.ts";

run("npm run clean");
run("npm run build");

const changed = run(`git diff --name-status -- ${PATHS}`).trim();
const unknown = run(`git ls-files --others --exclude-standard -- ${PATHS}`).trim();

if (changed || unknown) {
  console.error("\n[checkDist] dist/ does not match the source.");
  if (changed) console.error(`Changed by the build (M) or without a source (D):\n${changed}`);
  if (unknown) console.error(`Built, but not in git:\n${unknown}`);
  console.error(`\nStage the rebuilt files (git add ${PATHS}) and run the check again.`);
  process.exit(1);
}

console.log("[checkDist] dist/ matches the source.");
