import { sharedRuntimeOf } from "./plugin/shared.js";

/** The header the chat of the content agent sends with its own calls to the MCP endpoint. */
export const CHAT_REQUEST_HEADER = "x-content-agent-chat";

/**
 * Who sent a request: see `requestOrigin`.
 * @public
 */
export type RequestOrigin = "chat" | "mcp" | "other";

/**
 * The parts of a Payload request that `requestOrigin` reads. A `PayloadRequest` fits.
 * @public
 */
export interface OriginSource {
  payloadAPI?: unknown;
  headers?: { get?: (name: string) => string | null } | null;
  payload?: { config?: { custom?: unknown } } | null;
}

const BEARER = /^Bearer\s+(?<key>\S+)$/iu;

// The header is not a secret, so it counts only with the key that the chat itself uses.
function sentByChat({ headers, payload }: OriginSource): boolean {
  if (!headers?.get?.(CHAT_REQUEST_HEADER) || !payload?.config) return false;
  const key = BEARER.exec(headers.get("authorization") ?? "")?.groups?.key ?? "";

  return sharedRuntimeOf(payload.config)?.isChatKey(key) ?? false;
}

/**
 * Who sent a request that reaches a hook of the site: the chat of the content agent through the
 * MCP endpoint ("chat"), another client of the MCP endpoint ("mcp"), or anything else, such as
 * the admin panel or the Local API ("other"). The MCP plugin marks its requests itself.
 * @public
 */
export function requestOrigin(req: OriginSource | null | undefined): RequestOrigin {
  if (req?.payloadAPI !== "MCP") return "other";

  return sentByChat(req) ? "chat" : "mcp";
}
