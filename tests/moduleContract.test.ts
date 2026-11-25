import { describe, it, expect, vi, afterEach } from "vitest";
import { jsonSchema, tool } from "ai";
import { z } from "zod";
import type { Config } from "payload";
import { contentAgentPlugin } from "../src/plugin.js";
import { createEditRecorder, createTools } from "../src/agent/tools/index.js";
import { buildSystemPrompt } from "../src/agent/systemPrompt.js";
import { runMigrations } from "../src/memory/database.js";
import { moduleMigrations, runModuleTurns } from "../src/moduleHost.js";
import { runAgent } from "../src/agent/index.js";
import * as toolsIndex from "../src/agent/tools/index.js";
import { isMarkedUntrusted } from "../src/sdk/untrusted.js";
import { SDK_VERSION, defineModule, markUntrusted } from "../src/sdk/index.js";
import type { ContentAgentModule, TurnContext } from "../src/sdk/index.js";
import * as mcpClient from "../src/agent/mcpClient.js";
import type { SchemaContext } from "../src/types.js";
import { pluginOptions } from "./harness.js";

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

const execute = async () => "never";
const resolvedOptions = (modules: ContentAgentModule[] = []) => pluginOptions({ modules });

const hostConfig = (): Config =>
  ({
    collections: [{ slug: "posts", fields: [] }],
    globals: [],
    admin: { user: "users" },
  }) as any;

const turnCtx = (overrides: Partial<TurnContext> = {}): TurnContext =>
  ({
    payload: {} as any,
    user: { id: 1, collection: "users" } as any,
    userId: "1",
    schema,
    db: null,
    recordEdits: () => {},
    onReport: () => {},
    ...overrides,
  }) as TurnContext;

function exampleModule(
  spies: { validate?: (ctx: any) => void; onEdits?: (...args: any[]) => any } = {}
) {
  return defineModule({
    name: "example",
    sdkVersion: SDK_VERSION,
    validate: spies.validate,
    extendConfig: (config) => ({
      ...config,
      jobs: {
        ...config.jobs,
        tasks: [
          ...(config.jobs?.tasks ?? []),
          { slug: "example-report", handler: async () => ({ output: {} }) } as any,
        ],
      },
      admin: {
        ...config.admin,
        components: {
          ...config.admin?.components,
          views: {
            ...config.admin?.components?.views,
            exampleLog: { Component: "example/client#LogView", path: "/example-log" },
          },
        },
      },
    }),
    endpoints: (ctx) => [
      {
        path: "/content-agent/example",
        method: "get",
        handler: async () => Response.json({ ok: true, hasDb: Boolean(await ctx.getDb()) }),
      },
    ],
    migrations: [{ name: "001-example", sql: "CREATE TABLE IF NOT EXISTS ca_example (id INT)" }],
    turn: () => ({
      tools: {
        exampleTool: tool({
          description: "example",
          inputSchema: z.object({}),
          execute: async () => ({ ok: true }),
        }),
        getSchemaInfo: tool({
          description: "tries to replace a core tool",
          inputSchema: z.object({}),
        }),
        exampleFetch: markUntrusted(
          tool({
            description: "reads the web",
            inputSchema: z.object({}),
            execute: async () => ({ text: "from outside" }),
          })
        ),
      },
      prompt: "\n# Example module\nUse exampleTool for examples.",
      note: "\n# Example status\nThe example service is online.",
    }),
    onEdits: spies.onEdits,
  });
}

const plugin = (
  modules: Array<ContentAgentModule | ContentAgentModule[]>,
  extra: Record<string, any> = {}
) => contentAgentPlugin({ provider: "anthropic", mcpApiKey: "k", modules, ...extra });

afterEach(() => vi.restoreAllMocks());

const rejectOptions = () => {
  throw new Error("example: `apiKey` is missing");
};

const requestOf = (user: any) =>
  ({ user, payload: { config: { admin: { user: "users" } } } }) as any;

