import type { Config, Plugin } from "payload";
import type { ContentAgentPluginOptions } from "./types.js";
import { PROVIDERS } from "./models.js";
import { buildPluginConfig, extendWithModules } from "./plugin/config.js";
import {
  assertFreeRoutes,
  collectModuleEndpoints,
  createEndpointGuard,
} from "./plugin/endpoints.js";
import type { RuntimeAccess } from "./plugin/endpoints.js";
import { createRuntime, ensureSchema, getMemory, getOptions } from "./plugin/runtime.js";
import { chatKeyCheck, shareRuntime } from "./plugin/shared.js";

function assertModelOptions(pluginOptions: ContentAgentPluginOptions): void {
  if (!pluginOptions.provider && !pluginOptions.model) {
    throw new Error(
      "[Content Agent] Either `provider` or `model` must be specified. " +
        'Use provider: "anthropic" or provider: "openai" for the simplest setup.'
    );
  }

  if (pluginOptions.provider && !PROVIDERS.includes(pluginOptions.provider)) {
    throw new Error(
      `[Content Agent] Unknown provider "${String(pluginOptions.provider)}". The values: ${PROVIDERS.map((name) => `"${name}"`).join(", ")}.`
    );
  }

  if (pluginOptions.provider) return;
  // Without a provider the AI SDK sends a model id to its default gateway.
  const named = (["model", "backgroundModel", "subagentModel", "embeddingModel"] as const).filter(
    (option) => typeof pluginOptions[option] === "string"
  );

  if (named.length) {
    throw new Error(
      `[Content Agent] ${named.map((option) => `\`${option}\``).join(", ")} ${named.length === 1 ? "is a model id" : "are model ids"}, and a model id needs \`provider\`. ` +
        `Add provider: ${PROVIDERS.map((name) => `"${name}"`).join(" or ")}, or pass a model instance.`
    );
  }
}

export const contentAgentPlugin =
  (pluginOptions: ContentAgentPluginOptions): Plugin =>
  (incomingConfig: Config): Config => {
    if (pluginOptions.disabled) return incomingConfig;

    assertModelOptions(pluginOptions);

    const runtime = createRuntime(pluginOptions);

    for (const module of runtime.modules) module.validate?.(runtime.moduleCtx);

    if (!pluginOptions.mcpApiKey) {
      throw new Error(
        "[Content Agent] `mcpApiKey` must be a non-empty string. " +
          "Check that the env var it resolves from is actually set."
      );
    }

    const access: RuntimeAccess = {
      getOptions: () => getOptions(runtime),
      ensureSchema: (req) => ensureSchema(runtime, req),
      getMemory: () => getMemory(runtime),
    };
    const guardEndpoint = createEndpointGuard(pluginOptions);
    const moduleEndpoints = collectModuleEndpoints(runtime);

    const config = buildPluginConfig(incomingConfig, {
      runtime,
      access,
      guardEndpoint,
      moduleEndpoints,
    });

    assertFreeRoutes(config.endpoints, moduleEndpoints);

    const extended = shareRuntime(extendWithModules(config, runtime), {
      getMemory: access.getMemory,
      getModules: () => runtime.modules,
      isChatKey: chatKeyCheck(pluginOptions.mcpApiKey),
    });

    runtime.configBuilt = true;

    return extended;
  };
