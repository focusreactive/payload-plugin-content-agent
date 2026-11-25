import { vi } from "vitest";
import type { LanguageModel } from "ai";
import { runAgent } from "../src/agent/index.js";
import type { ResolvedPluginOptions, SchemaContext } from "../src/types.js";

/**
 * Resolved plugin options with every required field, for a test that builds tools or a turn.
 * The values are the defaults of src/plugin/runtime.ts, except `imageInput`, which is off so a
 * tool list has no viewImage unless the test asks for it.
 */
export function pluginOptions(
  overrides: Partial<ResolvedPluginOptions> = {}
): ResolvedPluginOptions {
  const base: ResolvedPluginOptions = {
    model: {} as LanguageModel,
    subagentModel: {} as LanguageModel,
    bulkConcurrency: 5,
    findReplaceConcurrency: 10,
    bulkTimeBudgetMs: 180_000,
    turnTokenBudget: 3_000_000,
    mcpApiKey: "x",
    mcpUrl: "/api/mcp",
    apiRoute: "/content-agent/chat",
    schemaPromptMode: "auto",
    modules: [],
    mcpOnly: false,
    imageInput: false,
    ltmCurator: false,
    telemetry: "usage",
    reasoningEffort: "none",
  };

  return { ...base, ...overrides };
}

/** The memory of a turn: one conversation "c-1", no history, every write recorded. */
export const fakeMemory = (): any => ({
  db: { query: vi.fn() },
  telemetry: null,
  changesets: { record: vi.fn(async () => undefined) },
  conversations: {
    touch: async () => {},
    findById: async () => ({ id: "c-1", title: "set" }),
    findOrCreate: async () => ({ userId: "1" }),
    updateTitle: async () => {},
  },
  saveMessage: vi.fn(async (..._args: unknown[]) => {}),
  assembleContext: async () => ({ temporalView: [], backgroundReports: [] }),
  getSystemPromptAdditions: () => "",
  getContextMessages: () => [],
  runBackgroundTasks: async () => {},
});

interface Turn {
  messages: unknown[];
  schema: SchemaContext;
  memory?: unknown;
  options?: Partial<ResolvedPluginOptions>;
}

/** Runs one chat turn of user 1 in conversation "c-1" and gives the streamed body. */
export async function turnBody({ messages, schema, memory, options }: Turn): Promise<string> {
  const response = await runAgent({
    messages: messages as never,
    payload: {
      secret: "test-secret",
      config: { serverURL: "http://localhost:3000", admin: { user: "users" } },
    } as never,
    user: { id: 1, collection: "users" } as never,
    schema,
    options: pluginOptions(options),
    memory: (memory ?? fakeMemory()) as never,
    conversationId: "c-1",
  });

  return response.text();
}

/** The events of a streamed body, in order. */
export const streamEvents = (body: string): any[] =>
  body
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
