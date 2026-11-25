import type { UIMessage } from "ai";

type Part = UIMessage["parts"][number];

function withoutItemId(part: Part): Part {
  if (part.type !== "text" || !part.providerMetadata) return part;
  const providerMetadata = Object.fromEntries(
    Object.entries(part.providerMetadata).map(([provider, meta]) => {
      if (!meta || typeof meta !== "object" || !("itemId" in meta)) return [provider, meta];
      const { itemId: _itemId, ...rest } = meta;

      return [provider, rest];
    })
  );

  return { ...part, providerMetadata };
}

// OpenAI rejects a reasoning item without the item it belongs to,
// and an answer item id without its reasoning item.
// So earlier reasoning is not sent back,
// and an earlier answer goes back as plain text without the item id.
export function prepareEarlierTurns(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) =>
    message.role === "assistant"
      ? {
          ...message,
          parts: message.parts.filter((part) => part.type !== "reasoning").map(withoutItemId),
        }
      : message
  );
}
