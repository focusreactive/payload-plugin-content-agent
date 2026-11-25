import { describe, it, expect, vi } from "vitest";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
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
    {
      slug: "legacy-docs",
      fields: [{ name: "title", type: "text" }],
      hasVersions: false,
      hasDrafts: false,
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

const mcpDoc = (doc: any) => ({
  content: [{ text: `Resource from collection "posts":\n${JSON.stringify(doc)}` }],
});

function makePayload(): any {
  return {
    findByID: vi.fn(async ({ id }: any) => ({ id, title: "local" })),
    find: vi.fn(async () => ({ docs: [{ id: "a" }, { id: "b" }], totalPages: 3 })),
    update: vi.fn(async ({ id, data }: any) => ({ id, ...data })),
    findGlobal: vi.fn(async () => ({ siteName: "FR", globalType: "site-settings" })),
    updateGlobal: vi.fn(async ({ data }: any) => ({ siteName: "FR", ...data })),
  };
}

const user: any = { id: 7 };

describe("DocumentIO: transport resolution", () => {
  it("prefers MCP tools when they exist", () => {
    const io = createDocumentIO({
      mcpTools: { findposts: { execute: vi.fn() }, updateposts: { execute: vi.fn() } },
      schema,
      payload: makePayload(),
      user,
    });

    expect(io.transports({ collection: "posts" })).toEqual({
      read: "mcp",
      write: "mcp",
      create: "local",
    });
  });

  it("falls back to the Local API when MCP tools are absent (find: false configs)", () => {
    const io = createDocumentIO({ mcpTools: {}, schema, payload: makePayload(), user });

    expect(io.transports({ collection: "posts" })).toEqual({
      read: "local",
      write: "local",
      create: "local",
    });
  });

  it("mixes per verb: MCP update present, no find → read local, write mcp", () => {
    const io = createDocumentIO({
      mcpTools: { updateposts: { execute: vi.fn() } },
      schema,
      payload: makePayload(),
      user,
    });

    expect(io.transports({ collection: "posts" })).toEqual({
      read: "local",
      write: "mcp",
      create: "local",
    });
  });

  it("has no access without MCP tools AND without payload/user", () => {
    const io = createDocumentIO({ mcpTools: {}, schema });

    expect(io.transports({ collection: "posts" })).toEqual({
      read: null,
      write: null,
      create: null,
    });
  });

  it("refuses targets not in the schema (plugin allowlist)", () => {
    const io = createDocumentIO({ mcpTools: {}, schema, payload: makePayload(), user });

    expect(io.transports({ collection: "secrets" })).toEqual({
      read: null,
      write: null,
      create: null,
    });
    expect(io.transports({ global: "nope" })).toEqual({ read: null, write: null, create: null });
  });

  it("globals always resolve to the Local API", () => {
    const io = createDocumentIO({ mcpTools: {}, schema, payload: makePayload(), user });

    expect(io.transports({ global: "site-settings" })).toEqual({
      read: "local",
      write: "local",
      create: null,
    });
  });
});

describe("DocumentIO: reads", () => {
  it("MCP read passes draft:true + depth:0 and parses the doc", async () => {
    const execute = vi.fn(async () => mcpDoc({ id: "1", title: "T" }));
    const io = createDocumentIO({ mcpTools: { findposts: { execute } }, schema });
    const { doc } = await io.read({ collection: "posts" }, { id: "1", locale: "es" });

    expect(doc).toEqual({ id: "1", title: "T" });
    expect(execute).toHaveBeenCalledWith(
      { id: "1", draft: true, depth: 0, locale: "es" },
      expect.objectContaining({ toolCallId: "doc-io" })
    );
  });

  it("MCP read refuses an answer that holds another document than the one asked for", async () => {
    const execute = vi.fn(async () => mcpDoc({ id: "1", title: "First of the list" }));
    const io = createDocumentIO({ mcpTools: { findposts: { execute } }, schema });
    const result = await io.read({ collection: "posts" }, { id: 42 });

    expect(result.doc).toBeUndefined();
    expect(result.error).toContain('answered with document "1"');
  });

  it("Local read runs as the user with overrideAccess:false", async () => {
    const payload = makePayload();
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const { doc } = await io.read({ collection: "posts" }, { id: "9" });

    expect(doc).toEqual({ id: "9", title: "local" });
    expect(payload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        id: "9",
        draft: true,
        depth: 0,
        overrideAccess: false,
        user,
      })
    );
  });

  it("Global read uses findGlobal", async () => {
    const payload = makePayload();
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const { doc } = await io.read({ global: "site-settings" });

    expect(doc?.siteName).toBe("FR");
    expect(payload.findGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "site-settings", draft: true, overrideAccess: false, user })
    );
  });

  it("global read without payload returns a clear error", async () => {
    const io = createDocumentIO({ mcpTools: {}, schema });
    const { error } = await io.read({ global: "site-settings" });

    expect(error).toMatch(/Local API/u);
  });

  it("rejects a blank/whitespace-only id instead of silently reading nothing", async () => {
    const io = createDocumentIO({ mcpTools: {}, schema, payload: makePayload(), user });
    const empty = await io.read({ collection: "posts" }, { id: "" });

    expect(empty.error).toMatch(/id is required/u);
    const blank = await io.read({ collection: "posts" }, { id: "   " });

    expect(blank.error).toMatch(/id is required/u);
  });
});

