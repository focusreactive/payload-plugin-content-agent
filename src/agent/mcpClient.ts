import { createMCPClient } from "@ai-sdk/mcp";
import { CHAT_REQUEST_HEADER } from "../requestOrigin.js";
import { withCallTimeouts } from "./mcpCallTimeout.js";
import { quiet } from "../promises.js";

type McpClient = Awaited<ReturnType<typeof createMCPClient>>;

/**
 * The tools of an MCP server, by name, as the `@ai-sdk/mcp` client returns them.
 * @public
 */
export type McpServerTools = Awaited<
  ReturnType<Awaited<ReturnType<typeof createMCPClient>>["tools"]>
>;

interface CachedClient {
  authKey: string;
  clientPromise: Promise<McpClient>;
}

// On `globalThis` so a Next.js dev reload does not orphan open clients.
// Keyed by URL and credential: two callers may use one server with different credentials.
const CLIENTS_KEY = Symbol.for("payload-content-agent.mcp-clients");
const WARNED_SCOPE_KEY = Symbol.for("payload-content-agent.mcp-scope-warned");

const MAX_CLIENTS_PER_URL = 4;

const registryKey = (url: string, authKey: string) => `${url}\u0000${authKey}`;

const MCP_CONNECT_TIMEOUT_MS = 15_000;

class McpTimeoutError extends Error {}

async function withTimeout<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
  label: string
): Promise<Value> {
  void quiet(promise);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new McpTimeoutError(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

interface RegistryEntry extends CachedClient {
  url: string;
}

function clientRegistry(): Map<string, RegistryEntry> {
  const globalStore = globalThis as Record<symbol, unknown>;

  if (!globalStore[CLIENTS_KEY]) globalStore[CLIENTS_KEY] = new Map<string, RegistryEntry>();

  return globalStore[CLIENTS_KEY] as Map<string, RegistryEntry>;
}

async function closeWhenReady(clientPromise: Promise<McpClient>): Promise<void> {
  const client = await clientPromise;

  await client.close?.();
}

function closeClient(clientPromise: Promise<McpClient>): void {
  void quiet(closeWhenReady(clientPromise));
}

function makeRoomFor(registry: Map<string, RegistryEntry>, url: string): void {
  const ofUrl = [...registry.entries()].filter(([, entry]) => entry.url === url);

  for (const [key, entry] of ofUrl.slice(0, Math.max(0, ofUrl.length - MAX_CLIENTS_PER_URL + 1))) {
    registry.delete(key);
    closeClient(entry.clientPromise);
  }
}

function warnedScopeRegistry(): Set<string> {
  const globalStore = globalThis as Record<symbol, unknown>;

  if (!globalStore[WARNED_SCOPE_KEY]) globalStore[WARNED_SCOPE_KEY] = new Set<string>();

  return globalStore[WARNED_SCOPE_KEY] as Set<string>;
}

function warnSharedScope(mcpUrl: string): void {
  const warned = warnedScopeRegistry();

  if (warned.has(mcpUrl)) return;
  warned.add(mcpUrl);
  console.warn(
    "[Content Agent] MCP-path writes execute with the fixed permission scope of the configured `mcpApiKey` " +
      "- the SAME scope for every chat user, regardless of that user's own Payload role or collection access. " +
      "Per-user authorization only exists on the Local API fallback path. Every tool the key exposes " +
      'is available to the agent (it gets no delete tool), so grant the key only what the chat should be able to do. See DOCS.md, "Safety and security".'
  );
}

/** The headers of the chat's own calls to the MCP endpoint of the site. */
export const chatMcpHeaders = (mcpApiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${mcpApiKey}`,
  [CHAT_REQUEST_HEADER]: "1",
});

// A server registers its tools for the key of the request, and a key can have none.
const declaresNoTools = (client: McpClient): boolean => {
  const capabilities: unknown = client.initializeResult?.capabilities;

  return typeof capabilities === "object" && capabilities !== null && !("tools" in capabilities);
};

async function toolsOf(clientPromise: Promise<McpClient>): Promise<McpServerTools> {
  const client = await clientPromise;
  const tools = declaresNoTools(client) ? {} : await client.tools();

  return withCallTimeouts(tools);
}

function listTools(
  clientPromise: Promise<McpClient>,
  url: string,
  timeoutMs: number
): Promise<McpServerTools> {
  return withTimeout(toolsOf(clientPromise), timeoutMs, `[Content Agent] MCP server ${url}`);
}

export async function getMcpToolsFrom(
  url: string,
  headers: Record<string, string>,
  authKey: string,
  timeoutMs: number = MCP_CONNECT_TIMEOUT_MS
): Promise<McpServerTools> {
  const mcpUrl = url;
  const key = registryKey(mcpUrl, authKey);

  const registry = clientRegistry();
  const cached = registry.get(key);

  if (cached) {
    registry.delete(key);
    registry.set(key, cached);

    try {
      return await listTools(cached.clientPromise, mcpUrl, timeoutMs);
    } catch (err) {
      if (registry.get(key)?.clientPromise === cached.clientPromise) registry.delete(key);
      closeClient(cached.clientPromise);
      if (err instanceof McpTimeoutError) throw err;
      console.warn(
        `[Content Agent] The MCP connection to ${mcpUrl} failed and is opened again:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  makeRoomFor(registry, mcpUrl);
  // The promise is stored synchronously, before any await,
  // so concurrent first requests share one connection.
  const clientPromise = createMCPClient({
    transport: {
      type: "http",
      url: mcpUrl,
      headers,
    },
  });

  registry.set(key, { url: mcpUrl, authKey, clientPromise });

  try {
    return await listTools(clientPromise, mcpUrl, timeoutMs);
  } catch (err) {
    if (registry.get(key)?.clientPromise === clientPromise) registry.delete(key);
    closeClient(clientPromise);
    throw err;
  }
}

export async function getMcpTools(mcpUrl: string, mcpApiKey: string): Promise<McpServerTools> {
  warnSharedScope(mcpUrl);

  return getMcpToolsFrom(mcpUrl, chatMcpHeaders(mcpApiKey), mcpApiKey);
}

// Reads the client memoized by `getMcpToolsFrom` for the same URL and key: call it after that.
export async function getMcpServerInstructions(
  mcpUrl: string,
  authKey: string
): Promise<string | undefined> {
  const cached = clientRegistry().get(registryKey(mcpUrl, authKey));

  if (!cached) return undefined;

  try {
    const { instructions } = await cached.clientPromise;

    return typeof instructions === "string" && instructions.trim()
      ? instructions.trim()
      : undefined;
  } catch {
    return undefined;
  }
}
