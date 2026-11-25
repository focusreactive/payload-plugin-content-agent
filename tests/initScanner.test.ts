import { describe, it, expect } from "vitest";
import { isInitialized, runInitScanner } from "../src/memory/initScanner.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  collections: [
    {
      slug: "posts",
      labels: { plural: "Posts", singular: "Post" },
      fields: [{ name: "title", type: "text" }],
      hasDrafts: true,
    } as any,
  ],
  globals: [
    {
      slug: "site-settings",
      label: "Site Settings",
      fields: [{ name: "siteName", type: "text" }],
    } as any,
  ],
};

function makeMemory() {
  const created: any[] = [];
  const memory: any = {
    ltm: {
      create: async (e: any) => {
        created.push(e);

        return e;
      },
      listAllWithShared: async () => [],
      archive: async () => {},
      read: async () => null,
    },
    backgroundReports: {
      startWorker: async () => ({ id: "w1" }),
      startWorkerIfNotRunning: async () => ({ id: "w1" }),
      completeWorker: async () => {},
      failWorker: async () => {},
    },
  };

  return { memory, created };
}

describe("runInitScanner (counts via DocumentIO Local API fallback)", () => {
  it("reports real document counts for a find:false collection (no MCP find tool)", async () => {
    const payload = {
      find: async ({ collection }: any) => {
        expect(collection).toBe("posts");

        return { docs: [{ id: 1 }], totalDocs: 42, totalPages: 42 };
      },
      findGlobal: async ({ slug }: any) => ({
        id: 1,
        globalType: slug,
        siteName: "Sample Agency",
        createdAt: "x",
        updatedAt: "y",
      }),
    };
    const io = createDocumentIO({
      mcpTools: {},
      schema,
      payload: payload as any,
      user: { id: "admin" } as any,
    });
    const { memory, created } = makeMemory();

    const res = await runInitScanner(io, schema, memory, "test-instance-1");

    expect(res.ok).toBe(true);
    expect(res.collections).toBe(1);

    const posts = created.find((e) => e.slug === "content-map-posts");

    expect(posts).toBeTruthy();
    const today = new Date().toISOString().slice(0, 10);

    expect(posts.body).toContain(`42 documents on ${today}, the day of the scan`);
    expect(created.find((e) => e.slug === "content-map").body).toContain(
      `the number of documents on ${today}`
    );
    expect(posts.body).not.toContain("no MCP tool");

    const global = created.find((e) => e.slug === "content-map-global-site-settings");

    expect(global.body).toContain(`Has data on ${today}`);
  });

  it('marks a collection with no transport at all as "(no access)", not a crash', async () => {
    const io = createDocumentIO({ mcpTools: {}, schema });
    const { memory, created } = makeMemory();

    const res = await runInitScanner(io, schema, memory, "test-instance-2");

    expect(res.ok).toBe(true);
    const posts = created.find((e) => e.slug === "content-map-posts");

    expect(posts.body).toContain("(no access) documents.");
    expect(posts.body).not.toContain("the day of the scan");
  });
});

describe("the state the scan leaves", () => {
  it("is initialized with a collection the person cannot read, and writes no rules as memory", async () => {
    const payload = {
      find: async () => {
        throw new Error("Forbidden");
      },
      findGlobal: async () => ({ id: 1, siteName: "Site" }),
    };
    const io = createDocumentIO({
      mcpTools: {},
      schema,
      payload: payload as any,
      user: { id: "editor" } as any,
    });
    const { memory, created } = makeMemory();
    const archived: string[] = [];

    memory.ltm.listAllWithShared = async () => [{ slug: "behavior", createdBy: "init-scanner" }];

    memory.ltm.archive = async (_user: string, slug: string) => {
      archived.push(slug);
    };

    const res = await runInitScanner(io, schema, memory, "test-instance-3");

    expect(res.ok).toBe(true);
    expect(created.find((e) => e.slug === "content-map-posts").body).toContain("(inaccessible)");
    expect(created.some((e) => e.slug === "behavior")).toBe(false);
    expect(archived).toContain("behavior");
    memory.ltm.read = async (_user: string, slug: string) =>
      created.find((e) => e.slug === slug) ?? null;
    expect(await isInitialized(memory)).toBe(true);
  });
});
