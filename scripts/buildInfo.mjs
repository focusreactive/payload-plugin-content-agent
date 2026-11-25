#!/usr/bin/env node
// Writes src/buildInfo.ts: the package version and a hash of the source files.
// The hash comes from the source only, so the same source always gives the same build: a file
// that git ignores (an editor or system file) never counts.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const target = path.join(srcDir, "buildInfo.ts");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);

    if (entry.name.startsWith(".")) return [];

    return entry.isDirectory() ? walk(file) : [file];
  });
}

// Tracked and new files, not the ignored ones. Without git (a copy of the source), every file
// that is not a dotfile.
function sourceFiles(dir) {
  let files;

  try {
    files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", dir],
      {
        cwd: root,
        encoding: "utf-8",
      }
    )
      .split("\0")
      .filter(Boolean)
      .map((file) => path.join(root, file));
  } catch {
    files = walk(dir);
  }

  // A file deleted from the disk but not from the index is not source any more.
  return files.filter((file) => file !== target && existsSync(file));
}

const hash = createHash("sha256");

for (const file of sourceFiles(srcDir).toSorted()) {
  hash.update(path.relative(srcDir, file).split(path.sep).join("/"));
  hash.update("\0");
  hash.update(readFileSync(file));
  hash.update("\0");
}

const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8"));
const sourceHash = hash.digest("hex").slice(0, 12);

writeFileSync(
  target,
  `/** Written by scripts/buildInfo.mjs on every build. Do not edit. */\nexport const BUILD_INFO = { version: "${version}", sourceHash: "${sourceHash}" } as const;\n`
);
console.log(`[buildInfo] ${version} ${sourceHash}`);
