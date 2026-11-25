import { APICallError, InvalidToolInputError, NoSuchToolError, RetryError } from "ai";

const MAX_LENGTH = 300;

function oneLine(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();

  return flat.length > MAX_LENGTH ? `${flat.slice(0, MAX_LENGTH - 1)}…` : flat;
}

export function describeTurnError(error: unknown): string {
  console.error("[Content Agent] Turn error:", error);
  const cause = RetryError.isInstance(error) ? error.lastError : error;

  if (InvalidToolInputError.isInstance(cause))
    return `The model sent input that the ${cause.toolName} step does not accept.`;
  if (NoSuchToolError.isInstance(cause))
    return `The model called a step that does not exist: ${cause.toolName}.`;
  const message = cause instanceof Error ? oneLine(cause.message) : "";

  if (APICallError.isInstance(cause))
    return `The AI provider rejected the request${cause.statusCode ? ` (${cause.statusCode})` : ""}${message ? `: ${message}` : "."}`;

  return message || "Something went wrong. The server log has the details.";
}
