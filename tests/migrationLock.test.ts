// Migrations are append only: a released migration is never edited, renamed, reordered or removed.
// A new migration: add it to the end of its list in the code, then run
// `UPDATE_MIGRATION_LOCK=1 npx vitest run tests/migrationLock.test.ts` and commit tests/fixtures/migrations.lock.json.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MIGRATIONS } from "../src/memory/database.js";

const LOCK = fileURLToPath(new URL("fixtures/migrations.lock.json", import.meta.url));

type Entry = { name: string; sha256: string };
type Lock = { retired: string[]; groups: Record<string, Entry[]> };

const hash = (sql: string) => createHash("sha256").update(sql).digest("hex");
const current: Record<string, Entry[]> = {
  core: MIGRATIONS.map((m) => ({ name: m.name, sha256: hash(m.sql) })),
};

/** The new lock: the code may only add migrations at the end of a list. */
function appended(old: Lock, code: Record<string, Entry[]>): Lock {
  const changed = Object.entries(old.groups).flatMap(([group, locked]) =>
    locked.flatMap((entry, i) =>
      JSON.stringify(code[group]?.[i]) === JSON.stringify(entry) ? [] : [`${group}/${entry.name}`]
    )
  );

  if (changed.length)
    throw new Error(
      `The lock only takes new migrations at the end of a list. A released migration was changed, renamed, reordered or removed: ${changed.join(", ")}. Put it back, and add the change as a new migration at the end of its list.`
    );

  return { retired: old.retired, groups: code };
}

if (process.env.UPDATE_MIGRATION_LOCK) {
  const old: Lock = JSON.parse(readFileSync(LOCK, "utf-8"));

  writeFileSync(LOCK, JSON.stringify(appended(old, current), null, 2) + "\n");
}

const lock: Lock = JSON.parse(readFileSync(LOCK, "utf-8"));

describe("migrations are append only", () => {
  it("covers every migration group", () => {
    expect(Object.keys(lock.groups).sort()).toEqual(Object.keys(current).sort());
  });

  for (const [group, entries] of Object.entries(current)) {
    it(`${group}: names are unique and in ascending order`, () => {
      const names = entries.map((e) => e.name);

      expect(new Set(names).size).toBe(names.length);
      expect([...names].sort()).toEqual(names);
    });

    it(`${group}: every released migration is unchanged, new ones are only appended`, () => {
      const locked = lock.groups[group] ?? [];

      expect(entries.slice(0, locked.length)).toEqual(locked);
      expect(entries.slice(locked.length).map((e) => e.name)).toEqual([]);
    });
  }

  it("the update of the lock refuses a changed or removed migration and takes a new one", () => {
    const old: Lock = { retired: [], groups: { core: [{ name: "001-a", sha256: "x" }] } };

    expect(() => appended(old, { core: [{ name: "001-a", sha256: "y" }] })).toThrow(/001-a/u);
    expect(() => appended(old, { core: [] })).toThrow(/001-a/u);
    expect(
      appended(old, {
        core: [
          { name: "001-a", sha256: "x" },
          { name: "002-b", sha256: "z" },
        ],
      }).groups.core
    ).toHaveLength(2);
  });

  it("a retired name is never used again", () => {
    const names = Object.values(current)
      .flat()
      .map((e) => e.name);

    for (const retired of lock.retired) expect(names).not.toContain(retired);
  });
});
