import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAID_TERMS } from "./paidTerms.js";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const MODULES = path.join(SRC, "modules");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);

    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/u.test(name) ? [full] : [];
  });
}

function relativeImports(file: string): string[] {
  const text = readFileSync(file, "utf-8");
  const specs = [
    ...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/gu),
  ].map((m) => m[1]);

  return specs
    .filter((s) => s.startsWith("."))
    .map((s) => path.resolve(path.dirname(file), s).replace(/\.js$/u, ".ts"));
}

describe("module boundary", () => {
  it("the public package has no src/modules: paid modules live in their own package", () => {
    expect(existsSync(MODULES)).toBe(false);
  });

  it("the core imports nothing from src/modules", () => {
    const core = walk(SRC).filter((file) => !file.startsWith(MODULES + "/"));
    const offending = core.flatMap((file) =>
      relativeImports(file)
        .filter((target) => target.startsWith(MODULES + "/"))
        .map((target) => `${path.relative(SRC, file)} -> ${path.relative(SRC, target)}`)
    );

    expect(offending).toEqual([]);
  });

  it("the core names no paid feature: paid features exist only in modules", () => {
    const core = walk(SRC).filter((file) => !file.startsWith(MODULES + "/"));
    const offending = core.flatMap((file) =>
      readFileSync(file, "utf-8")
        .split("\n")
        .flatMap((line, i) =>
          PAID_TERMS.test(line) ? [`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`] : []
        )
    );

    expect(offending).toEqual([]);
  });
});