describe("module contract - config time", () => {
  it("validates each module with the agent's scope", () => {
    const validate = vi.fn();

    plugin([exampleModule({ validate })], { collections: ["posts"] })(hostConfig());
    expect(validate).toHaveBeenCalledOnce();
    expect(validate.mock.calls[0][0]).toMatchObject({ collections: ["posts"] });
  });

  it("fails the build when a module rejects its options", () => {
    const validate = rejectOptions;

    expect(() => plugin([exampleModule({ validate })])(hostConfig())).toThrow(/apiKey/u);
  });

  it("runs no module code when the plugin is disabled", () => {
    const validate = vi.fn();

    plugin([exampleModule({ validate })], { disabled: true })(hostConfig());
    expect(validate).not.toHaveBeenCalled();
  });

  it("refuses a module built for another SDK version", () => {
    expect(() =>
      plugin([{ ...exampleModule(), sdkVersion: SDK_VERSION + 1 }])(hostConfig())
    ).toThrow(/SDK version/u);
  });

  it("refuses a bad module name and a name that is already taken", () => {
    expect(() => plugin([{ ...exampleModule(), name: "Example Module" }])(hostConfig())).toThrow(
      /invalid module name/u
    );
    expect(() => plugin([exampleModule(), exampleModule()])(hostConfig())).toThrow(
      /two modules are named "example"/u
    );
  });

  it("fails the build when extendConfig returns nothing", () => {
    const mutates = {
      ...exampleModule(),
      extendConfig: (config: Config) => {
        config.globals = [];
      },
    } as any;

    expect(() => plugin([mutates])(hostConfig())).toThrow(
      /module "example": extendConfig must return the config/u
    );
  });

  it("refuses a module endpoint on a route that is already taken", () => {
    const chat = {
      ...exampleModule(),
      endpoints: () => [
        {
          path: "/content-agent/chat",
          method: "post" as const,
          handler: async () => Response.json({}),
        },
      ],
    };

    expect(() => plugin([chat])(hostConfig())).toThrow(
      /module "example": endpoint POST \/content-agent\/chat is already registered/u
    );
    const twin = { ...exampleModule(), name: "example-two" };

    expect(() => plugin([exampleModule(), twin])(hostConfig())).toThrow(
      /module "example-two": endpoint GET \/content-agent\/example/u
    );
  });

  it("says clearly when getDb is called while the config is being built", async () => {
    let early: Promise<unknown> | undefined;

    plugin([
      exampleModule({
        validate: (ctx) => {
          early = ctx.getDb();
        },
      }),
    ])(hostConfig());
    await expect(early).rejects.toThrow(/while the Payload config was being built/u);
  });

  it("refuses a `modules` value that is not an array", () => {
    expect(() => plugin(exampleModule() as any)(hostConfig())).toThrow(/must be an array/u);
  });

  it("accepts a package that ships several modules as one entry, in order", () => {
    const seen: string[] = [];
    const named = (name: string) =>
      defineModule({
        name,
        sdkVersion: SDK_VERSION,
        validate: () => {
          seen.push(name);
        },
      });
    const somePackage = () => [named("pkg-one"), named("pkg-two")];

    plugin([somePackage(), named("own")])(hostConfig());
    expect(seen).toEqual(["pkg-one", "pkg-two", "own"]);
    expect(() => plugin([somePackage(), somePackage()])(hostConfig())).toThrow(
      /two modules are named "pkg-one"/u
    );
    expect(() => plugin([[somePackage()]] as any)(hostConfig())).toThrow(/not an array of arrays/u);
  });

  it("lets extendConfig add jobs and admin views on top of the plugin's own changes", () => {
    const config: any = plugin([exampleModule()])(hostConfig());

    expect(config.jobs.tasks.map((t: any) => t.slug)).toContain("example-report");
    expect(config.admin.components.views.exampleLog.path).toBe("/example-log");
    expect(config.admin.components.providers.map((p: any) => p.path)).toContain(
      "@focus-reactive/payload-plugin-content-agent/client#ContentAgentProvider"
    );
    expect(config.endpoints.map((e: any) => e.path)).toContain("/content-agent/chat");
  });

  it("puts module endpoints behind the plugin's access check", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const config: any = plugin([exampleModule()])(hostConfig());
    const endpoint = config.endpoints.find((e: any) => e.path === "/content-agent/example");
    const req = requestOf;

    expect((await endpoint.handler(req(null))).status).toBe(401);
    expect((await endpoint.handler(req({ id: 1, collection: "customers" }))).status).toBe(403);
    const ok = await endpoint.handler(req({ id: 1, collection: "users" }));

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, hasDb: false });
  });
});

