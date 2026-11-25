import { describe, expect, it, vi, afterEach } from "vitest";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { createTurnApprovals, decideApproval } from "../src/agent/approvals.js";
import { createUpdateDocumentTool } from "../src/agent/tools/documents/updateDocument.js";
import { wrapMcpTools } from "../src/agent/tools/mcp/wrapTools.js";
import { createTools } from "../src/agent/tools/index.js";
import type { SchemaContext, SchemaField } from "../src/types.js";
import { pluginOptions } from "./harness.js";

afterEach(() => vi.restoreAllMocks());

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
      fields: [{ name: "tagline", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
    } as any,
  ],
};

const options: any = { toolCallId: "call-1", messages: [] };
const withParams = (...names: string[]) => ({
  jsonSchema: { type: "object", properties: Object.fromEntries(names.map((name) => [name, {}])) },
});

function wrap(mcpTools: Record<string, any>, recordEdits = vi.fn()) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const wrapped = wrapMcpTools(mcpTools, {
    schema,
    documentIo: () => createDocumentIO({ mcpTools, schema }),
    recordEdits,
  });

  return {
    tools: wrapped.safeMcpTools as any,
    wrapped,
    warnings: warn.mock.calls.map(([text]) => String(text)),
  };
}

describe("a write tool of a collection outside the agent's schema", () => {
  it("always saves a draft where the tool takes `draft`, whatever the model sends", async () => {
    const execute = vi.fn(async (_params: unknown) => "ran");
    const { tools } = wrap({
      updateOrders: { execute, inputSchema: withParams("id", "draft", "_status", "note") },
    });

    await tools.updateOrders.execute(
      { id: 1, note: "x", draft: false, _status: "published" },
      options
    );

    expect(execute.mock.calls[0][0]).toEqual({ id: 1, note: "x", draft: true, _status: "draft" });
  });

  it("adds no parameter the tool does not take", async () => {
    const execute = vi.fn(async (_params: unknown) => "ran");
    const { tools } = wrap({ createInvoice: { execute, inputSchema: withParams("amount") } });

    await tools.createInvoice.execute({ amount: 5 }, options);

    expect(execute.mock.calls[0][0]).toEqual({ amount: 5 });
  });

  it("keeps `draft` a default for a reader", async () => {
    const execute = vi.fn(async (_params: unknown) => "ran");
    const { tools } = wrap({ findOrders: { execute, inputSchema: withParams("id", "draft") } });

    await tools.findOrders.execute({ id: 1, draft: false }, options);

    expect(execute.mock.calls[0][0]).toEqual({ id: 1, draft: false });
  });

  it("is named in a server warning with the two ways out, once per server process", () => {
    const tools = {
      updateInvoices: { execute: async () => "ran", inputSchema: withParams("id", "draft") },
      findInvoices: { execute: async () => "ran", inputSchema: withParams("id", "draft") },
    };
    const { wrapped, warnings } = wrap(tools);

    expect(wrapped.ungatedWriteTools).toEqual(["updateInvoices"]);
    expect(warnings.join("\n")).toMatch(/updateInvoices/u);
    expect(warnings.join("\n")).toMatch(/Remove them from the MCP key, or add the collection/u);
    vi.restoreAllMocks();
    expect(wrap(tools).warnings).toEqual([]);
  });
});

const fromTheServer = () => "from the server";

describe("wrapping edge cases", () => {
  it("does not offer a tool that cannot be executed", () => {
    const { tools, warnings } = wrap({
      findPosts: { execute: async () => "ran" },
      brokenTool: { description: "no execute" },
    });

    expect(Object.keys(tools)).toEqual(["findPosts"]);
    expect(warnings.join("\n")).toMatch(/"brokenTool" has no execute function/u);
  });

  it("leaves a description that is not a text as it is", () => {
    const description = fromTheServer;
    const { tools } = wrap({
      findSiteSettings: { description, execute: async () => "ran", inputSchema: withParams() },
    });

    expect(tools.findSiteSettings.description).toBe(description);
  });

  it("appends the published-only note to a text description", () => {
    const { tools } = wrap({
      findSiteSettings: {
        description: "Reads the settings.",
        execute: async () => "ran",
        inputSchema: withParams(),
      },
    });

    expect(tools.findSiteSettings.description).toMatch(/^Reads the settings\.\n\nNOTE: this tool/u);
  });

  it("logs a failed change record instead of hiding it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mcpTools = {
      findPosts: {
        execute: async () => ({
          content: [
            { type: "text", text: 'Resource from collection "posts":\n{"id":1,"title":"A"}' },
          ],
        }),
      },
      updatePosts: {
        execute: async () => ({
          content: [{ type: "text", text: 'Document updated successfully\n{"id":1,"title":"B"}' }],
        }),
      },
    };
    const { tools } = wrap(
      mcpTools,
      vi.fn(() => {
        throw new Error("storage is down");
      })
    );
    const result = await tools.updatePosts.execute({ id: "1", title: "B" }, options);

    expect(JSON.stringify(result)).toMatch(/updated successfully/u);
    expect(error.mock.calls[0][0]).toMatch(/could not be recorded for the review panel/u);
  });
});

