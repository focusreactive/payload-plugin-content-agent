import type { SystemModelMessage } from "ai";

export const cachedInstructions = (content: string): SystemModelMessage => ({
  role: "system",
  content,
  providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
});