describe("DocumentIO: writes", () => {
  it("MCP write surfaces plugin-mcp rejection text as an error", async () => {
    const execute = vi.fn(async () => ({ content: [{ text: "Error updating resource: nope" }] }));
    const io = createDocumentIO({ mcpTools: { updateposts: { execute } }, schema });
    const { error } = await io.write({ collection: "posts" }, { id: "1", patch: { title: "x" } });

    expect(error).toMatch(/nope/u);
  });

  it("Local write sends _status draft + draft:true for drafts-enabled collections", async () => {
    const payload = makePayload();
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const { doc, error } = await io.write(
      { collection: "posts" },
      { id: "1", patch: { title: "x" }, locale: "es" }
    );

    expect(error).toBeUndefined();
    expect(doc).toMatchObject({ title: "x" });
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        id: "1",
        draft: true,
        locale: "es",
        overrideAccess: false,
        user,
        data: { title: "x", _status: "draft" },
      })
    );
  });

  it("refuses a write to a collection without drafts", async () => {
    const payload = makePayload();
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const { error } = await io.write(
      { collection: "legacy-docs" },
      { id: "1", patch: { title: "x" } }
    );

    expect(error).toMatch(/has no drafts/u);
    expect(payload.update).not.toHaveBeenCalled();
  });

  it("Local write surfaces Payload validation errors instead of throwing", async () => {
    const payload = makePayload();

    payload.update.mockRejectedValueOnce(new Error("The following field is invalid: slug"));
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const { error } = await io.write({ collection: "posts" }, { id: "1", patch: { title: "x" } });

    expect(error).toMatch(/field is invalid: slug/u);
  });

  it("Global write uses updateGlobal with drafts handling", async () => {
    const payload = makePayload();
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const { error } = await io.write({ global: "site-settings" }, { patch: { siteName: "New" } });

    expect(error).toBeUndefined();
    expect(payload.updateGlobal).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "site-settings",
        draft: true,
        data: { siteName: "New", _status: "draft" },
      })
    );
  });

  it("rejects a blank/whitespace-only id instead of silently writing nothing", async () => {
    const payload = makePayload();
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const { error } = await io.write({ collection: "posts" }, { id: "", patch: { title: "x" } });

    expect(error).toMatch(/id is required/u);
    expect(payload.update).not.toHaveBeenCalled();
  });
});

describe("DocumentIO.write: respects Payload document locks (overrideLock:false)", () => {
  const lockSchema: SchemaContext = {
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

  it("passes overrideLock:false on a collection update - does not silently override a human editor's lock", async () => {
    const update = vi.fn(async ({ id, data }: any) => ({ id, ...data }));
    const io = createDocumentIO({
      mcpTools: {},
      schema: lockSchema,
      payload: { update } as any,
      user: { id: 1 } as any,
    });

    await io.write({ collection: "posts" }, { id: "1", patch: { title: "x" } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ overrideLock: false }));
  });
  it("passes overrideLock:false on a global update too", async () => {
    const updateGlobal = vi.fn(async ({ data }: any) => ({ ...data }));
    const io = createDocumentIO({
      mcpTools: {},
      schema: lockSchema,
      payload: { updateGlobal } as any,
      user: { id: 1 } as any,
    });

    await io.write({ global: "site-settings" }, { patch: { siteName: "x" } });
    expect(updateGlobal).toHaveBeenCalledWith(expect.objectContaining({ overrideLock: false }));
  });
});