describe("a destructive update of a global", () => {
  it("asks the person and names the global", async () => {
    const approvals = createTurnApprovals();
    const mcpTools = { updateSiteSettings: { execute: async () => "ran" } };

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      schema,
      documentIo: () => ({ read: async () => ({ doc: { tagline: "Old" } }) }) as any,
      recordEdits: vi.fn(),
      approvals,
    };

    createUpdateDocumentTool(context, wrapMcpTools(mcpTools, context).updateTargets);
    expect([...approvals.policies.keys()]).toEqual(["updateDocument"]);
    const asked = await decideApproval(approvals, {
      toolName: "updateDocument",
      toolCallId: "call-1",
      input: { global: "site-settings", data: { tagline: "" } },
    });

    expect(JSON.parse(asked?.reason ?? "")).toEqual({
      kind: "risky-update",
      global: "site-settings",
      effects: ['"tagline" has a value now. The update empties it.'],
    });
  });
});

const gateSchema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
        {
          name: "meta",
          type: "group",
          fields: [
            { name: "note", type: "text" },
            { name: "migrationId", type: "text", readOnly: true },
          ],
        },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};
const c3 = { toolCallId: "t", messages: [] } as any;
const mcp3 = (doc: any) => ({
  findPosts: {
    execute: async () => ({ content: [{ text: `Resource:\n${JSON.stringify(doc)}` }] }),
  },
  updatePosts: {
    execute: async (p: any) => ({ content: [{ text: "Document updated successfully" }], _p: p }),
  },
});

