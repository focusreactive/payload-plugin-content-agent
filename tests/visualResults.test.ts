import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { visualKindOf, visualResult, VISUAL_KEY } from "../src/sdk/visual.js";
import { createPresentVizTools } from "../src/agent/tools/presentViz.js";
import { renderViz } from "../src/ui/components/viz.js";

afterEach(() => vi.restoreAllMocks());

const table = { title: "Pages", columns: [{ key: "url", label: "URL" }], rows: [{ url: "/a" }] };

describe("the marker", () => {
  it("marks a spec and reads the kind back", () => {
    const result = visualResult("table", table);

    expect(result).toEqual({ ...table, [VISUAL_KEY]: "table" });
    expect(visualKindOf(result)).toBe("table");
  });

  it("reads nothing from an ordinary result or an unknown kind", () => {
    expect(visualKindOf(table)).toBeNull();
    expect(visualKindOf({ [VISUAL_KEY]: "map" })).toBeNull();
    expect(visualKindOf("table")).toBeNull();
    expect(visualKindOf(null)).toBeNull();
  });

  it("the core present_* tools return visual results", async () => {
    const tools: any = createPresentVizTools();

    expect(visualKindOf(await tools.present_table.execute(table))).toBe("table");
    expect(
      visualKindOf(
        await tools.present_metrics.execute({ title: "T", cards: [{ label: "a", value: 1 }] })
      )
    ).toBe("metrics");
    expect(
      visualKindOf(
        await tools.present_chart.execute({
          title: "T",
          series: [{ name: "s", data: [{ x: "a", y: 1 }] }],
        })
      )
    ).toBe("chart");
  });

  it("the chat draws by kind and draws nothing for a malformed spec", () => {
    expect(React.isValidElement(renderViz("table", visualResult("table", table)))).toBe(true);
    expect(React.isValidElement(renderViz("metrics", { title: "T", cards: [] }))).toBe(true);
    expect(
      React.isValidElement(
        renderViz("chart", { title: "T", series: [{ name: "s", data: [{ x: "a", y: 1 }] }] })
      )
    ).toBe(true);
    expect(renderViz("table", { title: "T" })).toBeNull();
    expect(renderViz("chart", { title: "T", series: "no" })).toBeNull();
  });
});