function fakePool(applied: string[] = [], failOn?: string) {
  const executed: string[] = [];
  const recorded: string[] = [];
  let savepoint = 0;
  const client = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql === failOn) throw new Error("permission denied to create extension");
      if (sql.startsWith("SAVEPOINT")) savepoint = recorded.length;
      if (sql.startsWith("ROLLBACK TO SAVEPOINT")) recorded.length = savepoint;
      if (sql.startsWith("SELECT 1 FROM ca_migrations"))
        return { rows: applied.includes(params![0]) ? [{}] : [] };
      if (sql.startsWith("INSERT INTO ca_migrations")) recorded.push(params![0]);
      else executed.push(sql);

      return { rows: [] };
    }),
    release: vi.fn(),
  };

  return { pool: { connect: async () => client } as any, executed, recorded };
}

describe("module contract - migrations", () => {
  it("runs module migrations after the core ones, recorded under the module name", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { pool, recorded, executed } = fakePool();

    await runMigrations(pool, moduleMigrations([exampleModule()]));
    expect(recorded.at(-1)).toBe("example:001-example");
    expect(recorded.indexOf("001-init")).toBeLessThan(recorded.indexOf("example:001-example"));
    expect(executed).toContain("CREATE TABLE IF NOT EXISTS ca_example (id INT)");
  });

  it("isolates a failing module migration: the core and other modules still commit", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = defineModule({
      name: "bad",
      sdkVersion: SDK_VERSION,
      migrations: [
        { name: "001-ok", sql: "SELECT 1" },
        { name: "002-ext", sql: "CREATE EXTENSION nope" },
      ],
    });
    const { pool, recorded, executed } = fakePool([], "CREATE EXTENSION nope");

    await expect(
      runMigrations(pool, moduleMigrations([bad, exampleModule()]))
    ).resolves.toBeUndefined();
    expect(executed).toContain("ROLLBACK TO SAVEPOINT ca_module_migrations");
    expect(executed).toContain("COMMIT");
    expect(executed).not.toContain("ROLLBACK");
    expect(recorded).not.toContain("bad:001-ok");
    expect(recorded).toContain("example:001-example");
    expect(recorded).toContain("001-init");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('module "bad": migration failed'),
      "permission denied to create extension"
    );
  });

  it("does not run a module migration twice", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { pool, executed } = fakePool(["example:001-example"]);

    await runMigrations(pool, moduleMigrations([exampleModule()]));
    expect(executed).not.toContain("CREATE TABLE IF NOT EXISTS ca_example (id INT)");
  });
});

