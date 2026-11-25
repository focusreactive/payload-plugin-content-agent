import { getMcpServerInstructions as instructionsOf, getMcpToolsFrom } from "../agent/mcpClient.js";
import type { McpServerTools } from "../agent/mcpClient.js";

function authFingerprint(headers: Record<string, string> | undefined): string {
  if (!headers) return "";

  return Object.keys(headers)
    .sort()
    .map((key) => `${key.toLowerCase()}=${headers[key]}`)
    .join("|");
}

/**
 * Tools of a streamable-HTTP MCP server, over one cached connection per URL and headers.
 * Throws when the server cannot be reached within `timeoutMs` (default 15000 ms).
 * @public
 */
export function getMcpServerTools(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<McpServerTools> {
  return getMcpToolsFrom(
    url,
    options.headers ?? {},
    authFingerprint(options.headers),
    options.timeoutMs
  );
}

/**
 * The instructions the server sent when it connected (how it wants to be used), or undefined.
 * Call it after `getMcpServerTools` with the same URL and headers: it reads that connection.
 * @public
 */
export function getMcpServerInstructions(
  url: string,
  options: { headers?: Record<string, string> } = {}
): Promise<string | undefined> {
  return instructionsOf(url, authFingerprint(options.headers));
}
