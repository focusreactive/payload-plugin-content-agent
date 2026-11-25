// A write of the MCP layer, then Discard in the admin, on a real Postgres. Needs CA_TEST_DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { runMigrations } from "../src/memory/database.js";
import { MemoryService } from "../src/memory/index.js";
import { withContentAgent } from "../src/mcpLayer/index.js";
import { conversationIdOf } from "../src/mcpLayer/history.js";
import { createDiscardHandler } from "../src/api/reviewDiscard.js";
import { introspectSchema } from "../src/schema/introspector.js";

const ADMIN_URL = process.env.CA_TEST_DATABASE_URL;
const NAME = `ca_test_layer_discard_${process.pid}_${Date.now()}`;

const drafts = { versions: { drafts: true } };
const config = {
  collections: [
    { slug: "posts", timestamps: true, ...drafts, fields: [{ name: "title", type: "text" }] },
    { slug: "notes", timestamps: true, ...drafts, fields: [{ name: "text", type: "text" }] },
  ],
  globals: [],
} as any;

const hostOptions = { collections: { posts: { enabled: true }, notes: { enabled: true } } };
const all = { find: true, create: true, update: true };
const settings = { id: 3, label: "Outside agent", user: { id: 7 }, posts: all, notes: all };

const admin = async (sql: string) => {
  const client = new pg.Client({ connectionString: ADMIN_URL });

  await client.connect();
  await client.query(sql);
  await client.end();
};

describe.skipIf(!ADMIN_URL)("Discard of an MCP layer write on Postgres", () => {
  let pool: pg.Pool;
  let memory: MemoryService;

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await admin(`CREATE DATABASE ${NAME}`);
    const url = new URL(ADMIN_URL!);

    url.pathname = `/${NAME}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await runMigrations(pool, []);
    memory = new MemoryService(pool);
  });

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin(`DROP DATABASE IF EXISTS ${NAME}`).catch(() => {});
  });

  function site() {
    const documents: Record<string, Record<string, unknown>> = {
      posts: { id: 1, title: "First", _status: "draft" },
      notes: { id: 1, text: "First", _status: "draft" },
    };
    const payload = {
      config: {
        ...config,
        admin: { user: "users" },
        custom: {
          contentAgent: {
            getMemory: async () => memory,
            getModules: () => [],
            isChatKey: () => false,
          },
        },
      },
      find: vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 })),
      findByID: vi.fn(async ({ collection }: any) => ({ ...documents[collection] })),
      update: vi.fn(async ({ collection, data }: any) => {
        documents[collection] = { ...documents[collection], ...data };

        return { ...documents[collection] };
      }),
    };

    return { documents, req: { payload, user: { id: 7 } } as any };
  }

  async function writeThenDiscard(collection: string, data: object, pluginCollections: string[]) {
    const { documents, req } = site();
    const wrapped = withContentAgent(hostOptions) as any;

    await wrapped.overrideAuth(req, async () => settings);
    const tool = wrapped.mcp.tools.find((candidate: any) => candidate.name === "patchDocument");

    await tool.handler({ collection, id: 1, data }, req, {});
    const written = { ...documents[collection] };
    const conversationId = conversationIdOf("3", "7", new Date().toISOString().slice(0, 10));
    const discard = createDiscardHandler(
      async () => introspectSchema(config, { collections: pluginCollections }),
      async () => memory
    );
    const body = { conversationId, documents: [{ collection, id: 1 }] };
    const response = await discard({ ...req, json: async () => body } as never);

    return { written, after: documents[collection], results: (await response.json()).results };
  }

  it("brings a document back that the layer changed", async () => {
    const run = await writeThenDiscard("posts", { title: "Second" }, ["posts", "notes"]);

    expect(run.written.title).toBe("Second");
    expect(run.results).toEqual([
      { collection: "posts", id: "1", status: "restored", restored: ["title"] },
    ]);
    expect(run.after.title).toBe("First");
  });
});
