import { describe, it, expect, vi, afterEach } from "vitest";
import { runAgent } from "../src/agent/index.js";
import { createEditRecorder } from "../src/agent/tools/index.js";
import * as toolsIndex from "../src/agent/tools/index.js";
import * as systemPrompt from "../src/agent/systemPrompt.js";
import * as mcpClient from "../src/agent/mcpClient.js";
import type { SchemaContext } from "../src/types.js";
import { asSchema } from "ai";
import { checkModules, moduleMigrations } from "../src/moduleHost.js";
import { PAID_TERMS } from "./paidTerms.js";
import { pluginOptions } from "./harness.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const schema: SchemaContext = {
  globals: [],
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
};

describe("free build - config", () => {
  it("runs only the core migrations", () => {
    expect(moduleMigrations(checkModules(undefined))).toEqual([]);
  });
});

const memory = (): any => ({
  db: { query: vi.fn() },
  telemetry: null,
  changesets: { record: vi.fn(async () => undefined) },
  conversations: {
    touch: async () => {},
    findById: async () => null,
    findOrCreate: async () => ({ userId: "1" }),
  },
  saveMessage: async () => {},
  assembleContext: async () => ({ temporalView: [], backgroundReports: [] }),
  getSystemPromptAdditions: () => "",
  getContextMessages: () => [],
});

describe("free build - chat turn", () => {
  const user = { id: 1, collection: "users" };
  const payload: any = { config: { serverURL: "http://localhost:3000", admin: { user: "users" } } };
  const messages: any = [
    { id: "m", role: "user", parts: [{ type: "text", text: "what did I work on last month?" }] },
  ];

  async function turn() {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(mcpClient, "getMcpTools").mockResolvedValue({});
    const tools = vi.spyOn(toolsIndex, "createTools");
    const prompt = vi.spyOn(systemPrompt, "buildSystemPrompt");

    await runAgent({
      messages,
      payload,
      user: user as any,
      schema,
      options: pluginOptions({ modules: [] }),
      memory: memory(),
      conversationId: "c-1",
    });
    const toolObjects = tools.mock.results[0].value as Record<string, any>;
    const result = {
      toolObjects,
      prompt: prompt.mock.results[0].value as { stable: string; volatile: string },
    };

    vi.restoreAllMocks();

    return result;
  }

  it("tells the model nothing about paid features: not in the prompt, not in any tool", async () => {
    const free = await turn();
    const offending: string[] = [];

    if (PAID_TERMS.test(free.prompt.stable + free.prompt.volatile)) offending.push("system prompt");

    for (const [name, t] of Object.entries(free.toolObjects)) {
      const input = t.inputSchema ? JSON.stringify(await asSchema(t.inputSchema).jsonSchema) : "";

      if (PAID_TERMS.test(`${name}\n${t.description ?? ""}\n${input}`))
        offending.push(`tool ${name}`);
    }

    expect(offending).toEqual([]);
  });

  it("still sends every agent write to the review panel and the write count", () => {
    const mem = memory();
    const writeTracker = { count: 0 };
    const record = createEditRecorder({
      memory: mem,
      conversationId: "c-1",
      userId: "1",
      schema,
      writeTracker,
      modules: [],
    });

    record([{ collection: "posts", docId: "7", fields: ["title"], toolCallId: "t1" } as any]);
    expect(writeTracker.count).toBe(1);
    expect(mem.changesets.record).toHaveBeenCalledWith("c-1", [
      { collection: "posts", docId: "7", fields: ["title"], toolCallId: "t1" },
    ]);
  });
});
