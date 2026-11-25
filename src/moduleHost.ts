import type {
  ContentAgentModule,
  EditsContext,
  ModuleMigration,
  TurnContext,
} from "./sdk/contract.js";
import { SDK_VERSION } from "./sdk/contract.js";
import { isMarkedUntrusted } from "./sdk/untrusted.js";
import { asSchema } from "ai";
import type { ToolSet } from "ai";
import type { EditRecordRef } from "./types.js";
import { caught } from "./promises.js";

const MODULE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const errorText = (err: unknown) => (err instanceof Error ? err.message : err);

export function checkModules(hostModules: unknown): ContentAgentModule[] {
  if (hostModules !== undefined && !Array.isArray(hostModules)) {
    throw new Error("[Content Agent] `modules` must be an array of modules.");
  }

  const modules = ((hostModules as unknown[] | undefined) ?? []).flatMap((entry) => {
    if (!Array.isArray(entry)) return [entry];

    if (entry.some(Array.isArray)) {
      throw new Error(
        "[Content Agent] `modules`: an entry is a module or an array of modules, not an array of arrays."
      );
    }

    return entry;
  }) as ContentAgentModule[];
  const names = new Set<string>();

  for (const module of modules) {
    const name = (module as Partial<ContentAgentModule> | undefined)?.name;

    if (typeof name !== "string" || !MODULE_NAME.test(name)) {
      throw new Error(
        `[Content Agent] modules: invalid module name ${JSON.stringify(name)}. Use lowercase letters, digits and single dashes.`
      );
    }

    if (module.sdkVersion !== SDK_VERSION) {
      throw new Error(
        `[Content Agent] module "${name}" was built for SDK version ${JSON.stringify(module.sdkVersion)}, ` +
          `but this plugin runs SDK version ${SDK_VERSION}. Install a release of the module made for this plugin version.`
      );
    }

    if (names.has(name)) {
      throw new Error(
        `[Content Agent] modules: two modules are named "${name}". Module names must be unique.`
      );
    }

    names.add(name);
    const migrations = new Set<string>();

    for (const migration of module.migrations ?? []) {
      if (!migration?.name || typeof migration.sql !== "string") {
        throw new Error(
          `[Content Agent] module "${name}": every migration needs a \`name\` and an \`sql\` string.`
        );
      }

      if (migrations.has(migration.name)) {
        throw new Error(
          `[Content Agent] module "${name}": two migrations are named "${migration.name}".`
        );
      }

      migrations.add(migration.name);
    }
  }

  return modules;
}

export interface ModuleMigrationGroup {
  module: string;
  migrations: ModuleMigration[];
}

export function moduleMigrations(modules: ContentAgentModule[] = []): ModuleMigrationGroup[] {
  return modules
    .filter((module) => module.migrations?.length)
    .map((module) => ({ module: module.name, migrations: module.migrations! }));
}

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === "object" && value !== null && Symbol.asyncIterator in value;

const SCHEMA_HINT = ' Pass a zod schema or wrap a JSON Schema object in jsonSchema() from "ai".';

// The AI SDK reads every tool before the model call. One tool that it cannot read fails the
// whole turn there, so such a tool is left out here. Returns what is wrong, or null.
async function toolFault(tool: unknown): Promise<string | null> {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "is not a tool object";
  const { execute, description, inputSchema } = tool as Record<string, unknown>;

  if (typeof execute !== "function") return "has no execute function";

  if (description !== undefined && !["string", "function"].includes(typeof description)) {
    return "has a description that is not text";
  }

  try {
    await asSchema(inputSchema as Parameters<typeof asSchema>[0]).jsonSchema;
  } catch (err) {
    return `has an inputSchema that cannot become a JSON Schema (${errorText(err)}).${SCHEMA_HINT}`;
  }

  return null;
}

async function usableTools(module: string, tools: unknown): Promise<ToolSet> {
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    console.warn(
      `[Content Agent] module "${module}": \`tools\` is not a record of tools by name - ignored.`
    );

    return {};
  }

  const entries = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) => {
      const fault = await toolFault(tool);

      if (fault) {
        console.warn(`[Content Agent] module "${module}": tool "${name}" ${fault} - skipped.`);
      }

      return fault ? null : ([name, tool] as const);
    })
  );

  return Object.fromEntries(entries.filter((entry) => entry !== null)) as ToolSet;
}

function textPart(module: string, part: "prompt" | "note", value: unknown): string {
  if (value === undefined || typeof value === "string") return value ?? "";
  console.warn(`[Content Agent] module "${module}": \`${part}\` is not text - ignored.`);

  return "";
}

const MODULE_TURN_TIMEOUT_MS = 20_000;

class ModuleTurnTimeout extends Error {}

export interface ModuleTools {
  module: string;
  tools: ToolSet;
}

export interface ModuleTurn {
  tools: ModuleTools[];
  prompt: string;
  note: string;
}

