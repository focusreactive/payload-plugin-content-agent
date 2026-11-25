import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "payload";
import { isRecord } from "../borders.js";
import type { MemoryService } from "../memory/index.js";
import type { ContentAgentModule } from "../sdk/contract.js";

const SHARED_KEY = "contentAgent";

/** What the plugin shares with code that runs outside its own endpoints, on the same server. */
export interface SharedRuntime {
  getMemory: () => Promise<MemoryService | null>;
  getModules: () => ContentAgentModule[];
  /** True for the MCP API key that the chat of the plugin uses. */
  isChatKey: (key: string) => boolean;
}

const digest = (text: string): Buffer => createHash("sha256").update(text).digest();

export const chatKeyCheck =
  (mcpApiKey: string) =>
  (key: string): boolean =>
    key.length > 0 && timingSafeEqual(digest(key), digest(mcpApiKey));

// `custom` at the root of the config never reaches the browser.
export const shareRuntime = (config: Config, shared: SharedRuntime): Config => ({
  ...config,
  custom: { ...config.custom, [SHARED_KEY]: shared },
});

export function sharedRuntimeOf(config: { custom?: unknown }): SharedRuntime | null {
  const shared: unknown = isRecord(config.custom) ? config.custom[SHARED_KEY] : undefined;

  return isRecord(shared) &&
    typeof shared.getMemory === "function" &&
    typeof shared.getModules === "function" &&
    typeof shared.isChatKey === "function"
    ? (shared as unknown as SharedRuntime)
    : null;
}
