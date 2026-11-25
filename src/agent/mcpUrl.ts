interface HostConfig {
  serverURL?: string;
  routes?: { api?: string };
}

const withoutEndSlash = (value: string): string => value.replace(/\/+$/u, "");

/**
 * The absolute URL of the site's MCP endpoint. Without `mcpUrl` it is `<routes.api>/mcp`.
 * A path is resolved against `serverURL`, then localhost. Never against the origin of the request:
 * the sender chooses that header, and the call to this URL carries the MCP key of the site.
 */
export function resolveMcpUrl(mcpUrl: string | undefined, config: HostConfig): string {
  const target = mcpUrl ?? `${withoutEndSlash(config.routes?.api || "/api")}/mcp`;

  if (!target.startsWith("/")) return target;
  const base = config.serverURL || `http://localhost:${process.env.PORT || 3000}`;

  return `${withoutEndSlash(base)}${target}`;
}

/**
 * The address of the site that the plugin trusts with the login of the person, for its files and
 * links: `serverURL`, else the origin of the MCP endpoint, which the host configured.
 */
export function siteAddress(mcpUrl: string | undefined, config: HostConfig): string {
  return config.serverURL || new URL(resolveMcpUrl(mcpUrl, config)).origin;
}

export class McpUnreachableError extends Error {
  readonly url: string;

  constructor(url: string, cause: unknown) {
    super(
      `The agent could not connect to the MCP endpoint of this site (${url}): ${cause instanceof Error ? cause.message : String(cause)}. Check that the Payload MCP plugin is installed, that \`serverURL\` of the Payload config is the address of the site or the \`mcpUrl\` option is the full URL of the endpoint, and that the MCP API key is valid.`,
      { cause }
    );
    this.url = url;
  }
}
