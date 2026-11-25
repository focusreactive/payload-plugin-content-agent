export interface ConversationItem {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

const PAGE_SIZE = 10;

/** A failed request throws: an error body has no `conversations`, so it is no empty list. */
export async function fetchConversationPage(apiRoute: string, cursor?: string) {
  const url = `${apiRoute}/content-agent/conversations?limit=${PAGE_SIZE}${cursor ? `&cursor=${cursor}` : ""}`;
  const res = await fetch(url);
  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const reason =
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : `the server answered ${res.status}`;

    throw new Error(reason);
  }

  return data as {
    conversations: ConversationItem[];
    nextCursor: string | null;
    memoryEnabled?: boolean;
  };
}
