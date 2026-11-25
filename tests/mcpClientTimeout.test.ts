import { describe, it, expect, vi, beforeEach } from "vitest";

const createMCPClient = vi.fn();

vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: (...args: any[]) => createMCPClient(...args) }));

const { getMcpToolsFrom, getMcpServerInstructions } = await import("../src/agent/mcpClient.js");

let n = 0;
const freshUrl = () => `https://mcp-${++n}.example.com/mcp`;

describe("getMcpToolsFrom timeout", () => {
  beforeEach(() => {
    createMCPClient.mockReset();
  });

  it("rejects a connection that never answers", async () => {
    createMCPClient.mockReturnValue(new Promise(() => {}));
    await expect(getMcpToolsFrom(freshUrl(), {}, "k", 20)).rejects.toThrow(
      /did not answer|timed out/u
    );
  });

  it("connects again on the next request instead of awaiting the hung one", async () => {
    const url = freshUrl();

    createMCPClient.mockReturnValueOnce(new Promise(() => {}));
    await expect(getMcpToolsFrom(url, {}, "k", 20)).rejects.toThrow();

    const tools = { findPosts: {} };

    createMCPClient.mockResolvedValueOnce({ tools: async () => tools, close: async () => {} });
    await expect(getMcpToolsFrom(url, {}, "k", 20)).resolves.toEqual(tools);
    expect(createMCPClient).toHaveBeenCalledTimes(2);
  });

  it("drops a cached client whose tool listing hangs", async () => {
    const url = freshUrl();
    let hang = false;
    const close = vi.fn(async () => {});

    createMCPClient.mockResolvedValue({
      tools: () => (hang ? new Promise(() => {}) : Promise.resolve({})),
      close,
    });
    await getMcpToolsFrom(url, {}, "k", 20);
    hang = true;
    await expect(getMcpToolsFrom(url, {}, "k", 20)).rejects.toThrow();
    expect(close).toHaveBeenCalled();
    hang = false;
    await expect(getMcpToolsFrom(url, {}, "k", 20)).resolves.toEqual({});
    expect(createMCPClient).toHaveBeenCalledTimes(2);
  });
});

describe("a server that has no tools", () => {
  beforeEach(() => {
    createMCPClient.mockReset();
  });

  it("gives an empty tool set and does not ask for the list", async () => {
    const tools = vi.fn(async () => {
      throw new Error("Server does not support tools");
    });

    createMCPClient.mockResolvedValue({
      initializeResult: { capabilities: {} },
      tools,
      close: async () => {},
    });
    await expect(getMcpToolsFrom(freshUrl(), {}, "k", 20)).resolves.toEqual({});
    expect(tools).not.toHaveBeenCalled();
  });

  it("asks for the list when the server declares tools", async () => {
    const listed = { findPosts: {} };

    createMCPClient.mockResolvedValue({
      initializeResult: { capabilities: { tools: {} } },
      tools: async () => listed,
      close: async () => {},
    });
    await expect(getMcpToolsFrom(freshUrl(), {}, "k", 20)).resolves.toEqual(listed);
  });
});

const client = (extra: Record<string, unknown> = {}) => ({
  tools: async () => ({}),
  close: vi.fn(async () => {}),
  ...extra,
});

describe("client registry: one client per URL and credential", () => {
  beforeEach(() => {
    createMCPClient.mockReset();
  });

  it("two callers of one URL with different credentials do not close each other", async () => {
    const url = freshUrl();
    const made: any[] = [];

    createMCPClient.mockImplementation(async () => {
      const c = client();

      made.push(c);

      return c;
    });
    for (const key of ["plugin-key", "module-headers", "plugin-key", "module-headers"])
      await getMcpToolsFrom(url, {}, key);
    expect(createMCPClient).toHaveBeenCalledTimes(2);
    expect(made.every((c) => c.close.mock.calls.length === 0)).toBe(true);
  });

  it("closes the least recently used client of a URL past the bound, so rotations do not pile up", async () => {
    const url = freshUrl();
    const made: any[] = [];

    createMCPClient.mockImplementation(async () => {
      const c = client();

      made.push(c);

      return c;
    });
    for (const key of ["k1", "k2", "k3", "k4"]) await getMcpToolsFrom(url, {}, key);
    await getMcpToolsFrom(url, {}, "k1");
    await getMcpToolsFrom(url, {}, "k5");
    await Promise.resolve();
    expect(made.map((c) => c.close.mock.calls.length)).toEqual([0, 1, 0, 0, 0]);
    await getMcpToolsFrom(freshUrl(), {}, "k1");
    expect(made.slice(0, 5).map((c) => c.close.mock.calls.length)).toEqual([0, 1, 0, 0, 0]);
  });

  it("reads the server instructions of the connection made with that credential", async () => {
    const url = freshUrl();

    createMCPClient
      .mockResolvedValueOnce(client({ instructions: "as the plugin" }))
      .mockResolvedValueOnce(client({ instructions: "as the module" }));
    await getMcpToolsFrom(url, {}, "plugin-key");
    await getMcpToolsFrom(url, {}, "module-headers");
    expect(await getMcpServerInstructions(url, "plugin-key")).toBe("as the plugin");
    expect(await getMcpServerInstructions(url, "module-headers")).toBe("as the module");
    expect(await getMcpServerInstructions(url, "never-connected")).toBeUndefined();
  });
});