describe("MCP tools: every other tool passes through, recognized CRUD is reached through the document tools", () => {
  it("recognized content CRUD (find/create/update{Collection}) is not in the model's tool set: the document tools stand for it", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mcp = {
      findPosts: { execute: async () => ({}) },
      createPosts: { execute: async () => ({}) },
      updatePosts: { execute: async () => ({}) },
      updateSiteSettings: { execute: async () => ({}) },
    };
    const tools: Record<string, any> = createTools(mcp, schema, pluginOptions());

    for (const name of Object.keys(mcp)) expect(tools[name]).toBeUndefined();

    for (const name of ["readDocument", "listDocuments", "createDocument", "updateDocument"])
      expect(tools[name]).toBeDefined();
    expect(Object.keys(tools).filter((name) => /^update/iu.test(name))).toEqual(["updateDocument"]);
    log.mockRestore();
  });

  it("any other MCP tool (custom project tools, plugin-mcp auth/job/config/schema tools) passes through unwrapped by default - no option needed; a delete tool never does", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mcp = {
      createNewsletterCampaign: { execute: async () => ({}) },
      resetPassword: { execute: async () => ({}) },
      runJob: { execute: async () => ({}) },
      findConfig: { execute: async () => ({}) },
      unlock: { execute: async () => ({}) },
      deletePosts: { execute: async () => ({}) },
      createCollection: { execute: async () => ({}) },
      updateCollection: { execute: async () => ({}) },
      deleteCollection: { execute: async () => ({}) },
      updateConfig: { execute: async () => ({}) },
    };
    const tools: Record<string, any> = createTools(mcp, gateSchema, pluginOptions());

    for (const name of Object.keys(mcp)) {
      if (name.startsWith("delete")) expect(tools[name]).toBeUndefined();
      else expect(tools[name]).toBeDefined();
    }

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("outside the recognized content CRUD convention")
    );
    log.mockRestore();
  });

  it("a pass-through tool that fails names the document tools that do the same work", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mcp = {
      getField: {
        execute: async () => {
          throw new Error("MCP error -32602: Invalid tools/call result");
        },
      },
    };
    const tools: Record<string, any> = createTools(mcp, gateSchema, pluginOptions());
    const failure = tools.getField.execute(
      { slug: "posts", id: "1" },
      { toolCallId: "t", messages: [] }
    );

    await expect(failure).rejects.toThrow(
      /Invalid tools\/call result.*readDocument.*updateDocument/su
    );
    log.mockRestore();
  });

  it("recognized content CRUD keeps its normal safety wrapping (draft-forcing/write-gate) alongside unrestricted pass-through tools", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mcp = { ...mcp3({ id: "1", title: "x" }), resetPassword: { execute: async () => ({}) } };
    const tools: Record<string, any> = createTools(mcp, gateSchema, pluginOptions());
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { title: "y" } },
      c3
    );

    expect(res.error).toBeUndefined();
    expect(res._p).toEqual({
      id: "1",
      title: "y",
      draft: true,
      _status: "draft",
    });
    expect(tools.resetPassword).toBeDefined();
    log.mockRestore();
  });

  it("a pass-through tool's oversized output is capped", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const huge = "x".repeat(50_000);
    const mcp = { getDocument: { execute: async () => ({ content: [{ text: huge }] }) } };
    const tools: Record<string, any> = createTools(mcp, gateSchema, pluginOptions());
    const res: any = await tools.getDocument.execute({ raw: true }, c3);

    expect(res.content[0].text.length).toBeLessThan(huge.length);
    expect(res.content[0].text).toContain("truncated");
    log.mockRestore();
  });

  it("a pass-through tool's small output passes through byte-for-byte (no unnecessary rewrite)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mcp = { getDocument: { execute: async () => ({ content: [{ text: "small doc" }] }) } };
    const tools: Record<string, any> = createTools(mcp, gateSchema, pluginOptions());
    const res: any = await tools.getDocument.execute({}, c3);

    expect(res.content[0].text).toBe("small doc");
    log.mockRestore();
  });
});

const wrapperSchema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
      ],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

describe("write wrapper: where-clause bypass + non-CRUD pass-through + fail-closed", () => {
  const doc = { id: "1", title: "A", tags: [1, 2] };
  const makeMcp = () => ({
    findPosts: {
      execute: vi.fn(async () => ({ content: [{ text: `Resource:\n${JSON.stringify(doc)}` }] })),
    },
    updatePosts: {
      execute: vi.fn(async () => ({ content: [{ text: "Document updated successfully" }] })),
    },
    createCollection: { execute: vi.fn() },
    updateConfig: { execute: vi.fn() },
  });

  it("refuses a multi-document where-clause update", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mcp = makeMcp();
    const tools: Record<string, any> = createTools(mcp, wrapperSchema, pluginOptions());
    const where = '{"title":{"contains":"x"}}';
    const noId: any = await tools.updateDocument.execute(
      { collection: "posts", data: { where, tags: [] } },
      { toolCallId: "t", messages: [] }
    );

    expect(noId.error).toMatch(/Pass the `id` of the document in "posts"/u);
    const withId: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { where, tags: [] } },
      { toolCallId: "t", messages: [] }
    );

    expect(withId.error).toMatch(/remove "where" from it/u);
    expect(mcp.updatePosts.execute).not.toHaveBeenCalled();
    expect(mcp.findPosts.execute).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("fails CLOSED when the before-read fails for an update", async () => {
    const mcp = makeMcp();

    mcp.findPosts.execute = vi.fn(async () => {
      throw new Error("pooler hiccup");
    }) as any;
    const tools: Record<string, any> = createTools(mcp, wrapperSchema, pluginOptions());
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { tags: [1] } },
      { toolCallId: "t", messages: [] }
    );

    expect(res.error).toMatch(/Cannot verify/u);
    expect(mcp.updatePosts.execute).not.toHaveBeenCalled();
  });

  it("harmless update still passes when before-read succeeds", async () => {
    const mcp = makeMcp();
    const tools: Record<string, any> = createTools(mcp, wrapperSchema, pluginOptions());
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { title: "B" } },
      { toolCallId: "t", messages: [] }
    );

    expect(res.error).toBeUndefined();
    expect(mcp.updatePosts.execute).toHaveBeenCalled();
  });
});
