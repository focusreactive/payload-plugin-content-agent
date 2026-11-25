import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@payloadcms/ui", () => ({ useConfig: () => ({ config: {} }) }));
const { ContentOpsCard } = await import("../src/ui/components/contentOpsCard.js");
const { ToolCallDisplay } = await import("../src/ui/components/toolCall.js");
const { fetchMessages } = await import("../src/ui/useChatSession.js");

const text = (html: string) => html.replace(/<[^>]+>/gu, "|");

const bulkCard = (data: Record<string, unknown>, live = true) =>
  renderToStaticMarkup(
    React.createElement(ContentOpsCard, {
      data: { op: "bulkEditContent", collection: "posts", ...data },
      live,
    })
  );

const docsResult = (result: Record<string, unknown>) =>
  renderToStaticMarkup(
    React.createElement(ToolCallDisplay, {
      toolName: "searchContent",
      state: "output-available",
      result,
    } as any)
  );

const finished = (toolName: string, result: Record<string, unknown>) =>
  renderToStaticMarkup(
    React.createElement(ToolCallDisplay, { toolName, state: "output-available", result } as any)
  );

const edit = (props: Record<string, unknown>) =>
  text(
    renderToStaticMarkup(
      React.createElement(ToolCallDisplay, {
        toolName: "editContent",
        live: false,
        ...props,
      } as any)
    )
  );

describe("chat: docs result header", () => {
  const docs = [{ id: 1, title: "A post", collection: "posts" }];

  it("shows no stray 0 when there is no collection and nothing was searched", () => {
    const html = docsResult({ docs, totalDocs: 1, searched: [] });

    expect(html).toContain("<span>Search Content</span>");
  });

  it("names the number of searched collections", () => {
    expect(docsResult({ docs, totalDocs: 1, searched: ["posts", "pages"] })).toContain(
      "2 collections"
    );
  });

  it("names the collection when there is one", () => {
    expect(docsResult({ docs, totalDocs: 1, collection: "posts" })).toContain("· posts");
  });
});

describe("chat: bulk card", () => {
  it("shows the document with the id 0 as the one in work", () => {
    const html = bulkCard({ phase: "running", total: 3, completed: 1, currentId: 0 });

    expect(html).toContain("Processing posts/0…");
    expect(text(html)).not.toMatch(/\|0\|/u);
  });

  it("shows the done count alone while the total is unknown", () => {
    const html = bulkCard({ phase: "running", completed: 2 });

    expect(html).not.toContain("undefined");
    expect(text(html)).toMatch(/\|2\|/u);
  });

  it("shows the done count on a finished card with no total", () => {
    const html = bulkCard({ phase: "done", completed: 2 }, false);

    expect(html).not.toContain("undefined");
    expect(html).toContain("2 docs");
  });

  it("keeps completed/total when the total is known", () => {
    expect(bulkCard({ phase: "running", total: 5, completed: 2 })).toContain("2/5");
  });
});

const stored = async (messages: unknown[]) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ messages }))
  );

  return fetchMessages("conv-1", "/api");
};

describe("chat: stored messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws on a failed load, so a storage error is not read as an empty conversation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "storage" }, { status: 500 }))
    );

    await expect(fetchMessages("conv-1", "/api")).rejects.toThrow(/could not be loaded/u);
  });

  it("gives a message with no content no text part, so no empty bubble is drawn", async () => {
    const [message] = await stored([{ id: "m1", role: "assistant", content: "  " }]);

    expect(message.parts).toEqual([]);
  });

  it("keeps the text of a message that has content", async () => {
    const [message] = await stored([{ id: "m1", role: "assistant", content: "Done." }]);

    expect(message.parts).toEqual([{ type: "text", text: "Done." }]);
  });
});

describe("chat: steps of a reply", () => {
  it("shows the reasoning of every step as one line, where the first of them is", async () => {
    const { groupParts } = await import("../src/ui/components/messageParts.js");
    const parts = [
      { type: "reasoning", text: "**Plan**", state: "done" },
      { type: "text", text: "First." },
      { type: "reasoning", text: "", state: "done" },
      { type: "reasoning", text: "**Check**", state: "done" },
      { type: "text", text: "Second." },
    ];
    const html = renderToStaticMarkup(
      React.createElement(React.Fragment, null, ...groupParts(parts as any, () => true, false))
    );

    expect(html.match(/<details/gu)).toHaveLength(1);
    expect(html.indexOf("Plan")).toBeLessThan(html.indexOf("First."));
    expect(html.indexOf("Check")).toBeLessThan(html.indexOf("First."));
  });

  it("shows a failed or refused edit as failed, and no loader after the turn", () => {
    const thrown = edit({ state: "output-error", errorText: "Invalid input: instruction" });
    const refused = edit({
      state: "output-available",
      result: { status: "error", error: "An `instruction` is required." },
    });

    expect(thrown).toContain("Invalid input: instruction");
    expect(thrown).not.toMatch(/Editing content/u);
    expect(refused).toContain("An `instruction` is required.");
    expect(
      edit({
        state: "output-available",
        result: { status: "error", error: "x" },
        progressShown: true,
      }).replace(/\|/gu, "")
    ).toBe("");
  });

  it("shows a finished tool with no result card as a quiet line, not as code", () => {
    const html = renderToStaticMarkup(
      React.createElement(ToolCallDisplay, {
        toolName: "getEditorNotes",
        state: "output-available",
        result: { notes: [] },
      } as any)
    );

    expect(text(html)).toContain("Get Editor Notes");
    expect(html).not.toContain("font-mono");
    expect(html).not.toContain("completed");
  });

  it("shows a read of one document as a quiet line that names the document, not as a created one", () => {
    const read = finished("readDocument", { collection: "pages", id: 7, title: "Launch page" });
    const view = finished("viewImage", { collection: "media", id: 3384, filename: "photo.avif" });

    for (const [html, name] of [
      [read, "Launch page"],
      [view, "photo.avif"],
    ]) {
      expect(html).not.toContain("bg-ca-ok");
      expect(text(html)).toContain(name);
    }

    expect(text(read)).toContain("pages/7");
    expect(read).toContain('href="/admin/collections/pages/7"');
  });

  it("keeps the card of a created document", () => {
    expect(finished("createDocument", { ok: true, collection: "pages", id: 8 })).toContain(
      "bg-ca-ok"
    );
  });
});
