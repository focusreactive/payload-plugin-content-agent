"use client";

import { useAuth, useConfig } from "@payloadcms/ui";
import { isRecord } from "./lib/narrow.js";
import { adminBase, adminDocHref } from "./lib/adminHref.js";

export { adminDocHref };

export function useAdminRoute(): string {
  const { config } = useConfig();

  return adminBase(config?.routes?.admin);
}

export function useApiRoute(): string {
  const { config } = useConfig();

  return config?.routes?.api || "/api";
}

function useAgentSettings(): Record<string, unknown> {
  const { config } = useConfig();
  const settings: unknown = config?.admin?.custom?.contentAgent;

  return isRecord(settings) ? settings : {};
}

export function useChatPath(): string {
  const { chatPath } = useAgentSettings();

  return (typeof chatPath === "string" && chatPath) || "/content-agent/chat";
}

export function identityKey(user: unknown): string {
  return isRecord(user) ? `${user.collection ?? "users"}:${user.id}` : "anon";
}

const CONVERSATION_STORAGE_BASE = "content-agent-conversation";

export function useConversationStorageKey(): string {
  const { user } = useAuth();

  return `${CONVERSATION_STORAGE_BASE}:${identityKey(user)}`;
}

export function useChatRatingEnabled(): boolean {
  return useAgentSettings().chatRating === true;
}
