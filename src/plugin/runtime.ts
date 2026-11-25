import { withCallTimeout } from "../modelCallTimeout.js";
import type { LanguageModel } from "ai";
import type { PayloadRequest } from "payload";
import type { ContentAgentPluginOptions, ResolvedPluginOptions, SchemaContext } from "../types.js";
import { introspectSchema } from "../schema/introspector.js";
import { withoutDraftsNotice } from "../agent/content/draftsOnly.js";
import { initMemory } from "../memory/index.js";
import type { MemoryService } from "../memory/index.js";
import { resolveModels } from "../models.js";
import { checkModules, moduleMigrations } from "../moduleHost.js";
import type { ConfigContext, ContentAgentModule } from "../sdk/contract.js";
import { caught } from "../promises.js";

export const DEFAULTS = {
  apiRoute: "/content-agent/chat",
} as const;

const MEMORY_RETRY_COOLDOWN_MS = 60_000;

export interface PluginRuntime {
  pluginOptions: ContentAgentPluginOptions;
  modules: ContentAgentModule[];
  moduleCtx: ConfigContext;
  configBuilt: boolean;
  optionsPromise: Promise<ResolvedPluginOptions> | null;
  schema: SchemaContext | undefined;
  // Assigned with no await before it, so onInit and concurrent first requests share one init run.
  memoryPromise: Promise<MemoryService | null> | null;
  memoryFailedAt: number;
}

async function buildOptions(runtime: PluginRuntime): Promise<ResolvedPluginOptions> {
  const { pluginOptions, modules } = runtime;
  const resolved = pluginOptions.provider
    ? await resolveModels(pluginOptions.provider, {
        model: pluginOptions.model,
        backgroundModel: pluginOptions.backgroundModel,
        subagentModel: pluginOptions.subagentModel,
        embeddingModel: pluginOptions.embeddingModel,
        apiKey: pluginOptions.apiKey,
      })
    : {
        model: pluginOptions.model as LanguageModel,
        backgroundModel: pluginOptions.backgroundModel as LanguageModel | undefined,
        subagentModel: (pluginOptions.subagentModel ?? pluginOptions.model) as LanguageModel,
        embeddingModel: pluginOptions.embeddingModel,
      };

  return {
    model: withCallTimeout(resolved.model),
    subagentModel: withCallTimeout(resolved.subagentModel),
    mcpOnly: pluginOptions.mcpOnly ?? false,
    imageInput: pluginOptions.imageInput ?? true,
    bulkConcurrency: pluginOptions.bulkConcurrency ?? 5,
    findReplaceConcurrency:
      pluginOptions.findReplaceConcurrency ??
      Math.min(Math.max((pluginOptions.bulkConcurrency ?? 5) * 2, 10), 25),
    bulkTimeBudgetMs: pluginOptions.bulkTimeBudgetMs ?? 180_000,
    turnTokenBudget: pluginOptions.turnTokenBudget ?? 3_000_000,
    mcpApiKey: pluginOptions.mcpApiKey,
    mcpUrl: pluginOptions.mcpUrl,
    apiRoute: pluginOptions.apiRoute ?? DEFAULTS.apiRoute,
    collections: pluginOptions.collections,
    globals: pluginOptions.globals,
    customInstructions: pluginOptions.customInstructions,
    instructions: pluginOptions.instructions,
    modules,
    schemaPromptMode: pluginOptions.schemaPromptMode ?? "auto",
    memoryDatabaseUrl: pluginOptions.memoryDatabaseUrl,
    ltmCurator: pluginOptions.ltmCurator ?? false,
    telemetry: pluginOptions.telemetry ?? "usage",
    reasoningEffort: pluginOptions.reasoningEffort ?? "none",
    backgroundModel: withCallTimeout(resolved.backgroundModel),
    embeddingModel: resolved.embeddingModel,
    contextBudget: pluginOptions.contextBudget,
  };
}

export function getOptions(runtime: PluginRuntime): Promise<ResolvedPluginOptions> {
  if (!runtime.optionsPromise) {
    runtime.optionsPromise = buildOptions(runtime);
    void caught(runtime.optionsPromise, () => {
      runtime.optionsPromise = null;
    });
  }

  return runtime.optionsPromise;
}

export async function ensureSchema(
  runtime: PluginRuntime,
  req: PayloadRequest
): Promise<SchemaContext> {
  if (!runtime.schema) {
    const opts = await getOptions(runtime);

    runtime.schema = introspectSchema(req.payload.config, {
      collections: opts.collections,
      globals: opts.globals,
    });
    const notice = withoutDraftsNotice(runtime.schema);

    if (notice) console.warn(notice);
  }

  return runtime.schema;
}

async function startMemory(runtime: PluginRuntime): Promise<MemoryService | null> {
  try {
    // Inside the try: a model resolution failure degrades to no memory and is retried.
    const opts = await getOptions(runtime);

    if (!opts.memoryDatabaseUrl) {
      console.warn("[Content Agent] memoryDatabaseUrl is not set, memory disabled");

      return null;
    }

    const svc = await initMemory(
      opts.memoryDatabaseUrl,
      opts.contextBudget,
      opts.embeddingModel,
      moduleMigrations(runtime.modules)
    );

    svc.ltmCurator = opts.ltmCurator;
    svc.telemetry.keepsContent = opts.telemetry === "full";
    console.log("[Content Agent] Memory system initialized");
    runtime.memoryFailedAt = 0;

    return svc;
  } catch (err) {
    console.error("[Content Agent] Memory init failed, running without memory:", err);
    runtime.memoryPromise = null;
    runtime.memoryFailedAt = Date.now();

    return null;
  }
}

export function getMemory(runtime: PluginRuntime): Promise<MemoryService | null> {
  if (!runtime.memoryPromise) {
    if (runtime.memoryFailedAt && Date.now() - runtime.memoryFailedAt < MEMORY_RETRY_COOLDOWN_MS) {
      return Promise.resolve(null);
    }

    runtime.memoryPromise = startMemory(runtime);
  }

  return runtime.memoryPromise;
}

export function createRuntime(pluginOptions: ContentAgentPluginOptions): PluginRuntime {
  const modules = checkModules(pluginOptions.modules);
  const runtime: PluginRuntime = {
    pluginOptions,
    modules,
    configBuilt: false,
    moduleCtx: {
      collections: pluginOptions.collections,
      globals: pluginOptions.globals,
      getDb: async () => {
        if (!runtime.configBuilt) {
          throw new Error(
            "[Content Agent] getDb() was called while the Payload config was being built. Call it from a hook or a handler."
          );
        }

        return (await getMemory(runtime))?.db ?? null;
      },
    },
    optionsPromise: null,
    schema: undefined,
    memoryPromise: null,
    memoryFailedAt: 0,
  };

  return runtime;
}