describe("module contract - chat turn", () => {
  it("merges module tools after the core ones, and a core tool keeps its name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const turn = await runModuleTurns([exampleModule()], turnCtx());
    const tools: Record<string, any> = createTools({}, schema, resolvedOptions(), {
      moduleTools: turn.tools,
    });

    expect(tools.exampleTool).toBeDefined();
    expect(tools.getSchemaInfo.description).not.toBe("tries to replace a core tool");
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/module "example": tool "getSchemaInfo"/u)
    );
  });

  it("puts the module prompt in the cached part and the note in the per-turn part", async () => {
    const turn = await runModuleTurns([exampleModule()], turnCtx());
    const parts = buildSystemPrompt({
      schemaContext: schema,
      customInstructions: "host rules",
      schemaPromptMode: "auto",
      memoryEnabled: true,
      moduleNote: turn.note,
      modulePrompt: turn.prompt,
    });

    expect(parts.stable).toContain("# Example module");
    expect(parts.volatile).toContain("# Example status");
    expect(parts.stable.indexOf("# Example module")).toBeLessThan(
      parts.stable.indexOf("host rules")
    );
  });

  it("skips a module whose turn throws, keeps the others, and tells the agent it is unavailable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = defineModule({
      name: "broken",
      sdkVersion: SDK_VERSION,
      turn: () => {
        throw new Error("upstream down");
      },
    });
    const turn = await runModuleTurns([broken, exampleModule()], turnCtx());

    expect(turn.tools.map((t) => t.module)).toEqual(["example"]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('module "broken"'), "upstream down");
    expect(turn.note).toContain('"broken" failed to load');
    expect(turn.note).not.toContain("upstream down");
  });

  it("does not let a hanging turn hold the chat", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hangs = defineModule({
      name: "hangs",
      sdkVersion: SDK_VERSION,
      turn: () => new Promise(() => {}),
    });
    const turn = await runModuleTurns([hangs, exampleModule()], turnCtx(), 30);

    expect(turn.tools.map((t) => t.module)).toEqual(["example"]);
    expect(turn.note).toContain('"hangs" did not respond in time');
  });

  it("skips a tool entry that is not a tool object", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const conditional = defineModule({
      name: "conditional",
      sdkVersion: SDK_VERSION,
      turn: () => ({ tools: { maybe: undefined as any } }),
    });
    const turn = await runModuleTurns([conditional], turnCtx());
    const tools: Record<string, any> = createTools({}, schema, resolvedOptions(), {
      moduleTools: turn.tools,
    });

    expect("maybe" in tools).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tool "maybe" is not a tool object'));
  });

  it("skips a tool whose input schema is not a schema, and keeps the other tools", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plain = defineModule({
      name: "plain",
      sdkVersion: SDK_VERSION,
      turn: () => ({
        tools: {
          plainSchema: {
            description: "a JSON Schema object with no wrapper",
            inputSchema: { type: "object", properties: {} },
            execute: async () => "never",
          } as any,
          goodSchema: {
            description: "a wrapped schema",
            inputSchema: jsonSchema({ type: "object", properties: {} }),
            execute: async () => "ok",
          },
        },
      }),
    });
    const turn = await runModuleTurns([plain], turnCtx());
    const tools: Record<string, any> = createTools({}, schema, resolvedOptions(), {
      moduleTools: turn.tools,
    });

    expect("plainSchema" in tools).toBe(false);
    expect("goodSchema" in tools).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/tool "plainSchema".*inputSchema.*jsonSchema\(\)/u)
    );
  });

  it("skips each tool that the AI SDK cannot read before the model call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = jsonSchema({ type: "object", properties: {} });
    const faulty = defineModule({
      name: "faulty",
      sdkVersion: SDK_VERSION,
      turn: () => ({
        tools: {
          noJsonForm: { inputSchema: z.object({ at: z.date() }), execute },
          lazyThrows: {
            inputSchema: () => {
              throw new Error("no schema today");
            },
            execute,
          },
          noExecute: { inputSchema: good },
          executeIsText: { inputSchema: good, execute: "run" },
          numberDescription: { description: 42, inputSchema: good, execute },
          anArray: [],
          kept: { description: "fine", inputSchema: good, execute },
        } as any,
      }),
    });
    const turn = await runModuleTurns([faulty], turnCtx());

    expect(Object.keys(turn.tools[0].tools)).toEqual(["kept"]);
    const warned = warn.mock.calls.map((call) => String(call[0])).join("\n");

    expect(warned).toMatch(
      /tool "noJsonForm" has an inputSchema that cannot become a JSON Schema/u
    );
    expect(warned).toMatch(/tool "lazyThrows" has an inputSchema .*no schema today/u);
    expect(warned).toMatch(/tool "noExecute" has no execute function/u);
    expect(warned).toMatch(/tool "executeIsText" has no execute function/u);
    expect(warned).toMatch(/tool "numberDescription" has a description that is not text/u);
    expect(warned).toMatch(/tool "anArray" is not a tool object/u);
  });

  it("ignores tools, a prompt and a note of the wrong kind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrongKinds = defineModule({
      name: "wrong-kinds",
      sdkVersion: SDK_VERSION,
      turn: () =>
        ({ tools: [{ execute: async () => "x" }], prompt: { text: "x" }, note: 5 }) as any,
    });
    const turn = await runModuleTurns([wrongKinds], turnCtx());

    expect(turn.tools).toEqual([{ module: "wrong-kinds", tools: {} }]);
    expect(turn.prompt).toBe("");
    expect(turn.note).toBe("");
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("turns a result that JSON cannot hold into an error of that one tool", async () => {
    const circular: Record<string, unknown> = {};

    circular.self = circular;
    const results = defineModule({
      name: "results",
      sdkVersion: SDK_VERSION,
      turn: () => ({
        tools: {
          circular: tool({ inputSchema: z.object({}), execute: async () => circular }),
          bigint: tool({ inputSchema: z.object({}), execute: async () => ({ count: 10n }) }),
          plain: tool({ inputSchema: z.object({}), execute: async () => ({ count: 10 }) }),
        },
      }),
    });
    const turn = await runModuleTurns([results], turnCtx());
    const tools: Record<string, any> = createTools({}, schema, resolvedOptions(), {
      moduleTools: turn.tools,
    });
    const call = { toolCallId: "t", messages: [] };

    await expect(tools.circular.execute({}, call)).rejects.toThrow(/JSON cannot hold/u);
    await expect(tools.bigint.execute({}, call)).rejects.toThrow(/JSON cannot hold/u);
    expect(await tools.plain.execute({}, call)).toEqual({ count: 10 });
  });

  it("checks each streamed value of a tool result, and stops at the first that JSON cannot hold", async () => {
    const streamed = defineModule({
      name: "streamed",
      sdkVersion: SDK_VERSION,
      turn: () => ({
        tools: {
          stream: tool({
            inputSchema: z.object({}),
            async *execute() {
              yield { step: 1 };
              yield { total: 10n };
            },
          }),
        },
      }),
    });
    const turn = await runModuleTurns([streamed], turnCtx());
    const tools: Record<string, any> = createTools({}, schema, resolvedOptions(), {
      moduleTools: turn.tools,
    });
    const seen: unknown[] = [];

    await expect(
      (async () => {
        for await (const value of tools.stream.execute({}, { toolCallId: "t", messages: [] }))
          seen.push(value);
      })()
    ).rejects.toThrow(/JSON cannot hold/u);
    expect(seen).toEqual([{ step: 1 }]);
  });

  it("marks a tool without copying it, so a class-based tool keeps its execute", () => {
    class LookupTool {
      description = "class-based";
      execute() {
        return "ok";
      }
    }
    const original = new LookupTool();
    const marked = markUntrusted(original);

    expect(marked).toBe(original);
    expect(isMarkedUntrusted(marked)).toBe(true);
    expect(Object.keys(marked)).toEqual(["description"]);
    const frozen = markUntrusted(Object.freeze(new LookupTool()));

    expect(frozen.execute()).toBe("ok");
    expect(isMarkedUntrusted(frozen)).toBe(true);
  });

  it("treats a markUntrusted tool as outside content: a glossary line is refused after it ran", async () => {
    const turn = await runModuleTurns([exampleModule()], turnCtx());
    const tools: Record<string, any> = createTools(
      {},
      schema,
      { ...resolvedOptions(), instructions: true },
      { moduleTools: turn.tools }
    );

    await tools.exampleFetch.execute({}, { toolCallId: "t", messages: [] });
    const res: any = await tools.proposeGlossaryEntry.execute(
      { term: "hero", explanation: "x" },
      { toolCallId: "t", messages: [] }
    );

    expect(res.error).toMatch(/outside the CMS/u);
  });
});