export async function runModuleTurns(
  modules: ContentAgentModule[] = [],
  ctx: TurnContext,
  timeoutMs = MODULE_TURN_TIMEOUT_MS
): Promise<ModuleTurn> {
  const unavailable: string[] = [];
  const results = await Promise.all(
    modules.map(async (module) => {
      if (!module.turn) return null;
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        const contribution = await Promise.race([
          Promise.resolve().then(() => module.turn!(ctx)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ModuleTurnTimeout()), timeoutMs);
          }),
        ]);

        if (!contribution || typeof contribution !== "object") return null;
        const tools =
          contribution.tools === undefined
            ? null
            : await usableTools(module.name, contribution.tools);

        return { module: module.name, contribution, tools };
      } catch (err) {
        if (err instanceof ModuleTurnTimeout) {
          console.error(
            `[Content Agent] module "${module.name}": turn did not finish within ${timeoutMs}ms, skipped for this turn.`
          );
          unavailable.push(`- "${module.name}" did not respond in time.`);
        } else {
          console.error(
            `[Content Agent] module "${module.name}": turn failed, skipped for this turn:`,
            errorText(err)
          );
          unavailable.push(`- "${module.name}" failed to load.`);
        }

        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    })
  );
  const turn: ModuleTurn = { tools: [], prompt: "", note: "" };
  const prompts: string[] = [];
  const notes: string[] = [];

  for (const result of results) {
    if (!result) continue;
    const prompt = textPart(result.module, "prompt", result.contribution.prompt);
    const note = textPart(result.module, "note", result.contribution.note);

    if (result.tools) turn.tools.push({ module: result.module, tools: result.tools });
    if (prompt) prompts.push(prompt);
    if (note) notes.push(note);
  }

  if (unavailable.length) {
    // Error details stay in the server log: they can carry URLs or internals the user must not see.
    notes.push(
      `\n# Unavailable this turn\nThese extensions failed to load, so their tools are missing from this turn:\n${unavailable.join("\n")}\n` +
        "If the user asks for something they provide, say it is unavailable right now. Never pretend it worked."
    );
  }

  turn.prompt = prompts.join("\n");
  turn.note = notes.join("\n");

  return turn;
}

const NOT_JSON =
  "This tool returned a value that JSON cannot hold, so its result is lost. The fault is in the tool, not in the input: the same call fails again.";

function assertJson(value: unknown): void {
  try {
    JSON.stringify(value);
  } catch {
    throw new Error(NOT_JSON);
  }
}

async function jsonResult(pending: unknown): Promise<unknown> {
  const result = await pending;

  assertJson(result);

  return result;
}

async function* jsonValues(values: AsyncIterable<unknown>): AsyncGenerator<unknown> {
  for await (const value of values) {
    assertJson(value);
    yield value;
  }
}

// The chat stream carries every tool result as JSON. A result that JSON cannot hold (a circular
// object, a BigInt) breaks the stream of the whole turn, so it becomes an error of this one tool.
function withJsonResult(tool: ToolSet[string]): ToolSet[string] {
  const { execute } = tool;

  if (typeof execute !== "function") return tool;

  return {
    ...tool,
    execute: (input: never, callOptions: never) => {
      const result: unknown = execute.call(tool, input, callOptions);

      return isAsyncIterable(result) ? jsonValues(result) : jsonResult(result);
    },
  } as ToolSet[string];
}

export function mergeModuleTools(
  tools: Record<string, unknown>,
  moduleTools: ModuleTools[] | undefined,
  wrapUntrusted: (tool: ToolSet[string]) => ToolSet[string]
): void {
  for (const { module, tools: contributed } of moduleTools ?? []) {
    for (const [name, tool] of Object.entries(contributed ?? {})) {
      if (!tool || typeof tool !== "object") {
        console.warn(
          `[Content Agent] module "${module}": tool "${name}" is not a tool object - skipped.`
        );
        continue;
      }

      if (name in tools) {
        console.warn(
          `[Content Agent] module "${module}": tool "${name}" collides with a built-in tool or an earlier module's tool - skipped.`
        );
        continue;
      }

      tools[name] = withJsonResult(isMarkedUntrusted(tool) ? wrapUntrusted(tool) : tool);
    }
  }
}

export function notifyEdits(
  modules: ContentAgentModule[] = [],
  edits: EditRecordRef[],
  ctx: EditsContext,
  keepAlive?: (pending: Promise<unknown>) => void
): void {
  for (const module of modules) {
    if (!module.onEdits) continue;
    const fail = (err: unknown) =>
      console.warn(`[Content Agent] module "${module.name}": onEdits failed:`, errorText(err));

    try {
      const pending = module.onEdits(edits, ctx);

      if (pending && typeof (pending as Promise<void>).catch === "function") {
        // Attach the catch first:
        // `keepAlive?.(pending.catch(fail))` skips the catch when keepAlive is undefined.
        const guarded = caught(pending as Promise<void>, fail);

        keepAlive?.(guarded);
      }
    } catch (err) {
      fail(err);
    }
  }
}
