import { z } from "zod";
import { tool } from "ai";
import { visualResult } from "../../sdk/visual.js";

const unitSchema = z.string().optional().describe('Unit suffix, e.g. "$", "%", "s", "ms", "/mo".');

const tableSchema = z.object({
  title: z.string().describe("Heading shown above the table."),
  columns: z
    .array(
      z.object({
        key: z.string().describe("The property of a row that this column shows."),
        label: z.string().describe("The column heading."),
      })
    )
    .min(1)
    .describe("Column definitions. `key` must match a property name in every row."),
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .describe("Row objects keyed by the column keys."),
  note: z
    .string()
    .optional()
    .describe("One line under the table - a caveat, a source, an as-of date."),
});

const metricsSchema = z.object({
  title: z.string().describe("Heading shown above the metric row."),
  cards: z
    .array(
      z.object({
        label: z.string().describe("The name of the metric."),
        value: z
          .union([z.number(), z.string()])
          .describe("The value of the metric: a number, or a short text when it is not a number."),
        unit: unitSchema,
        change: z
          .object({
            value: z.number().describe("Signed change, e.g. -38 for a 38% drop."),
            direction: z.enum(["up", "down", "flat"]).describe("Which way the arrow points."),
            good: z
              .boolean()
              .optional()
              .describe("Whether this movement is GOOD. Omit for neutral."),
          })
          .optional()
          .describe("The change against the earlier period. Omit it when there is none."),
      })
    )
    .min(1)
    .describe("One card for each metric, in the order to show."),
  note: z
    .string()
    .optional()
    .describe("One line under the cards - a caveat, a source, an as-of date."),
});

const chartSchema = z.object({
  title: z.string().describe("Heading shown above the chart."),
  type: z
    .enum(["line", "bar", "area"])
    .optional()
    .describe("Defaults to line. Use bar for discrete categories."),
  series: z
    .array(
      z.object({
        name: z.string().describe("Legend label for this series."),
        unit: unitSchema,
        data: z
          .array(
            z.object({
              x: z.string().describe("Category or date label."),
              y: z.number().describe("The value at this point."),
            })
          )
          .min(1)
          .describe("The points of the series, in the order to draw."),
      })
    )
    .min(1)
    .describe("One entry per line. Two series with DIFFERENT units get a second Y axis."),
  note: z
    .string()
    .optional()
    .describe("One line under the chart - a caveat, a source, an as-of date."),
});

export function createPresentVizTools() {
  return {
    present_table: tool({
      description:
        "Show a TABLE in the chat with sortable columns. Use for more than a handful of rows, or whenever the reader will want to compare columns - it is easier to read than a markdown table and does not break on long URLs. Prefer this over writing a markdown table by hand.",
      inputSchema: tableSchema,
      // Not a stub: the tool result is the payload the renderer reads.
      execute: async (spec: z.infer<typeof tableSchema>) => visualResult("table", spec),
    }),

    present_metrics: tool({
      description:
        "Show a row of METRIC CARDS (a number, its unit, and its change). Use for the headline figures of an answer, before the detail. Set `change.good` when a direction is not self-evidently positive.",
      inputSchema: metricsSchema,
      execute: async (spec: z.infer<typeof metricsSchema>) => visualResult("metrics", spec),
    }),

    present_chart: tool({
      description:
        "Show a CHART in the chat (line, bar or area). Use whenever the answer is about a trend over time or a comparison across categories - a table of twelve monthly numbers is a chart the reader has to draw in their head. Each series carries its own unit; two different units render a second Y axis.",
      inputSchema: chartSchema,
      execute: async (spec: z.infer<typeof chartSchema>) => visualResult("chart", spec),
    }),
  };
}
