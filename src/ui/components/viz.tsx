"use client";

import React from "react";
import type { VisualKind } from "../../sdk/visual.js";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowRight, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "../lib/cn.js";
import { isRecord, isText, listOf, textOf } from "../lib/narrow.js";
import type { Text } from "../lib/narrow.js";

const SERIES_COLORS = [
  "var(--color-ca-accent)",
  "var(--color-ca-ok)",
  "var(--color-ca-warn)",
  "var(--color-ca-danger)",
];

const axisTick = { fontSize: 13, fill: "var(--color-ca-muted)" };
const tooltipStyle = {
  background: "var(--color-ca-bg)",
  border: "1px solid var(--color-ca-border)",
  borderRadius: 8,
  fontSize: 14,
  color: "var(--color-ca-fg)",
};

function VizFrame({
  title,
  note,
  children,
}: {
  title?: Text;
  note?: Text;
  children: React.ReactNode;
}) {
  return (
    <div className="border-ca-border bg-ca-bg my-2 rounded-(--radius-ca) border p-3">
      {title ? <h4 className="text-ca-fg mb-2 text-xs font-semibold">{title}</h4> : null}
      {children}
      {note ? <p className="text-2xs text-ca-faint mt-2 leading-snug">{note}</p> : null}
    </div>
  );
}

// A drawing can come from a remote server: only what a card reads is checked, where it reads it.
interface ChartSpec {
  title?: Text;
  type?: unknown;
  series: Array<{ name?: string; unit?: unknown; data: Array<{ x?: unknown; y?: unknown }> }>;
  note?: Text;
}

export function ChartCard({ spec }: { spec: ChartSpec }) {
  const series = spec.series ?? [];
  const byX = new Map<unknown, Record<string, unknown>>();

  for (const entry of series) {
    for (const point of entry.data ?? []) {
      const row = byX.get(point.x) ?? { x: point.x };

      if (entry.name !== undefined) row[entry.name] = point.y;
      byX.set(point.x, row);
    }
  }

  const rows = [...byX.values()];

  const units = [...new Set(series.map((entry) => entry.unit).filter(Boolean))];
  const rightAxisUnit = units.length > 1 ? units[1] : undefined;
  const axisIdFor = (entry: { unit?: unknown }) =>
    rightAxisUnit && entry.unit === rightAxisUnit ? "right" : "left";

  const Chart = spec.type === "bar" ? BarChart : spec.type === "area" ? AreaChart : LineChart;

  return (
    <VizFrame title={spec.title} note={spec.note}>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <Chart
            data={rows}
            margin={{ top: 4, right: rightAxisUnit ? 4 : 8, bottom: 0, left: -18 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-ca-border)" vertical={false} />
            <XAxis dataKey="x" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis yAxisId="left" tick={axisTick} tickLine={false} axisLine={false} width={42} />
            {rightAxisUnit ? (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={42}
              />
            ) : null}
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ stroke: "var(--color-ca-border-strong)" }}
            />
            {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 13 }} /> : null}
            {series.map((entry, i) => {
              const color = SERIES_COLORS[i % SERIES_COLORS.length];
              // `key` stays out of the spread: React 19 warns when a key arrives through props.
              const common = {
                dataKey: entry.name ?? "",
                yAxisId: axisIdFor(entry),
                name: entry.name,
              };

              if (spec.type === "bar")
                return <Bar key={entry.name} {...common} fill={color} radius={[3, 3, 0, 0]} />;
              if (spec.type === "area")
                return (
                  <Area
                    key={entry.name}
                    {...common}
                    stroke={color}
                    fill={color}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                );

              return (
                <Line
                  key={entry.name}
                  {...common}
                  type="monotone"
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                />
              );
            })}
          </Chart>
        </ResponsiveContainer>
      </div>
    </VizFrame>
  );
}

interface MetricsSpec {
  title?: Text;
  cards: Array<{
    label?: Text;
    value?: Text;
    unit?: Text;
    change?: { value?: Text; direction?: unknown; good?: unknown };
  }>;
  note?: Text;
}

