import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@payloadcms/ui", () => ({ useConfig: () => ({ config: {} }) }));
const { ChatMessage } = await import("../src/ui/ChatMessage.js");

const render = (parts: any[], live: boolean) =>
  renderToStaticMarkup(
    React.createElement(ChatMessage, {
      message: { id: "m", role: "assistant", parts } as any,
      live,
    })
  );
const tool = (name: string, state: string, extra: Record<string, unknown> = {}) => ({
  type: `tool-${name}`,
  toolCallId: name,
  state,
  input: {},
  ...extra,
});

const loaders = (html: string) => html.split("ca-loader").length - 1;

describe("chat: step status", () => {
  it("shows a running step in plain words while the turn runs", () => {
    const html = render([tool("updatePosts", "input-available")], true);

    expect(html).toContain("Updating posts…");
    expect(html).toContain("ca-loader");
    expect(html).not.toContain("stopped before it finished");
  });

  it("shows a step without a result as stopped once the turn is over, with no spinner", () => {
    const html = render([tool("updatePosts", "input-streaming")], false);

    expect(html).toContain("Updating posts");
    expect(html).toContain("stopped before it finished");
    expect(html).not.toContain("ca-loader");
  });

  const progress = {
    type: "data-content-ops",
    id: "op1",
    data: { op: "editContent", phase: "running", collection: "posts", id: "1", step: 2 },
  };

  it("shows one live line for an edit that has no progress card yet", () => {
    for (const state of ["input-streaming", "input-available"]) {
      const running = render([tool("editContent", state)], true);

      expect(running).toContain("Editing content…");
      expect(loaders(running)).toBe(1);
      expect(running).not.toContain("stopped before it finished");
    }
  });

  it("shows a cut-off edit whose progress card never appeared", () => {
    expect(render([tool("editContent", "input-available")], false)).toContain("Editing content");
  });

  it("leaves the progress card as the only loader once it is there", () => {
    const running = render([tool("editContent", "input-available"), progress], true);

    expect(running).not.toContain("Editing content…");
    expect(loaders(running)).toBe(1);
  });

  it("shows one live line after the person confirms, and none next to the progress card", () => {
    const confirmed = tool("editContent", "approval-responded", {
      approval: { id: "a1", approved: true },
    });
    const alone = render([confirmed], true);

    expect(alone).toContain("Editing content…");
    expect(loaders(alone)).toBe(1);
    expect(loaders(render([confirmed, progress], true))).toBe(1);
  });

  it("stops a progress card that never reported done", () => {
    const ops = {
      type: "data-content-ops",
      id: "op1",
      data: { op: "editContent", phase: "running", collection: "posts", id: "1", step: 2 },
    };

    expect(render([ops], true)).toContain("Editing");
    const stopped = render([ops], false);

    expect(stopped).toContain("Edit stopped before it finished");
    expect(stopped).not.toContain("ca-loader");
  });

  it('does not call unfinished service steps "Working…" after the turn', () => {
    expect(render([tool("getSchemaInfo", "input-available")], true)).toContain("Working…");
    expect(render([tool("getSchemaInfo", "input-available")], false)).not.toContain("Working…");
  });
});

describe("chat: model reasoning", () => {
  it('says "Thinking…" with the step the model is on, on one closed line, while the reasoning streams', () => {
    const html = render(
      [
        {
          type: "reasoning",
          text: "**Searching for the post**\n\nLooking for the post by slug.",
          state: "streaming",
        },
      ],
      true
    );

    expect(html).toContain("Thinking…");
    expect(html).toContain(">Searching for the post<");
    expect(html).toContain("ca-loader");
    expect(html).not.toMatch(/<details[^>]*open/u);
  });

  it('folds a finished reasoning block, reopened from history, into "Thought for a few seconds"', () => {
    const html = render(
      [{ type: "reasoning", text: "Looking for the post by slug.", state: "done" }],
      false
    );

    expect(html).toContain("Thought for a few seconds");
    expect(html).not.toMatch(/<details[^>]*open/u);
    expect(html).not.toContain("ca-loader");
  });

  it("draws nothing for an empty finished reasoning part", () => {
    const html = render([{ type: "reasoning", text: "", state: "done" }], false);

    expect(html).not.toContain("Thought for");
    expect(html).not.toContain("Thinking…");
  });
});

const renderReply = (parts: any[], opts: { live: boolean; thinking: boolean }) =>
  renderToStaticMarkup(
    React.createElement(ChatMessage, {
      message: { id: "m", role: "assistant", parts } as any,
      ...opts,
    })
  );

describe('chat: the "Thinking…" line', () => {
  it("sits inside the reply, after the steps so far", () => {
    const html = renderReply([{ type: "text", text: "Found the post." }], {
      live: true,
      thinking: true,
    });

    expect(html.match(/>Agent</gu)).toHaveLength(1);
    expect(html.indexOf("Found the post.")).toBeGreaterThan(-1);
    expect(html.indexOf("Thinking…")).toBeGreaterThan(html.indexOf("Found the post."));
  });

  it("opens the reply before the model sends its first part", () => {
    const html = renderReply([], { live: true, thinking: true });

    expect(html).toContain(">Agent<");
    expect(html).toContain("Thinking…");
  });

  it("is not drawn while something else in the reply shows progress", () => {
    expect(
      renderReply([tool("updatePosts", "input-available")], { live: true, thinking: false })
    ).not.toContain("Thinking…");
  });

  it("leaves no empty bubble for a reply with nothing to show", () => {
    expect(renderReply([{ type: "step-start" }], { live: false, thinking: false })).toBe("");
  });
});

describe("chat: reply size", () => {
  it("gives the agent reply the full width from its first line", () => {
    expect(render([{ type: "text", text: "Hi." }], false)).toMatch(
      /class="[^"]*\bw-full\b[^"]*rounded-bl-sm/u
    );
  });

  it("gives the thinking line, a running step and the reasoning line one height", () => {
    const line = /<div class="(?=[^"]*\bmy-1\.5\b)(?=[^"]*\bmin-h-6\b)[^"]*"/u;

    expect(render([], true).length).toBe(0);
    expect(
      renderToStaticMarkup(
        React.createElement(ChatMessage, {
          message: { id: "m", role: "assistant", parts: [] } as any,
          live: true,
          thinking: true,
        })
      )
    ).toMatch(line);
    expect(render([tool("updatePosts", "input-available")], true)).toMatch(line);
    expect(render([{ type: "reasoning", text: "", state: "streaming" }], true)).toMatch(line);
  });
});

describe("chat: a failed step", () => {
  it('is one line with a "failed" badge, and the reason is inside, closed', () => {
    const html = render(
      [
        tool("getEditorNotes", "output-error", {
          errorText: 'Shared notes are not enabled. Retry with scope "me".',
        }),
      ],
      false
    );

    expect(html).toContain("Get Editor Notes");
    expect(html).toContain(">failed<");
    expect(html).toContain("Retry with scope");
    expect(html).not.toMatch(/<details[^>]*open/u);
    expect(html).not.toContain("bg-ca-danger");
  });
});
