import { describe, it, expect, vi } from "vitest";
import { withContentAgent } from "../src/mcpLayer/index.js";
import { LAYER_TOOLS } from "../src/mcpLayer/tools.js";
import { LAYER_INSTRUCTIONS } from "../src/mcpLayer/instructions.js";
import { chatToolNames } from "./chatToolNames.js";

const config = {
  collections: [
    {
      slug: "posts",
      timestamps: true,
      fields: [
        { name: "title", type: "text", required: true },
        { name: "body", type: "textarea" },
      ],
    },
    { slug: "team-members", timestamps: true, fields: [{ name: "name", type: "text" }] },
    { slug: "orders", timestamps: true, fields: [{ name: "total", type: "number" }] },
  ],
  globals: [{ slug: "site-settings", fields: [{ name: "siteName", type: "text" }] }],
} as any;

const hostOptions = () => ({
  collections: {
    posts: { enabled: true },
    "team-members": { enabled: { find: false, update: true } },
  },
  globals: { "site-settings": { enabled: true } },
});

const keySettings = (flags: Record<string, unknown>) => ({ user: { id: 7 }, ...flags });

function request() {
  const payload = {
    config,
    find: vi.fn(async () => ({ docs: [{ id: 1, title: "First" }], totalPages: 1, totalDocs: 1 })),
    findByID: vi.fn(async ({ id }: any) => ({ id, title: "First", body: "Text" })),
    findGlobal: vi.fn(async () => ({ siteName: "Site" })),
  };

  return { payload, user: { id: 7 } } as any;
}

interface Wrapped {
  mcp: { tools: any[]; serverOptions: { instructions: string; serverInfo?: unknown } };
  overrideAuth: (req: any, getDefault: () => Promise<any>) => Promise<any>;
}

async function call(
  wrapped: Wrapped,
  name: string,
  args: Record<string, unknown>,
  settings: Record<string, unknown> | null
) {
  const req = request();

  if (settings) await wrapped.overrideAuth(req, async () => settings);
  const tool = wrapped.mcp.tools.find((candidate) => candidate.name === name);
  const result = await tool.handler(args, req, {});
  const text: string = result.content[0].text;

  return { req, text };
}

const wrap = (options: any = hostOptions()) => withContentAgent(options) as unknown as Wrapped;

describe("the MCP layer: tool names", () => {
  it("no tool has a name that plugin-mcp makes from a collection or global slug", () => {
    for (const tool of LAYER_TOOLS) expect(tool.name).not.toMatch(/^(find|create|update|delete)/u);
  });

  it("a description names no tool of the chat that the layer does not have", async () => {
    const chatTools = await chatToolNames();
    const layerNames = new Set(LAYER_TOOLS.map((tool) => tool.name));
    const foreign = chatTools.filter((name) => !layerNames.has(name));
    const { tools } = wrap().mcp;

    expect(foreign.length).toBeGreaterThan(5);
    for (const tool of tools)
      for (const name of foreign) expect(tool.description, tool.name).not.toContain(name);
  });

  it("refuses a tool of the site with the name of a layer tool", () => {
    expect(() => wrap({ mcp: { tools: [{ name: "readDocument" }] } })).toThrow(/readDocument/u);
  });

  it("keeps the tools of the site in front of its own", () => {
    const siteTool = { name: "siteTool" };
    const { tools } = wrap({ ...hostOptions(), mcp: { tools: [siteTool] } }).mcp;

    expect(tools[0]).toBe(siteTool);
    expect(tools.map((tool) => tool.name).slice(1)).toEqual(LAYER_TOOLS.map((tool) => tool.name));
  });
});

describe("the MCP layer: parameters in the description", () => {
  it("states every parameter with its type, limits, default and text", () => {
    const { description } = wrap().mcp.tools.find((tool) => tool.name === "listDocuments");

    expect(description).toContain("- `collection` (string, required): Collection slug");
    expect(description).toContain("- `limit` (integer, optional, 1 to 100, default 20)");
    expect(description).toContain("- `page` (integer, optional, at least 1, default 1)");
  });

  it("states the values of an enum and the types of a union", () => {
    const { description } = wrap().mcp.tools.find((tool) => tool.name === "readDocument");

    expect(description).toContain(
      '- `view` ("fields" | "outline" | "text" | "links" | "history", optional)'
    );
    expect(description).toContain("- `id` (string or number, optional)");
  });

  it("hands the input shape to the MCP server", () => {
    for (const tool of wrap().mcp.tools)
      expect(Object.keys(tool.parameters).length).toBeGreaterThan(0);
  });
});

