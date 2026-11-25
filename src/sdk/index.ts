/**
 * The module SDK (`@focus-reactive/payload-plugin-content-agent/sdk`). Everything exported
 * here is public API and follows `SDK_VERSION`; the rest of the plugin is internal.
 */

export { SDK_VERSION, defineModule } from "./contract.js";
export type {
  ConfigContext,
  ContentAgentModule,
  EditsContext,
  ModuleDb,
  ModuleEndpoint,
  ModuleMigration,
  TurnContext,
  TurnContribution,
} from "./contract.js";
export type {
  CriterionReport,
  EditRecordRef,
  EditReport,
  SchemaCollection,
  SchemaContext,
  SchemaField,
  SchemaGlobal,
} from "../types.js";
export type { DocFields, DocId, PayloadDoc } from "../borders.js";

export { markUntrusted } from "./untrusted.js";

export { visualResult } from "./visual.js";
export type {
  ChartSpec,
  MetricsSpec,
  TableSpec,
  VisualKind,
  VisualResult,
  VisualSpecs,
} from "./visual.js";

export { capMcpToolOutput } from "../agent/tools/outputCap.js";
export { getMcpServerInstructions, getMcpServerTools } from "./mcp.js";
export type { McpServerTools } from "../agent/mcpClient.js";
export { t as table } from "../memory/database.js";
export { principalOf } from "../api/principal.js";
export { richTextToText } from "../agent/content/diff.js";
export { requestOrigin } from "../requestOrigin.js";
export type { OriginSource, RequestOrigin } from "../requestOrigin.js";
export { wordsOf } from "../words.js";
export { docLabel } from "../schema/docLabel.js";