function MetricsCard({ spec }: { spec: MetricsSpec }) {
  return (
    <VizFrame title={spec.title} note={spec.note}>
      <div className="flex flex-wrap gap-2">
        {(spec.cards ?? []).map((card) => {
          const dir = card.change?.direction;
          const Arrow = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : ArrowRight;
          const tone =
            card.change?.good === undefined
              ? "text-ca-muted"
              : card.change.good
                ? "text-ca-ok"
                : "text-ca-danger";

          return (
            <div
              key={card.label}
              className="border-ca-border bg-ca-surface min-w-28 flex-1 rounded-lg border px-2.5 py-2"
            >
              <div className="text-2xs text-ca-muted truncate">{card.label}</div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="text-ca-fg text-lg font-semibold tabular-nums">{card.value}</span>
                {card.unit ? <span className="text-2xs text-ca-muted">{card.unit}</span> : null}
              </div>
              {card.change ? (
                <div
                  className={cn(
                    "text-2xs mt-0.5 flex items-center gap-0.5 font-medium tabular-nums",
                    tone
                  )}
                >
                  <Arrow className="size-3" />
                  {Number(card.change.value) > 0 ? "+" : ""}
                  {card.change.value}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </VizFrame>
  );
}

interface TableSpec {
  title?: Text;
  columns: Array<{ key: string; label?: Text }>;
  rows: unknown[];
  note?: Text;
}

const cellOf = (row: unknown, key: string): unknown => (isRecord(row) ? row[key] : undefined);

function TableCard({ spec }: { spec: TableSpec }) {
  const columns = spec.columns ?? [];
  const [sort, setSort] = React.useState<{ key: string; dir: 1 | -1 } | null>(null);

  const rows = React.useMemo(() => {
    const data = [...(spec.rows ?? [])];

    if (!sort) return data;

    return data.sort((a, b) => {
      const cellA = cellOf(a, sort.key);
      const cellB = cellOf(b, sort.key);

      if (typeof cellA === "number" && typeof cellB === "number") return (cellA - cellB) * sort.dir;

      return String(cellA ?? "").localeCompare(String(cellB ?? "")) * sort.dir;
    });
  }, [spec.rows, sort]);

  const toggle = (key: string) =>
    setSort((prev) =>
      prev?.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }
    );

  return (
    <VizFrame title={spec.title} note={spec.note}>
      <div className="overflow-x-auto">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead>
            <tr className="border-ca-border-strong border-b text-left">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="text-ca-muted px-2 py-1.5 font-medium whitespace-nowrap"
                >
                  <button
                    type="button"
                    onClick={() => toggle(col.key)}
                    className="hover:text-ca-fg inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-inherit"
                  >
                    {col.label}
                    {sort?.key === col.key ? (
                      sort.dir === 1 ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )
                    ) : (
                      <ChevronsUpDown className="size-3 opacity-40" />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-ca-border border-b last:border-0">
                {columns.map((col) => {
                  const value = cellOf(row, col.key);

                  return (
                    <td
                      key={col.key}
                      className={cn(
                        "text-ca-fg px-2 py-1.5",
                        typeof value === "number"
                          ? "text-right tabular-nums"
                          : "max-w-[42ch] [overflow-wrap:anywhere]"
                      )}
                    >
                      {value == null ? "" : String(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </VizFrame>
  );
}

export function parseXyChart(code: string): ChartSpec | null {
  if (!/^\s*xychart-beta\b/mu.test(code)) return null;
  const title = code.match(/^\s*title\s+"([^"]*)"/mu)?.[1];
  const xRaw = code.match(/^\s*x-axis\s+\[([^\]]*)\]/mu)?.[1];

  if (!xRaw) return null;
  const categories = xRaw
    .split(",")
    .map((label) => label.trim().replace(/^["']|["']$/gu, ""))
    .filter(Boolean);

  if (!categories.length) return null;

  const yLabel = code.match(/^\s*y-axis\s+"([^"]*)"/mu)?.[1];
  const series: ChartSpec["series"] = [];
  let isBar = false;

  for (const match of code.matchAll(/^\s*(line|bar)\s+(?:"([^"]*)"\s+)?\[([^\]]*)\]/gmu)) {
    const [, kind, name, values] = match;

    if (kind === "bar") isBar = true;
    const nums = values
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value));

    if (!nums.length) continue;
    series.push({
      name: name || yLabel || `series ${series.length + 1}`,
      data: categories
        .map((category, i) => ({ x: category, y: nums[i] }))
        .filter((point) => Number.isFinite(point.y)),
    });
  }

  if (!series.length) return null;

  return { title, type: isBar ? "bar" : "line", series };
}

const fieldsOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

function metricChangeOf(change: unknown): MetricsSpec["cards"][number]["change"] {
  if (!change) return undefined;
  const { value, direction, good } = fieldsOf(change);

  return { value: textOf(value), direction, good };
}

export function renderViz(kind: VisualKind, payload: unknown): React.ReactNode | null {
  if (!isRecord(payload)) return null;
  const title = textOf(payload.title);
  const note = textOf(payload.note);

  if (kind === "table") {
    if (!Array.isArray(payload.columns) || !Array.isArray(payload.rows)) return null;
    const columns = payload.columns.map((entry: unknown) => {
      const column = fieldsOf(entry);

      return { key: String(column.key), label: textOf(column.label) };
    });

    return <TableCard spec={{ title, columns, rows: payload.rows, note }} />;
  }

  if (kind === "metrics") {
    if (!Array.isArray(payload.cards)) return null;
    const cards = payload.cards.map((entry: unknown) => {
      const card = fieldsOf(entry);

      return {
        label: textOf(card.label),
        value: textOf(card.value),
        unit: textOf(card.unit),
        change: metricChangeOf(card.change),
      };
    });

    return <MetricsCard spec={{ title, cards, note }} />;
  }

  if (kind === "chart") {
    if (!Array.isArray(payload.series)) return null;
    const series = payload.series.map((entry: unknown) => {
      const fields = fieldsOf(entry);

      return {
        name: isText(fields.name) ? String(fields.name) : undefined,
        unit: fields.unit,
        data: listOf(fields.data).map(fieldsOf),
      };
    });

    return <ChartCard spec={{ title, type: payload.type, series, note }} />;
  }

  return null;
}
