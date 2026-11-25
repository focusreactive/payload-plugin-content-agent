import type { McpCallOptions, McpTool } from "../../../borders.js";
import { mcpText, parseMcpFind } from "../../mcpParse.js";
import { isObjectLike } from "../../content/discovery.js";
import { stripContent } from "../documents/stripContent.js";
import { stringifyCapped } from "../outputCap.js";

export function summarizeMcpOutput(toolName: string, output: unknown): string {
  const text = mcpText(output);
  const isList = /```json/u.test(text) || /Total:\s*\d+\s+document/iu.test(text);
  const { docs, totalDocs, page, totalPages } = parseMcpFind(output);

  if (docs.length === 0) return text.slice(0, 4000);

  if (isList) {
    const slim = docs.map((doc) => stripContent(doc));

    return stringifyCapped({ totalDocs, page, totalPages, returned: slim.length, docs: slim });
  }

  return stringifyCapped(stripContent(docs[0]));
}

export function advertisedParams(tool: McpTool): Set<string> | null {
  const inputSchema: unknown = tool?.inputSchema;
  const declared = isObjectLike(inputSchema) ? (inputSchema.jsonSchema ?? inputSchema) : undefined;
  const props = isObjectLike(declared) ? declared.properties : undefined;

  return props && typeof props === "object" ? new Set(Object.keys(props)) : null;
}

/** The site tool declares its parameters without the locale or the draft that a write sends. */
export function dropsWriteParam(tool: McpTool, params: Record<string, unknown>): boolean {
  const advertised = advertisedParams(tool);

  if (!advertised) return false;

  return (
    (params.locale !== undefined && !advertised.has("locale")) ||
    (params.draft === true && !advertised.has("draft"))
  );
}

export const descriptionOf = (tool: McpTool): unknown =>
  "description" in tool ? tool.description : undefined;

export function runMcpTool(
  name: string,
  tool: McpTool,
  params: Record<string, unknown>,
  options: McpCallOptions
): unknown {
  if (!tool.execute) throw new Error(`MCP tool "${name}" cannot be executed.`);

  return tool.execute(params, options);
}

export function isDocumentReader(name: string, params: Set<string>): boolean {
  if (!/^(get|find|list|read|search|fetch|query)/iu.test(name)) return false;

  return ["id", "collection", "collectionSlug", "global", "globalSlug"].some((param) =>
    params.has(param)
  );
}