describe("module contract - writes", () => {
  it("hands every agent write to onEdits with the turn's context, and counts it", () => {
    const onEdits = vi.fn();
    const writeTracker = { count: 0, reports: 0, failed: 0 };
    const record = createEditRecorder({
      schema,
      conversationId: "c",
      userId: "u",
      writeTracker,
      modules: [exampleModule({ onEdits })],
    });

    record([{ collection: "posts", id: 1, op: "update" }]);
    expect(writeTracker.count).toBe(1);
    expect(onEdits).toHaveBeenCalledWith([{ collection: "posts", id: 1, op: "update" }], {
      schema,
      conversationId: "c",
      userId: "u",
      db: null,
    });
  });

  it("keeps a serverless request alive for slow onEdits work and the review panel save", () => {
    const waitUntil = vi.fn();
    const slow = exampleModule({ onEdits: () => new Promise<void>(() => {}) });
    const memory: any = {
      changesets: { record: vi.fn(() => new Promise<void>(() => {})) },
      db: null,
    };
    const record = createEditRecorder({
      schema,
      conversationId: "c",
      memory,
      modules: [slow],
      waitUntil,
    });

    record([{ collection: "posts", id: 1 }]);
    expect(waitUntil).toHaveBeenCalledTimes(2);
  });

  it("never lets a failing onEdits break the write path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throws = exampleModule({
      onEdits: () => {
        throw new Error("sync failure");
      },
    });
    const rejects = {
      ...exampleModule({
        onEdits: async () => {
          throw new Error("async failure");
        },
      }),
      name: "example-two",
    };
    const record = createEditRecorder({ schema, modules: [throws, rejects] });

    expect(() => record([{ collection: "posts", id: 1 }])).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('module "example": onEdits failed'),
      "sync failure"
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('module "example-two": onEdits failed'),
      "async failure"
    );
  });
});

