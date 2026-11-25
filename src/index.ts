export { contentAgentPlugin } from "./plugin.js";
export { withContentAgent } from "./mcpLayer/index.js";
export type { ContentAgentLayerOptions } from "./mcpLayer/index.js";
export type { DefaultTools } from "./mcpLayer/host.js";
export { pruneContentAgentData, type PruneResult } from "./maintenance.js";
export type {
  ContentAgentPluginOptions,
  SchemaContext,
  SchemaCollection,
  SchemaGlobal,
  SchemaField,
} from "./types.js";
