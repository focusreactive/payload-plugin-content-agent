import { isRecord } from "../../../borders.js";
import type { McpCallOptions, McpTools, Payload, PayloadUser } from "../../../borders.js";
import type { SchemaContext } from "../../../types.js";
import type { TurnApprovals } from "../../approvals.js";
import { findMcpToolName } from "../../mcpNames.js";
import type { DocTarget, IoTransport, IoTransports } from "../documentIo.js";
import { unknownTargetError } from "../../toolErrors.js";

export const targetLabel = (target: DocTarget) =>
  target.global ? `global "${target.global}"` : `collection "${target.collection}"`;

/** plugin-mcp's update tool reads these names as control params from the flat request, so a
 *  document field with one of these names is written through the Local API. */
export const MCP_RESERVED_UPDATE_PARAMS = new Set([
  "id",
  "depth",
  "draft",
  "fallbackLocale",
  "filePath",
  "locale",
  "overrideLock",
  "overwriteExistingFiles",
  "select",
  "where",
  "_status",
]);

export interface LocalApi {
  payload: Payload;
  user: PayloadUser;
}

export interface IoContext {
  mcpTools: McpTools;
  schema: SchemaContext;
  local: LocalApi | null;
  /** The approvals of the request: they hold the targets without drafts the person opened. */
  approvals?: TurnApprovals;
}

export const mcpTool = (
  { mcpTools }: IoContext,
  verb: "find" | "update" | "create",
  slug: string
): string | null => findMcpToolName(Object.keys(mcpTools), verb, slug);

/** The parameters that a site tool declares. Empty when its schema states none. */
export function declaredParams({ mcpTools }: IoContext, toolName: string): Record<string, unknown> {
  const inputSchema: unknown = mcpTools[toolName]?.inputSchema;
  const declared = isRecord(inputSchema) ? (inputSchema.jsonSchema ?? inputSchema) : undefined;
  const properties = isRecord(declared) ? declared.properties : undefined;

  return isRecord(properties) ? properties : {};
}

/**
 * A site tool drops a parameter that it does not declare, and its answer then reads as the
 * answer to the full call: an unfiltered list, or a write to another locale. Such a call is
 * refused. A tool that states no parameters at all is not checked.
 */
export function undeclaredError(io: IoContext, toolName: string, sent: string[]): string | null {
  const declared = declaredParams(io, toolName);

  if (!Object.keys(declared).length) return null;
  const missing = sent.filter((name) => !(name in declared)).map((name) => `\`${name}\``);

  return missing.length
    ? `the site's tool "${toolName}" takes no ${missing.join(" and ")}, so the call would run without ${missing.length > 1 ? "them" : "it"}. Call again without ${missing.join(" and ")}, or tell the person that this tool of the site does not support ${missing.length > 1 ? "them" : "it"}.`
    : null;
}

export const collectionOf = ({ schema }: IoContext, slug?: string) =>
  schema.collections.find((collection) => collection.slug === slug);
export const globalOf = ({ schema }: IoContext, slug?: string) =>
  schema.globals.find((global) => global.slug === slug);

export const callOptions = (callId?: string): McpCallOptions => ({
  toolCallId: callId ?? "doc-io",
  messages: [],
  context: undefined,
});

export function callMcp(
  { mcpTools }: IoContext,
  name: string,
  input: Record<string, unknown>,
  callId?: string
): unknown {
  const execute = mcpTools[name]?.execute;

  if (!execute) throw new Error(`MCP tool "${name}" cannot be executed.`);

  return execute(input, callOptions(callId));
}

export function transports(io: IoContext, target: DocTarget): IoTransports {
  const hasLocal = io.local !== null;

  if (target.global) {
    // plugin-mcp has no global CRUD: globals go through the Local API only.
    if (!globalOf(io, target.global)) return { read: null, write: null, create: null };
    const read: IoTransport = hasLocal ? "local" : null;

    return { read, write: hasLocal ? "local" : null, create: null };
  }

  const col = collectionOf(io, target.collection);

  if (!col) return { read: null, write: null, create: null };
  const read: IoTransport = mcpTool(io, "find", col.slug) ? "mcp" : hasLocal ? "local" : null;
  const write: IoTransport = mcpTool(io, "update", col.slug) ? "mcp" : hasLocal ? "local" : null;
  const create: IoTransport = mcpTool(io, "create", col.slug) ? "mcp" : hasLocal ? "local" : null;

  return { read, write, create };
}

export const noAccess = (io: IoContext, target: DocTarget, verb: string) => ({
  error: target.global
    ? globalOf(io, target.global)
      ? `Cannot ${verb} ${targetLabel(target)} - globals require the Local API (payload/user unavailable in this run).`
      : unknownTargetError(io.schema, target)
    : collectionOf(io, target.collection)
      ? `Cannot ${verb} ${targetLabel(target)} - no MCP ${verb === "read" ? "find" : verb === "create" ? "create" : "update"} tool and no Local API fallback available.`
      : unknownTargetError(io.schema, target),
});
