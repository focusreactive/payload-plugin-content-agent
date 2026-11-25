import { beforeAll, describe, expect, it, vi } from "vitest";
import { sanitizeConfig } from "payload";
import { mcpPlugin } from "@payloadcms/plugin-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { withContentAgent } from "../src/mcpLayer/index.js";
import { LAYER_TOOLS } from "../src/mcpLayer/tools.js";
import { chatMcpHeaders } from "../src/agent/mcpClient.js";
import { chatKeyCheck } from "../src/plugin/shared.js";

const collections = [
  {
    slug: "posts",
    timestamps: true,
    versions: { drafts: true },
    fields: [{ name: "title", type: "text" }],
  },
  { slug: "team-members", timestamps: true, fields: [{ name: "name", type: "text" }] },
];
const globals = [
  {
    slug: "site-settings",
    versions: { drafts: true },
    fields: [{ name: "siteName", type: "text" }],
  },
];

const hostOptions = () => ({
  collections: { posts: { enabled: true }, "team-members": { enabled: true } },
  globals: { "site-settings": { enabled: true } },
});

const toolFlags = Object.fromEntries(LAYER_TOOLS.map((tool) => [tool.name, true]));
const everything = { find: true, create: true, update: true, delete: true };

const keySettings = () => ({
  id: 3,
  label: "Outside agent",
  user: { id: 7 },
  posts: { ...everything },
  teamMembers: { ...everything },
  siteSettings: { find: true, update: true },
  "payload-mcp-tool": { ...toolFlags },
});

const layerNames = LAYER_TOOLS.map((tool) => tool.name);

let config: any;

beforeAll(async () => {
  config = await sanitizeConfig({
    secret: "x",
    db: { defaultIDType: "number", init: () => ({}) },
    editor: lexicalEditor({}),
    collections,
    globals,
  } as any);
});

// What the plugin shares on a site whose chat uses the key "key".
const shared = {
  getMemory: async () => null,
  getModules: () => [],
  isChatKey: chatKeyCheck("key"),
};

function request() {
  const payload = {
    config: { ...config, custom: { contentAgent: shared } },
    db: { defaultIDType: "number" },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    find: vi.fn(async () => ({ docs: [{ id: 1, title: "First" }], totalPages: 1, totalDocs: 1 })),
    findByID: vi.fn(async ({ id }: any) => ({ id, title: "First", _status: "draft" })),
    update: vi.fn(async ({ id, data }: any) => ({ id, title: "First", ...data })),
  };

  return { payload, user: { id: 7 } } as any;
}

const wrap = (layerOptions?: Record<string, unknown>) =>
  (withContentAgent as any)(hostOptions(), layerOptions);

async function settingsFor(layerOptions?: Record<string, unknown>) {
  const real = keySettings();
  const req = request();
  const wrapped = wrap(layerOptions);
  const returned = await wrapped.overrideAuth(req, async () => real);

  return { real, returned, req, wrapped };
}

describe("the MCP layer: the default tools option, what the MCP plugin gets", () => {
  it("without the option the plugin gets the settings of the key unchanged", async () => {
    const { real, returned } = await settingsFor();

    expect(returned).toBe(real);
  });

  it('"all" is the same as no option', async () => {
    const { real, returned } = await settingsFor({ defaultTools: "all" });

    expect(returned).toBe(real);
  });

  it('"none" turns every operation of every collection and global off', async () => {
    const { returned } = await settingsFor({ defaultTools: "none" });
    const off = { find: false, create: false, update: false, delete: false };

    expect(returned.posts).toEqual(off);
    expect(returned.teamMembers).toEqual(off);
    expect(returned.siteSettings).toEqual({ find: false, update: false });
  });

  it('"read" keeps the find flag and turns the write flags off', async () => {
    const { returned } = await settingsFor({ defaultTools: "read" });

    expect(returned.posts).toEqual({ find: true, create: false, update: false, delete: false });
    expect(returned.siteSettings).toEqual({ find: true, update: false });
  });

  it("keeps the user, the key and the flags of the site's own MCP tools", async () => {
    const { real, returned } = await settingsFor({ defaultTools: "none" });

    expect(returned.user).toBe(real.user);
    expect(returned.id).toBe(3);
    expect(returned.label).toBe("Outside agent");
    expect(returned["payload-mcp-tool"]).toEqual(toolFlags);
  });

  it("does not change the settings object of the site", async () => {
    const { real } = await settingsFor({ defaultTools: "none" });

    expect(real).toEqual(keySettings());
  });

  it("refuses a value it does not know and names the valid ones", () => {
    expect(() => wrap({ defaultTools: "off" })).toThrow(/"all", "read", "none"/u);
  });
});