describe("DocumentIO: list", () => {
  it("passes sort to the Local API and to an MCP find tool that declares it", async () => {
    const payload = makePayload();
    const local = createDocumentIO({ mcpTools: {}, schema, payload, user });

    await local.list("posts", { sort: "-updatedAt" });
    expect(payload.find.mock.calls[0][0].sort).toBe("-updatedAt");

    const execute = vi.fn(async (_params: any) => mcpDoc({ id: 1 }));
    const declares = { inputSchema: { jsonSchema: { properties: { sort: { type: "string" } } } } };
    const mcp = createDocumentIO({ mcpTools: { findposts: { execute, ...declares } }, schema });

    await mcp.list("posts", { sort: "-updatedAt" });
    expect(execute.mock.calls[0][0].sort).toBe("-updatedAt");
  });

  it("says so when the site's find tool takes no sort", async () => {
    const execute = vi.fn(async () => mcpDoc({ id: 1 }));
    const io = createDocumentIO({ mcpTools: { findposts: { execute } }, schema });
    const result = await io.list("posts", { sort: "-updatedAt" });

    expect(result.error).toContain("takes no `sort`");
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a filter or a locale that the site tool does not declare, and reads nothing", async () => {
    const execute = vi.fn(async (_params: any) => mcpDoc({ id: 1 }));
    const declares = { inputSchema: { jsonSchema: { properties: { limit: {}, page: {} } } } };
    const io = createDocumentIO({ mcpTools: { findposts: { execute, ...declares } }, schema });
    const filtered = await io.list("posts", { where: { title: { equals: "A" } }, locale: "aa" });
    const read = await io.read({ collection: "posts" }, { id: 1, locale: "aa" });

    expect(filtered.error).toContain("takes no `where` and `locale`");
    expect(filtered.error).toContain("Call again without `where` and `locale`");
    expect(read.error).toContain("takes no `locale`");
    expect(execute).not.toHaveBeenCalled();
    await io.list("posts", {});
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not check a site tool that states no parameters", async () => {
    const execute = vi.fn(async (_params: any) => mcpDoc({ id: 1 }));
    const io = createDocumentIO({ mcpTools: { findposts: { execute } }, schema });
    const result = await io.list("posts", { where: { title: { equals: "A" } }, locale: "aa" });

    expect(result.error).toBeUndefined();
    expect(execute.mock.calls[0][0].locale).toBe("aa");
  });

  it("refuses a write in a locale when the update tool declares none", async () => {
    const execute = vi.fn(async (_params: any) => mcpDoc({ id: 1 }));
    const declares = {
      inputSchema: { jsonSchema: { properties: { id: {}, title: {}, draft: {} } } },
    };
    const io = createDocumentIO({
      mcpTools: { findposts: { execute }, updateposts: { execute, ...declares } },
      schema,
    });
    const result = await io.write(
      { collection: "posts" },
      { id: 1, patch: { title: "B" }, locale: "aa" }
    );

    expect(result.error).toContain("Nothing was written");
    expect(result.error).toContain("takes no `locale`");
    expect(execute).not.toHaveBeenCalled();
  });

  it("lists via Local API find with paging", async () => {
    const payload = makePayload();
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const { docs, totalPages } = await io.list("posts", { page: 2, limit: 50 });

    expect(docs).toHaveLength(2);
    expect(totalPages).toBe(3);
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        page: 2,
        limit: 50,
        draft: true,
        overrideAccess: false,
        user,
      })
    );
  });
});

describe("DocumentIO: create", () => {
  it("MCP-first: uses the create tool with draft semantics, surfaces rejections", async () => {
    const execute = vi.fn(async () => ({
      content: [{ text: `Created successfully:\n${JSON.stringify({ id: "9", title: "New" })}` }],
    }));
    const io = createDocumentIO({ mcpTools: { createposts: { execute } }, schema });
    const { doc, error } = await io.create({ collection: "posts" }, { data: { title: "New" } });

    expect(error).toBeUndefined();
    expect(doc).toMatchObject({ id: "9" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New", _status: "draft", draft: true }),
      expect.anything()
    );

    const rejecting = vi.fn(async () => ({ content: [{ text: "Error creating resource: nope" }] }));
    const io2 = createDocumentIO({ mcpTools: { createposts: { execute: rejecting } }, schema });
    const r2 = await io2.create({ collection: "posts" }, { data: { title: "New" } });

    expect(r2.error).toMatch(/nope/u);
  });

  it("falls back to payload.create as the user when no MCP create tool exists", async () => {
    const payload = makePayload() as any;

    payload.create = vi.fn(async ({ data }: any) => ({ id: "42", ...data }));
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const { doc, error } = await io.create(
      { collection: "posts" },
      { data: { title: "Shell" }, locale: "es" }
    );

    expect(error).toBeUndefined();
    expect(doc).toMatchObject({ id: "42", title: "Shell" });
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        draft: true,
        locale: "es",
        overrideAccess: false,
        user,
        data: { title: "Shell", _status: "draft" },
      })
    );
  });

  it("refuses a create in a collection without drafts", async () => {
    const payload = makePayload() as any;

    payload.create = vi.fn(async ({ data }: any) => ({ id: "1", ...data }));
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const { error } = await io.create({ collection: "legacy-docs" }, { data: { title: "X" } });

    expect(error).toMatch(/has no drafts/u);
    expect(payload.create).not.toHaveBeenCalled();
  });

  it("refuses creating a global (singletons) and unknown collections", async () => {
    const payload = makePayload() as any;

    payload.create = vi.fn();
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const g = await io.create({ global: "site-settings" }, { data: {} });

    expect(g.error).toMatch(/singleton/iu);
    const u = await io.create({ collection: "nope" }, { data: {} });

    expect(u.error).toMatch(/^Unknown collection "nope"\. Collections: /u);
  });

  it("surfaces Payload validation errors (e.g. required fields)", async () => {
    const payload = makePayload() as any;

    payload.create = vi.fn(async () => {
      throw new Error("The following field is invalid: title");
    });
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const { error } = await io.create({ collection: "posts" }, { data: {} });

    expect(error).toMatch(/field is invalid: title/u);
  });
});

