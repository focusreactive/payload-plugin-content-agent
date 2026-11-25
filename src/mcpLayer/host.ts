import type { PayloadRequest } from "payload";
import { isRecord } from "../borders.js";

export type McpAccessSettings = Record<string, unknown>;

export type Operation = "find" | "create" | "update";

export interface HostToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export interface HostTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (
    args: Record<string, unknown>,
    req: PayloadRequest,
    extra: unknown
  ) => Promise<HostToolResult>;
}

/** The part of the options of `@payloadcms/plugin-mcp` that the layer reads and extends. */
export interface McpHostOptions {
  collections?: object;
  globals?: object;
  mcp?: { tools?: readonly unknown[]; serverOptions?: { instructions?: string } };
  // `never`: the settings type of the host's own function is not compared.
  overrideAuth?: (
    req: PayloadRequest,
    getDefaultMcpAccessSettings: (overrideApiKey?: string | null) => Promise<never>
  ) => unknown;
}

// The same conversion as in plugin-mcp: a key document holds the flags of a slug under this name.
const settingsKey = (slug: string): string =>
  slug
    .replace(/[-_\s]+(.)?/gu, (_match, char?: string) => (char ? char.toUpperCase() : ""))
    .replace(/^(.)/u, (_match, char: string) => char.toLowerCase());

function enabledFor(entities: object | undefined, slug: string, operation: Operation): boolean {
  const entity: unknown = isRecord(entities) ? entities[slug] : undefined;
  const enabled: unknown = isRecord(entity) ? entity.enabled : undefined;

  return enabled === true || (isRecord(enabled) && enabled[operation] === true);
}

/** The slugs the site opens for the operation and the key of this request is allowed to use. */
export function allowedSlugs(
  entities: object | undefined,
  settings: McpAccessSettings,
  operation: Operation
): string[] {
  return Object.keys(entities ?? {}).filter((slug) => {
    const flags = settings[settingsKey(slug)];

    return enabledFor(entities, slug, operation) && isRecord(flags) && flags[operation] === true;
  });
}

export const enabledSlugs = (entities: object | undefined): string[] =>
  Object.keys(entities ?? {}).filter((slug) =>
    (["find", "create", "update"] as const).some((operation) =>
      enabledFor(entities, slug, operation)
    )
  );

export const DEFAULT_TOOLS = ["all", "read", "none"] as const;

/** Which tools of the MCP plugin itself stay on the endpoint, next to the content agent tools. */
export type DefaultTools = (typeof DEFAULT_TOOLS)[number];

const OPERATIONS = ["find", "create", "update", "delete"] as const;

const withoutDefault = (flags: Record<string, unknown>, mode: DefaultTools) =>
  Object.fromEntries(
    Object.entries(flags).map(([name, value]) => [
      name,
      OPERATIONS.some((operation) => operation === name) && !(mode === "read" && name === "find")
        ? false
        : value,
    ])
  );

/**
 * The settings the MCP plugin registers its own tools from. The plugin makes a tool for each
 * operation flag of a slug, so a flag that is off leaves that tool out. The layer keeps the
 * settings of the key itself and reads its permissions from them.
 */
export function pluginSettings(
  options: McpHostOptions,
  settings: McpAccessSettings,
  mode: DefaultTools
): McpAccessSettings {
  if (mode === "all") return settings;
  const slugs = [...Object.keys(options.collections ?? {}), ...Object.keys(options.globals ?? {})];
  const copy: McpAccessSettings = { ...settings };

  for (const slug of slugs) {
    const flags = settings[settingsKey(slug)];

    if (isRecord(flags)) copy[settingsKey(slug)] = withoutDefault(flags, mode);
  }

  return copy;
}

const TOOL_FLAGS = "payload-mcp-tool";

/** The settings with the named tools off: the MCP plugin registers a tool from its flag. */
export function withoutTools(settings: McpAccessSettings, names: string[]): McpAccessSettings {
  const flags = settings[TOOL_FLAGS];

  return {
    ...settings,
    [TOOL_FLAGS]: {
      ...(isRecord(flags) ? flags : {}),
      ...Object.fromEntries(names.map((name) => [settingsKey(name), false])),
    },
  };
}