async function chatSettings(layerOptions?: Record<string, unknown>) {
  const real = keySettings();
  const req = {
    ...request(),
    payloadAPI: "MCP",
    headers: new Headers(chatMcpHeaders("key")),
  };
  const returned = await wrap(layerOptions).overrideAuth(req, async () => real);

  return { real, returned };
}

describe("the MCP layer: a request of the chat of the content agent", () => {
  const off = Object.fromEntries(layerNames.map((name) => [name, false]));

  it("turns the content tools off, the chat has its own", async () => {
    const { returned } = await chatSettings();

    expect(returned["payload-mcp-tool"]).toEqual(off);
  });

  it("keeps the default tools and another custom tool of the site", async () => {
    const real = { ...keySettings(), "payload-mcp-tool": { ...toolFlags, siteTool: true } };
    const req = { ...request(), payloadAPI: "MCP", headers: new Headers(chatMcpHeaders("key")) };
    const returned = await wrap().overrideAuth(req, async () => real);

    expect(returned.posts).toEqual(everything);
    expect(returned["payload-mcp-tool"]).toEqual({ ...off, siteTool: true });
  });

  it("does not change the settings object of the site", async () => {
    const { real } = await chatSettings();

    expect(real).toEqual(keySettings());
  });

  it("a client that sends the mark of the chat with another key keeps the content tools", async () => {
    const real = keySettings();
    const req = {
      ...request(),
      payloadAPI: "MCP",
      headers: new Headers(chatMcpHeaders("another key")),
    };
    const returned = await wrap().overrideAuth(req, async () => real);

    expect(returned).toBe(real);
  });

  it("another client of the endpoint keeps the content tools", async () => {
    const real = keySettings();
    const req = { ...request(), payloadAPI: "MCP", headers: new Headers() };
    const returned = await wrap().overrideAuth(req, async () => real);

    expect(returned).toBe(real);
  });

  it.each(["read", "none"])('with "%s" the chat keeps every default tool', async (mode) => {
    const { returned } = await chatSettings({ defaultTools: mode });

    expect(returned.posts).toEqual(everything);
    expect(returned["payload-mcp-tool"]).toEqual(off);
  });
});

async function call(mode: string, name: string, args: Record<string, unknown>) {
  const { req, wrapped } = await settingsFor({ defaultTools: mode });
  const tool = wrapped.mcp.tools.find((candidate: any) => candidate.name === name);
  const result = await tool.handler(args, req, {});

  return { req, out: JSON.parse(result.content[0].text) };
}

describe("the MCP layer: the default tools option, what the content tools still do", () => {
  it.each(["none", "read"])(
    'with "%s" a content tool reads with the find flag of the key',
    async (mode) => {
      const { req, out } = await call(mode, "listDocuments", { collection: "posts" });

      expect(out.error).toBeUndefined();
      expect(req.payload.find).toHaveBeenCalledWith(
        expect.objectContaining({ collection: "posts", overrideAccess: false })
      );
    }
  );

  it.each(["none", "read"])(
    'with "%s" a content tool writes a draft with the update flag of the key',
    async (mode) => {
      const { req, out } = await call(mode, "patchDocument", {
        collection: "posts",
        id: 1,
        data: { title: "Second" },
      });

      expect(out.error).toBeUndefined();
      expect(req.payload.update).toHaveBeenCalledWith(
        expect.objectContaining({ collection: "posts", draft: true, overrideAccess: false })
      );
    }
  );
});

