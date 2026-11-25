import type { PayloadRequest, SanitizedConfig } from "payload";
import type { SchemaContext } from "../types.js";
import { introspectSchema } from "../schema/introspector.js";
import { createDocumentIO } from "../agent/content/documentIo.js";
import { stringifyCapped } from "../agent/tools/outputCap.js";
import { allowedSlugs, enabledSlugs, pluginSettings, withoutTools, DEFAULT_TOOLS } from "./host.js";
import type {
  HostTool,
  HostToolResult,
  McpAccessSettings,
  McpHostOptions,
  DefaultTools,
} from "./host.js";
import { describeParameters } from "./parameters.js";
import { LAYER_TOOLS } from "./tools.js";
import { withLayerInstructions } from "./instructions.js";
import type { LayerContext, LayerTool, WriteOperation } from "./tools.js";
import { createLayerHistory } from "./history.js";
import type { Operation } from "./host.js";
import { isRecord } from "../borders.js";
import { createSiteLinkProbe } from "../agent/tools/linkProbe.js";
import { requestOrigin } from "../requestOrigin.js";

const LAYER_NAMES = LAYER_TOOLS.map((tool) => tool.name);

const NOT_WRAPPED =
  "The content agent tools did not get the access settings of this request. Pass the final options of the MCP plugin to withContentAgent, so that it wraps the `overrideAuth` the plugin runs.";

const textResult = (output: unknown): HostToolResult => ({
  content: [{ type: "text", text: typeof output === "string" ? output : stringifyCapped(output) }],
});

const toolNameOf = (tool: unknown): string | undefined =>
  isRecord(tool) && typeof tool.name === "string" ? tool.name : undefined;

function assertFreeNames(hostTools: readonly unknown[], layerTools: LayerTool[]): void {
  const taken = new Set(hostTools.map((tool) => toolNameOf(tool)));
  const clash = layerTools.find((tool) => taken.has(tool.name));

  if (clash)
    throw new Error(
      `[Content Agent] The MCP options already hold a tool named "${clash.name}", the name of a content agent tool. Rename the tool of the site.`
    );
}

const layerMcp = (mcp: McpHostOptions["mcp"], tools: unknown[], mode: DefaultTools) => ({
  ...mcp,
  tools,
  serverOptions: {
    ...mcp?.serverOptions,
    instructions: withLayerInstructions(mcp?.serverOptions?.instructions, mode),
  },
});

export interface ContentAgentLayerOptions {
  /**
   * The tools of the MCP plugin itself that stay on the endpoint. "all" (the default) keeps them
   * next to the content agent tools. "read" keeps only its find tools. "none" leaves only the
   * content agent tools, so every write is a checked draft. The key flags stay the permissions.
   * The chat of the content agent keeps every default tool in each mode.
   */
  defaultTools?: DefaultTools;
}

function defaultToolsOf({ defaultTools = "all" }: ContentAgentLayerOptions): DefaultTools {
  if (!DEFAULT_TOOLS.includes(defaultTools))
    throw new Error(
      `[Content Agent] The option \`defaultTools\` of withContentAgent is ${JSON.stringify(defaultTools)}. Valid values: ${DEFAULT_TOOLS.map((value) => `"${value}"`).join(", ")}.`
    );

  return defaultTools;
}

const siteOf = ({ config }: PayloadRequest["payload"]) => ({
  config,
  probeLink: createSiteLinkProbe(config.serverURL),
});

function schemaOpener(options: McpHostOptions): (config: SanitizedConfig) => SchemaContext {
  const schemaByConfig = new WeakMap<SanitizedConfig, SchemaContext>();

  return (config) => {
    const known = schemaByConfig.get(config);

    if (known) return known;
    const schema = introspectSchema(config, {
      collections: enabledSlugs(options.collections),
      globals: enabledSlugs(options.globals),
    });

    schemaByConfig.set(config, schema);

    return schema;
  };
}

/**
 * Adds the checked tools of the content agent to the MCP endpoint of the site:
 * `mcpPlugin(withContentAgent({ collections, globals }))`. A tool reads and writes what the API
 * key of the request is allowed to find, create and update, as the user of that key.
 */
export function withContentAgent<Options extends McpHostOptions>(
  options: Options,
  layerOptions: ContentAgentLayerOptions = {}
): Options {
  const defaultTools = defaultToolsOf(layerOptions);
  const hostTools = options.mcp?.tools ?? [];
  const accessByRequest = new WeakMap<PayloadRequest, McpAccessSettings>();
  const openSchema = schemaOpener(options);

  assertFreeNames(hostTools, LAYER_TOOLS);

  const schemaFor = (
    req: PayloadRequest,
    settings: McpAccessSettings,
    operation: Operation
  ): SchemaContext => {
    const schema = openSchema(req.payload.config);
    const collections = new Set(allowedSlugs(options.collections, settings, operation));
    const globals = new Set(
      operation === "create" ? [] : allowedSlugs(options.globals, settings, operation)
    );

    return {
      ...schema,
      collections: schema.collections.filter((collection) => collections.has(collection.slug)),
      globals: schema.globals.filter((global) => globals.has(global.slug)),
    };
  };

  const hostTool = (tool: LayerTool): HostTool => ({
    name: tool.name,
    description: `${tool.description}\n\n${describeParameters(tool.input)}`,
    parameters: tool.input.shape,
    handler: async (args, req) => {
      const settings = accessByRequest.get(req);

      if (!settings || !req.user) return textResult({ error: NOT_WRAPPED });
      const { user, payload } = req;

      const open = (operation: Operation) => {
        const schema = schemaFor(req, settings, operation);

        return { schema, io: createDocumentIO({ mcpTools: {}, schema, payload, user }) };
      };

      const histories: Array<ReturnType<typeof createLayerHistory>> = [];
      const context: LayerContext = {
        ...open("find"),
        writes: (operation: WriteOperation) => {
          const writable = open(operation);
          const history = createLayerHistory(req, settings, writable.schema);

          histories.push(history);

          return { ...writable, ...siteOf(payload), recordEdits: history.recordEdits };
        },
      };

      try {
        return textResult(await tool.run(context, args));
      } catch (err) {
        return textResult({
          error: `${tool.name} failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        await Promise.all(histories.map((history) => history.settled()));
      }
    },
  });

  return {
    ...options,
    mcp: layerMcp(
      options.mcp,
      [...hostTools, ...LAYER_TOOLS.map((tool) => hostTool(tool))],
      defaultTools
    ),
    overrideAuth: async (
      req: PayloadRequest,
      getDefaultMcpAccessSettings: (overrideApiKey?: string | null) => Promise<never>
    ) => {
      const settings: unknown = await (options.overrideAuth
        ? options.overrideAuth(req, getDefaultMcpAccessSettings)
        : getDefaultMcpAccessSettings());

      if (!isRecord(settings)) return settings;
      accessByRequest.set(req, settings);

      // The chat has the content tools in its own form, tied to its conversation, and it writes
      // through the default tools: the option limits only the other clients of the endpoint.
      if (requestOrigin(req) === "chat") return withoutTools(settings, LAYER_NAMES);

      return pluginSettings(options, settings, defaultTools);
    },
  };
}
