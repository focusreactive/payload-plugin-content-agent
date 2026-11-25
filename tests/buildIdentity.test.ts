import { describe, it, expect, vi } from "vitest";
import { createInitHandlers } from "../src/api/initEndpoint.js";
import { BUILD_INFO } from "../src/buildInfo.js";
import packageJson from "../package.json" with { type: "json" };

const options = async () => ({ modules: [{ name: "notes" }, { name: "search" }] }) as any;

const memoryWith = (migrations: string[]) =>
  ({
    db: { query: vi.fn(async () => ({ rows: migrations.map((name) => ({ name })) })) },
    ltm: { read: async () => ({ body: "content map" }) },
  }) as any;

const statusOf = async (memory: unknown, user: unknown = { id: 1 }) => {
  const { status } = createInitHandlers(
    options,
    async () => ({ collections: [], globals: [] }),
    async () => memory as any
  );
  const response = await status({ user } as any);

  return { code: response.status, body: await response.json() };
};

describe("the status endpoint says which build runs", () => {
  it("returns the version, the source hash, the modules and the applied migrations", async () => {
    const memory = memoryWith(["001-initial", "notes:001-notes"]);
    const { body } = await statusOf(memory);

    expect(body).toEqual({
      initialized: true,
      memoryEnabled: true,
      build: { version: packageJson.version, sourceHash: BUILD_INFO.sourceHash },
      modules: ["notes", "search"],
      migrations: ["001-initial", "notes:001-notes"],
    });
    expect(BUILD_INFO.sourceHash).toMatch(/^[0-9a-f]{12}$/u);
    expect(memory.db.query.mock.calls[0][0]).toContain("ORDER BY id");
  });

  it("still names the build when memory is off", async () => {
    const { body } = await statusOf(null);

    expect(body.memoryEnabled).toBe(false);
    expect(body.build).toEqual(BUILD_INFO);
    expect(body.migrations).toEqual([]);
  });

  it("tells nothing to a request without a user", async () => {
    const { code, body } = await statusOf(memoryWith([]), null);

    expect(code).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });
});
