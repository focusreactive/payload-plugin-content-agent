import type { CollectionConfig, Config, GlobalConfig } from "payload";
import { buildInstructionsGlobal } from "../agent/instructions.js";
import { isRecord } from "../borders.js";
import { coreEndpoints } from "./endpoints.js";
import type { EndpointGuard, NamedModuleEndpoint, RuntimeAccess } from "./endpoints.js";
import { DEFAULTS } from "./runtime.js";
import type { PluginRuntime } from "./runtime.js";

interface PluginConfigParts {
  runtime: PluginRuntime;
  access: RuntimeAccess;
  guardEndpoint: EndpointGuard;
  moduleEndpoints: NamedModuleEndpoint[];
}

const FORM_BRIDGE = "@focus-reactive/payload-plugin-content-agent/client#DocumentFormBridge";

function collectionWithFormBridge(collection: CollectionConfig): CollectionConfig {
  const components = collection.admin?.components;
  const edit = components?.edit;

  return {
    ...collection,
    admin: {
      ...collection.admin,
      components: {
        ...components,
        edit: {
          ...edit,
          beforeDocumentControls: [...(edit?.beforeDocumentControls ?? []), FORM_BRIDGE],
        },
      },
    },
  };
}

function globalWithFormBridge(global: GlobalConfig): GlobalConfig {
  const components = global.admin?.components;
  const elements = components?.elements;

  return {
    ...global,
    admin: {
      ...global.admin,
      components: {
        ...components,
        elements: {
          ...elements,
          beforeDocumentControls: [...(elements?.beforeDocumentControls ?? []), FORM_BRIDGE],
        },
      },
    },
  };
}

export function buildPluginConfig(incomingConfig: Config, parts: PluginConfigParts): Config {
  const { runtime, access, guardEndpoint, moduleEndpoints } = parts;
  const { pluginOptions } = runtime;
  const existingOnInit = incomingConfig.onInit;

  const existingAdmin = incomingConfig.admin || {};
  const existingComponents = existingAdmin.components || {};
  const existingChatSettings: unknown = existingAdmin.custom?.contentAgent;

  return {
    ...incomingConfig,

    collections: incomingConfig.collections?.map(collectionWithFormBridge),
    globals: [
      ...(incomingConfig.globals || []),
      ...(pluginOptions.instructions &&
      !(typeof pluginOptions.instructions === "object" && pluginOptions.instructions.source)
        ? [buildInstructionsGlobal(pluginOptions.instructions)]
        : []),
    ].map(globalWithFormBridge),

    onInit: async (payload) => {
      if (existingOnInit) await existingOnInit(payload);

      try {
        await access.getMemory();
      } catch (err) {
        console.error("[Content Agent] Init failed - continuing without memory:", err);
      }
    },

    endpoints: [
      ...(incomingConfig.endpoints || []),
      ...coreEndpoints(pluginOptions, access, guardEndpoint),
      ...moduleEndpoints.map(({ endpoint }) => ({
        path: endpoint.path,
        method: endpoint.method,
        handler: guardEndpoint(endpoint.handler),
      })),
    ],

    admin: {
      ...existingAdmin,
      custom: {
        ...(existingAdmin.custom || {}),
        contentAgent: {
          ...(isRecord(existingChatSettings) ? existingChatSettings : {}),
          chatPath: pluginOptions.apiRoute ?? DEFAULTS.apiRoute,
          chatRating: pluginOptions.chatRating === true,
        },
      },
      components: {
        ...existingComponents,
        providers: [
          ...(existingComponents.providers || []),
          {
            path: "@focus-reactive/payload-plugin-content-agent/client#ContentAgentProvider",
          },
        ],
      },
    },
  };
}

export function extendWithModules(config: Config, runtime: PluginRuntime): Config {
  return runtime.modules.reduce((cfg, module) => {
    if (!module.extendConfig) return cfg;
    const next = module.extendConfig(cfg, runtime.moduleCtx);

    if (!next || typeof next !== "object") {
      throw new Error(
        `[Content Agent] module "${module.name}": extendConfig must return the config.`
      );
    }

    return next;
  }, config);
}