describe("the MCP layer: what a key can read", () => {
  const allFlags = {
    posts: { find: true },
    teamMembers: { find: true },
    orders: { find: true },
    siteSettings: { find: true },
  };

  it("the overview holds only what the site opens and the key may find", async () => {
    const { text } = await call(wrap(), "getSchemaInfo", {}, keySettings(allFlags));

    expect(text).toContain("posts");
    expect(text).toContain("site-settings");
    expect(text).not.toContain("team-members");
    expect(text).not.toContain("orders");
  });

  it("a key without the find flag of a collection does not see it", async () => {
    const settings = keySettings({ siteSettings: { find: true }, posts: { find: false } });
    const overview = await call(wrap(), "getSchemaInfo", {}, settings);
    const list = await call(wrap(), "listDocuments", { collection: "posts" }, settings);

    expect(overview.text).not.toContain("posts");
    expect(JSON.parse(list.text).error).toMatch(/posts/u);
    expect(list.req.payload.find).not.toHaveBeenCalled();
  });

  it("a key that can read nothing is told who changes that", async () => {
    const { text } = await call(wrap(), "getSchemaInfo", {}, keySettings({}));

    expect(text).toMatch(/find permission/u);
  });

  it("reads through the Local API as the user of the key, with access control on", async () => {
    const { req, text } = await call(
      wrap(),
      "listDocuments",
      { collection: "posts" },
      keySettings(allFlags)
    );

    expect(JSON.parse(text).ids).toEqual([1]);
    expect(req.payload.find).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "posts", overrideAccess: false, user: { id: 7 } })
    );
  });

  it("reads a document and a global", async () => {
    const doc = await call(
      wrap(),
      "readDocument",
      { collection: "posts", id: 1 },
      keySettings(allFlags)
    );
    const global = await call(
      wrap(),
      "readDocument",
      { global: "site-settings" },
      keySettings(allFlags)
    );

    expect(JSON.parse(doc.text).doc.title).toBe("First");
    expect(JSON.parse(global.text).doc.siteName).toBe("Site");
  });

  it("an id that reads nothing names the tools of the layer", async () => {
    const wrapped = wrap();
    const req = request();

    req.payload.findByID = vi.fn(async () => null);
    await wrapped.overrideAuth(req, async () => keySettings(allFlags));
    const result = await wrapped.mcp.tools
      .find((tool) => tool.name === "readDocument")
      .handler({ collection: "posts", id: 99 }, req, {});

    expect(JSON.parse(result.content[0].text).error).toBe(
      "posts/99 not found. Take the id from a listDocuments or lookupDocuments result."
    );
  });

  it("finds a document by name and a text in the content", async () => {
    const byName = await call(wrap(), "lookupDocuments", { query: "First" }, keySettings(allFlags));
    const req = request();
    const wrapped = wrap();

    req.payload.find = vi.fn(async () => ({
      docs: [{ id: 1, title: "First", body: "A text with a needle in it" }],
      totalPages: 1,
      totalDocs: 1,
    }));
    await wrapped.overrideAuth(req, async () => keySettings(allFlags));
    const search = await wrapped.mcp.tools
      .find((tool) => tool.name === "searchContent")
      .handler({ collection: "posts", query: "needle" }, req, {});

    expect(JSON.parse(byName.text).docs[0]).toMatchObject({ collection: "posts", id: 1 });
    expect(JSON.parse(search.content[0].text).matchedIds).toEqual([1]);
  });

  it("checks the links of a collection", async () => {
    const req = request();
    const wrapped = wrap();

    req.payload.find = vi.fn(async () => ({
      docs: [{ id: 1, title: "First", body: "See [the page](/nowhere-at-all)." }],
      totalPages: 1,
      totalDocs: 1,
    }));
    await wrapped.overrideAuth(req, async () => keySettings(allFlags));
    const checked = await wrapped.mcp.tools
      .find((tool) => tool.name === "checkLinks")
      .handler({ collection: "posts" }, req, {});

    expect(JSON.parse(checked.content[0].text)).toMatchObject({ documents: 1, links: 1 });
  });
});

describe("the MCP layer: the access settings of the request", () => {
  it("runs the overrideAuth of the site and returns its settings unchanged", async () => {
    const settings = keySettings({ posts: { find: true } });
    const siteAuth = vi.fn(async () => settings);
    const wrapped = wrap({ ...hostOptions(), overrideAuth: siteAuth });
    const req = request();
    const getDefault = vi.fn();

    expect(await wrapped.overrideAuth(req, getDefault)).toBe(settings);
    expect(siteAuth).toHaveBeenCalledWith(req, getDefault);
    expect(getDefault).not.toHaveBeenCalled();
  });

  it("a request without settings gets an error that names the fix", async () => {
    const { text, req } = await call(wrap(), "listDocuments", { collection: "posts" }, null);

    expect(JSON.parse(text).error).toMatch(/withContentAgent/u);
    expect(req.payload.find).not.toHaveBeenCalled();
  });
});

describe("the MCP layer: the instructions of the server", () => {
  it("names every tool of the layer and the tool to start with", () => {
    for (const tool of LAYER_TOOLS) expect(LAYER_INSTRUCTIONS).toContain(tool.name);
    expect(LAYER_INSTRUCTIONS).toContain(`Start with ${LAYER_TOOLS[0].name}`);
  });

  it("hands the instructions to the MCP server", () => {
    expect(wrap().mcp.serverOptions.instructions).toBe(LAYER_INSTRUCTIONS);
  });

  it("keeps the instructions and the server info of the site", () => {
    const serverInfo = { name: "site" };
    const { serverOptions } = wrap({
      ...hostOptions(),
      mcp: { serverOptions: { instructions: "Site rules.", serverInfo } },
    }).mcp;

    expect(serverOptions.instructions).toBe(`Site rules.\n\n${LAYER_INSTRUCTIONS}`);
    expect(serverOptions.serverInfo).toBe(serverInfo);
  });
});
