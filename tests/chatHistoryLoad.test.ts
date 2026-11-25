import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchConversationPage } from "../src/ui/conversationPage.js";

afterEach(() => vi.unstubAllGlobals());

describe("a page of the chat history", () => {
  it("throws on a failed request instead of reading as an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Unauthorized" }, { status: 401 }))
    );

    await expect(fetchConversationPage("/api")).rejects.toThrow("Unauthorized");
  });

  it("names the status when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Bad Gateway", { status: 502 }))
    );

    await expect(fetchConversationPage("/api")).rejects.toThrow("the server answered 502");
  });
});
