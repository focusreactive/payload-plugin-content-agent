// Where a request comes from: the chat, an outside agent through MCP, or anything else.
import { describe, expect, it, vi } from "vitest";
import { mcpPlugin } from "@payloadcms/plugin-mcp";
import { requestOrigin } from "../src/sdk/index.js";
import { CHAT_REQUEST_HEADER } from "../src/requestOrigin.js";
import { chatMcpHeaders } from "../src/agent/mcpClient.js";
import { chatKeyCheck } from "../src/plugin/shared.js";

const collection = {
  slug: "posts",
  versions: { drafts: {} },
  admin: { useAsTitle: "title" },
  fields: [
    { name: "title", type: "text" },
    {
      type: "row",
      fields: [{ name: "body", type: "textarea" }],
    },
  ],
};

// What the plugin shares on a site whose chat uses the key "key".
const custom = {
  contentAgent: {
    getMemory: async () => null,
    getModules: () => [],
    isChatKey: chatKeyCheck("key"),
  },
};

const request = (payloadAPI: string, headers: Record<string, string> = {}) => ({
  payloadAPI,
  headers: new Headers(headers),
  user: { id: 7 },
  payload: { config: { collections: [collection], admin: { user: "users" }, custom } },
});

const outsideAgent = () => request("MCP");
const chat = () => request("MCP", chatMcpHeaders("key"));
const person = () => request("REST");
const layerTool = () => request("local");

describe("the origin of a request", () => {
  it("tells the chat, an outside agent and everything else apart", () => {
    expect(requestOrigin(chat() as never)).toBe("chat");
    expect(requestOrigin(outsideAgent() as never)).toBe("mcp");
    expect(requestOrigin(person() as never)).toBe("other");
    expect(requestOrigin(layerTool() as never)).toBe("other");
    expect(requestOrigin({} as never)).toBe("other");
  });

  it("the chat sends its key and the mark of the chat to the MCP endpoint", () => {
    const headers = chatMcpHeaders("secret");

    expect(headers.Authorization).toBe("Bearer secret");
    expect(headers[CHAT_REQUEST_HEADER]).toBeTruthy();
  });

  it("reads the mark that the MCP plugin itself puts on a request", async () => {
    const seen: string[] = [];
    const site: any = await mcpPlugin({
      collections: {},
      overrideAuth: (req) => {
        seen.push(requestOrigin(req));

        return { user: { id: 7 } } as never;
      },
    })({ collections: [], endpoints: [] } as never);
    const { handler } = site.endpoints.find(
      (endpoint: any) => endpoint.path === "/mcp" && endpoint.method === "post"
    );
    const call = (headers: Record<string, string>) =>
      handler({
        payload: { config: { collections: [], custom }, db: {}, logger: { info: vi.fn() } },
        url: "http://site.test/api/mcp",
        method: "POST",
        headers: new Headers({
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        }),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });

    // The plugin marks the request before it asks for the settings. The call needs no real site.
    await call({}).catch(() => {});
    await call(chatMcpHeaders("key")).catch(() => {});

    expect(seen).toEqual(["mcp", "chat"]);
  });

  it("the mark alone does not make a request a chat request", () => {
    expect(requestOrigin(request("REST", chatMcpHeaders("key")) as never)).toBe("other");
  });

  it("a client with the mark and another key is an outside agent", () => {
    expect(requestOrigin(request("MCP", chatMcpHeaders("another key")) as never)).toBe("mcp");
    expect(requestOrigin(request("MCP", { [CHAT_REQUEST_HEADER]: "1" }) as never)).toBe("mcp");
  });

  it("a client with the key of the chat and no mark is an outside agent", () => {
    expect(requestOrigin(request("MCP", { Authorization: "Bearer key" }) as never)).toBe("mcp");
  });

  it("a site without the plugin has no chat", () => {
    const req = { ...chat(), payload: { config: { collections: [collection] } } };

    expect(requestOrigin(req as never)).toBe("mcp");
  });
});
