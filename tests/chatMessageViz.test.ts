import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { visualResult } from "../src/sdk/visual.js";

vi.mock("@payloadcms/ui", () => ({ useConfig: () => ({ config: {} }) }));
const { ChatMessage } = await import("../src/ui/ChatMessage.js");

const table = (title: string) =>
  visualResult("table", {
    title,
    columns: [{ key: "page", label: "Page" }],
    rows: [{ page: "cell-one" }],
  });
const part = (name: string, output: unknown) => ({
  type: `tool-${name}`,
  toolCallId: name,
  state: "output-available",
  input: {},
  output,
});
const html = (parts: any[]) =>
  renderToStaticMarkup(
    React.createElement(ChatMessage, { message: { id: "m", role: "assistant", parts } as any })
  );

describe("chat: visual results", () => {
  it("draws a module tool's visual result as a table card", () => {
    const out = html([part("someModule__trend", table("Module table"))]);

    expect(out).toContain("Module table");
    expect(out).toContain("cell-one");
  });

  it("draws the core present_table result", () => {
    expect(html([part("present_table", table("Core table"))])).toContain("Core table");
  });

  it("does not draw a result by its tool name alone", () => {
    const wire = {
      content: [
        { type: "text", text: JSON.stringify({ title: "Raw table", columns: [], rows: [] }) },
      ],
    };

    expect(html([part("search__render-table", wire)])).not.toContain("<table");
  });

  it("keeps a drawn result visible after a run of service calls", () => {
    const out = html([
      part("getSchemaInfo", { ok: true }),
      part("findTrends", table("After service calls")),
    ]);

    expect(out).toContain("After service calls");
  });
});