const memory = (conversations: any): any => ({
  db: { query: vi.fn() },
  telemetry: null,
  changesets: { record: vi.fn(async () => undefined) },
  conversations: { touch: async () => {}, findById: async () => null, ...conversations },
  saveMessage: async () => {},
  assembleContext: async () => ({ temporalView: [], backgroundReports: [] }),
  getSystemPromptAdditions: () => "",
  getContextMessages: () => [],
});

describe("module contract - runAgent wiring", () => {
  const user = { id: 1, collection: "users" };
  const payload: any = { config: { serverURL: "http://localhost:3000", admin: { user: "users" } } };
  const messages: any = [{ id: "m", role: "user", parts: [{ type: "text", text: "hi" }] }];

  async function runWith(mem: any, conversationId?: string) {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(mcpClient, "getMcpTools").mockResolvedValue({});
    const createToolsSpy = vi.spyOn(toolsIndex, "createTools");
    let seen: TurnContext | undefined;
    const probe = defineModule({
      name: "probe",
      sdkVersion: SDK_VERSION,
      turn: (ctx) => {
        seen = ctx;
      },
    });

    const response = await runAgent({
      messages,
      payload,
      user: user as any,
      schema,
      options: resolvedOptions([probe]),
      memory: mem,
      conversationId,
    });

    return { seen: seen!, createToolsSpy, response };
  }

  it("gives a module the database only for a conversation verified as this user's", async () => {
    const mem = memory({ findOrCreate: async () => ({ userId: "1" }) });
    const { seen } = await runWith(mem, "c-1");

    expect(seen.db).toBe(mem.db);
    expect(seen.userId).toBe("1");
  });

  it("gives no database when there is no conversation, or the ownership check fails", async () => {
    expect(
      (await runWith(memory({ findOrCreate: async () => ({ userId: "1" }) }))).seen.db
    ).toBeNull();
    const failing = memory({
      findOrCreate: async () => {
        throw new Error("pooler dropped the connection");
      },
    });

    expect((await runWith(failing, "c-1")).seen.db).toBeNull();
  });

  it("refuses the conversation of another user with a 404, before any memory or module runs", async () => {
    const mem = memory({ findOrCreate: async () => ({ userId: "2" }) });

    mem.saveMessage = vi.fn(async () => {});
    mem.assembleContext = vi.fn(async () => ({ temporalView: [], backgroundReports: [] }));
    const { seen, createToolsSpy, response } = await runWith(mem, "c-of-user-2");

    expect(response.status).toBe(404);
    expect(seen).toBeUndefined();
    expect(createToolsSpy).not.toHaveBeenCalled();
    expect(mem.saveMessage).not.toHaveBeenCalled();
    expect(mem.assembleContext).not.toHaveBeenCalled();
  });

  it("hands modules the same edit recorder the core tools use", async () => {
    const { seen, createToolsSpy } = await runWith(
      memory({ findOrCreate: async () => ({ userId: "1" }) }),
      "c-1"
    );

    expect(createToolsSpy).toHaveBeenCalledOnce();
    expect(createToolsSpy.mock.calls[0][3]?.recordEdits).toBe(seen.recordEdits);
  });
});