const instructions = (mode?: string): string =>
  wrap(mode ? { defaultTools: mode } : undefined).mcp.serverOptions.instructions;

describe("the MCP layer: the default tools option, the instructions of the server", () => {
  it("names the default tools only when the endpoint has them", () => {
    expect(instructions()).toMatch(/default tools/u);
    expect(instructions("read")).toMatch(/default tools/u);
    expect(instructions("none")).not.toMatch(/default/u);
  });

  it("does not send a write to a default tool that the endpoint does not have", () => {
    expect(instructions()).toMatch(/Use the default tools for/u);
    expect(instructions("read")).not.toMatch(/Use the default tools for/u);
  });

  it.each([undefined, "read", "none"])("names every content tool (%s)", (mode) => {
    for (const name of layerNames) expect(instructions(mode)).toContain(name);
  });
});

async function toolsOf(
  layerOptions?: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<string[]> {
  const options = (withContentAgent as any)(
    { ...hostOptions(), overrideAuth: async () => keySettings() },
    layerOptions
  );
  const site: any = await mcpPlugin(options)({ collections: [], endpoints: [] } as never);
  const { handler } = site.endpoints.find(
    (endpoint: any) => endpoint.path === "/mcp" && endpoint.method === "post"
  );
  const { payload } = request();
  const transport = new StreamableHTTPClientTransport(new URL("http://site.test/api/mcp"), {
    requestInit: { headers },
    fetch: (url, init = {}) =>
      handler({
        payload,
        url: String(url),
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        body: init.body,
      }),
  });
  const client = new Client({ name: "test", version: "1" });

  await client.connect(transport);
  const { tools } = await client.listTools();

  await client.close();

  return tools.map((tool) => tool.name);
}

const ofThePlugin = (names: string[]) => names.filter((name) => !layerNames.includes(name));

describe("the MCP layer: the default tools option, on the handler of the MCP plugin", () => {
  it("without the option the endpoint has the default tools and the content tools", async () => {
    const names = await toolsOf();

    expect(names).toEqual(expect.arrayContaining(layerNames));
    expect(ofThePlugin(names)).toEqual(
      expect.arrayContaining(["findPosts", "createPosts", "updatePosts", "deletePosts"])
    );
  });

  it("the chat of the content agent gets the default tools and no content tool", async () => {
    const names = await toolsOf(undefined, chatMcpHeaders("key"));

    expect(names).toEqual(expect.arrayContaining(["findPosts", "createPosts", "updatePosts"]));
    expect(names.filter((name) => layerNames.includes(name))).toEqual([]);
  });

  it.each(["read", "none"] as const)(
    'with "%s" the chat still gets the default tools and no content tool',
    async (mode) => {
      const names = await toolsOf({ defaultTools: mode }, chatMcpHeaders("key"));

      expect(names).toEqual(expect.arrayContaining(["findPosts", "createPosts", "updatePosts"]));
      expect(names.filter((name) => layerNames.includes(name))).toEqual([]);
    }
  );

  it('with "none" the endpoint has only the content tools', async () => {
    const names = await toolsOf({ defaultTools: "none" });

    expect(new Set(names)).toEqual(new Set(layerNames));
    expect(names).toHaveLength(layerNames.length);
  });

  it('with "read" the endpoint keeps the default find tools and no default write tool', async () => {
    const names = await toolsOf({ defaultTools: "read" });

    expect(names).toEqual(expect.arrayContaining(layerNames));
    expect(ofThePlugin(names).length).toBeGreaterThan(0);
    for (const name of ofThePlugin(names)) expect(name).toMatch(/^find/u);
  });
});
