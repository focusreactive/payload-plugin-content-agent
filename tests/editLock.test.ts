import { describe, expect, it, vi } from "vitest";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { wrapMcpTools } from "../src/agent/tools/mcp/wrapTools.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  collections: [
    {
      slug: "posts",
      fields: [{ name: "title", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
  globals: [
    {
      slug: "site-settings",
      fields: [{ name: "siteName", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
    },
  ],
};

const user: any = { id: 7, collection: "users" };
const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

interface Lock {
  userId: number | string;
  relationTo?: string;
  updatedAt: string;
}

function makePayload(lock: Lock | null, lockDocuments?: unknown): any {
  const find = vi.fn(async () => ({
    docs: lock
      ? [
          {
            id: 1,
            user: { relationTo: lock.relationTo ?? "users", value: lock.userId },
            updatedAt: lock.updatedAt,
          },
        ]
      : [],
  }));

  return {
    collections: {
      "payload-locked-documents": { config: {} },
      posts: { config: { lockDocuments } },
    },
    config: { globals: [{ slug: "site-settings", lockDocuments }] },
    find,
    update: vi.fn(async ({ id, data }: any) => ({ id, ...data })),
    updateGlobal: vi.fn(async ({ data }: any) => ({ ...data })),
  };
}

const ioWith = (payload: any, mcpTools: any = {}) =>
  createDocumentIO({ mcpTools, schema, payload, user });

describe("lockRefusal", () => {
  it("refuses when another person holds a live lock, and names the way out", async () => {
    const payload = makePayload({ userId: 9, updatedAt: secondsAgo(60) });
    const refusal = await ioWith(payload).lockRefusal({ collection: "posts" }, 5);

    expect(refusal).toMatch(/^Document 5 in collection "posts" is open in the admin panel/u);
    expect(refusal).toMatch(/Nothing was written/u);
    expect(refusal).toMatch(/save and close the document/u);
    expect(refusal).toMatch(/about 4 min/u);
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "payload-locked-documents",
        where: {
          and: [
            { "document.relationTo": { equals: "posts" } },
            { "document.value": { equals: 5 } },
          ],
        },
      })
    );
  });

  it("looks up a global by its slug", async () => {
    const payload = makePayload({ userId: 9, updatedAt: secondsAgo(10) });
    const refusal = await ioWith(payload).lockRefusal({ global: "site-settings" });

    expect(refusal).toMatch(/^Global "site-settings" is open in the admin panel/u);
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { globalSlug: { equals: "site-settings" } } })
    );
  });

  it("passes the chat user's own lock", async () => {
    const payload = makePayload({ userId: "7", updatedAt: secondsAgo(10) });

    expect(await ioWith(payload).lockRefusal({ collection: "posts" }, 5)).toBeNull();
  });

  it("treats the same id in another auth collection as another person", async () => {
    const payload = makePayload({ userId: 7, relationTo: "admins", updatedAt: secondsAgo(10) });

    expect(await ioWith(payload).lockRefusal({ collection: "posts" }, 5)).toMatch(
      /another person/u
    );
  });

  it("passes an expired lock, with the default and with a custom duration", async () => {
    const expired = makePayload({ userId: 9, updatedAt: secondsAgo(301) });
    const custom = makePayload({ userId: 9, updatedAt: secondsAgo(40) }, { duration: 30 });
    const customLive = makePayload({ userId: 9, updatedAt: secondsAgo(20) }, { duration: 30 });

    expect(await ioWith(expired).lockRefusal({ collection: "posts" }, 5)).toBeNull();
    expect(await ioWith(custom).lockRefusal({ collection: "posts" }, 5)).toBeNull();
    expect(await ioWith(customLive).lockRefusal({ collection: "posts" }, 5)).toMatch(/is open/u);
  });

  it("passes with no lock, with locking off, and with no lock collection", async () => {
    const off = makePayload({ userId: 9, updatedAt: secondsAgo(10) }, false);
    const none = makePayload({ userId: 9, updatedAt: secondsAgo(10) });

    delete none.collections["payload-locked-documents"];

    expect(await ioWith(makePayload(null)).lockRefusal({ collection: "posts" }, 5)).toBeNull();
    expect(await ioWith(off).lockRefusal({ collection: "posts" }, 5)).toBeNull();
    expect(await ioWith(none).lockRefusal({ collection: "posts" }, 5)).toBeNull();
    expect(off.find).not.toHaveBeenCalled();
    expect(none.find).not.toHaveBeenCalled();
  });

  it("refuses when the lock cannot be read", async () => {
    const payload = makePayload(null);

    payload.find = vi.fn(async () => {
      throw new Error("db down");
    });

    expect(await ioWith(payload).lockRefusal({ collection: "posts" }, 5)).toMatch(
      /could not check.*db down.*Nothing was written/u
    );
  });
});

describe("a locked document gets no agent write", () => {
  it("DocumentIO.write refuses on the Local API and on the MCP transport", async () => {
    const payload = makePayload({ userId: 9, updatedAt: secondsAgo(10) });
    const update = vi.fn();
    const local = await ioWith(payload).write({ collection: "posts" }, { id: 5, patch: {} });
    const global = await ioWith(payload).write({ global: "site-settings" }, { patch: {} });
    const mcp = await ioWith(payload, { updatePosts: { execute: update } }).write(
      { collection: "posts" },
      { id: 5, patch: { title: "x" } }
    );

    for (const result of [local, global, mcp])
      expect(result.error).toMatch(/is open in the admin/u);
    expect(payload.update).not.toHaveBeenCalled();
    expect(payload.updateGlobal).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("the update tool of the MCP server refuses before it reads or writes", async () => {
    const payload = makePayload({ userId: 9, updatedAt: secondsAgo(10) });
    const executes = { updatePosts: vi.fn(), findPosts: vi.fn() };
    const mcpTools: any = Object.fromEntries(
      Object.entries(executes).map(([name, execute]) => [name, { execute }])
    );
    const { safeMcpTools } = wrapMcpTools(mcpTools, {
      schema,
      documentIo: () => ioWith(payload, mcpTools),
      recordEdits: vi.fn(),
    });
    const result = await (safeMcpTools as any).updatePosts.execute(
      { id: 5, title: "x" },
      { toolCallId: "call-1", messages: [] }
    );

    expect(result.error).toMatch(/Document 5 in collection "posts" is open in the admin/u);
    expect(executes.updatePosts).not.toHaveBeenCalled();
    expect(executes.findPosts).not.toHaveBeenCalled();
  });

  it("writes when the lock is the chat user's own", async () => {
    const payload = makePayload({ userId: 7, updatedAt: secondsAgo(10) });
    const { error } = await ioWith(payload).write(
      { collection: "posts" },
      { id: 5, patch: { title: "x" } }
    );

    expect(error).toBeUndefined();
    expect(payload.update).toHaveBeenCalledWith(expect.objectContaining({ overrideLock: false }));
  });
});