const answer = (text: string) => vi.fn(async () => ({ content: [{ type: "text", text }] }));

describe("DocumentIO.list: where filter (server-side count)", () => {
  it("passes a where clause to the Local API and returns the exact totalDocs", async () => {
    const payload = makePayload() as any;

    payload.find = vi.fn(async () => ({ docs: [{ id: "a" }], totalPages: 1, totalDocs: 12 }));
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const r = await io.list("posts", { where: { authors: { equals: 4 } }, limit: 1 });

    expect(r.totalDocs).toBe(12);
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        where: { authors: { equals: 4 } },
        overrideAccess: false,
        user,
      })
    );
  });

  it("passes where through the MCP find tool when present", async () => {
    const execute = vi.fn(async () => ({ content: [{ text: "Total: 5 documents" }] }));
    const io = createDocumentIO({ mcpTools: { findposts: { execute } }, schema });
    const r = await io.list("posts", { where: { _status: { equals: "published" } } });

    // The Payload MCP find tool declares `where` as a JSON string.
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ where: '{"_status":{"equals":"published"}}' }),
      expect.anything()
    );
    expect(r.totalDocs).toBe(5);
  });

  it("keeps where an object for a find tool that declares it as an object", async () => {
    const execute = vi.fn(async () => ({ content: [{ text: "Total: 5 documents" }] }));
    const io = createDocumentIO({
      mcpTools: {
        findposts: {
          execute,
          inputSchema: { jsonSchema: { properties: { where: { type: "object" } } } },
        },
      },
      schema,
    });

    await io.list("posts", { where: { _status: { equals: "published" } } });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ where: { _status: { equals: "published" } } }),
      expect.anything()
    );
  });

  it("reports a refused list as an error, not as documents", async () => {
    const refusal =
      '[{"code":"invalid_type","expected":"string","received":"object","path":["where"],"message":"Expected string, received object"}]';
    const execute = vi.fn(async () => ({
      isError: true,
      content: [{ type: "text", text: `MCP error -32602: Input validation error: ${refusal}` }],
    }));
    const io = createDocumentIO({ mcpTools: { findposts: { execute } }, schema });
    const r = await io.list("posts", { where: { title: { contains: "x" } } });

    expect(r.docs).toEqual([]);
    expect(r.error).toMatch(/Failed to list/u);
  });

  it("reports a failed query that the site answers as plain text, not as zero documents", async () => {
    const text =
      '❌ **Error reading resources from collection "posts":** The following path cannot be queried: name';
    const execute = vi.fn(async () => ({ content: [{ type: "text", text }] }));
    const io = createDocumentIO({ mcpTools: { findposts: { execute } }, schema });
    const r = await io.list("posts", { where: { name: { contains: "x" } } });

    expect(r.error).toMatch(/Failed to list collection "posts": .*cannot be queried: name/u);
    expect(r.totalDocs).toBe(0);
  });

  it("reads a failed read as an error and a missing document as no document", async () => {
    const failed = createDocumentIO({
      mcpTools: {
        findposts: {
          execute: answer('❌ **Error reading resources from collection "posts":** timeout'),
        },
      },
      schema,
    });
    const missing = createDocumentIO({
      mcpTools: {
        findposts: {
          execute: answer('Error: Document with ID "9" not found in collection "posts"'),
        },
      },
      schema,
    });

    expect((await failed.read({ collection: "posts" }, { id: "9" })).error).toMatch(
      /Failed to read collection "posts".*timeout/u
    );
    expect(await missing.read({ collection: "posts" }, { id: "9" })).toEqual({ doc: null });
  });

  it("omits an empty where object", async () => {
    const payload = makePayload() as any;
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });

    await io.list("posts", { where: {} });
    expect(payload.find).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: expect.anything() })
    );
  });
});
