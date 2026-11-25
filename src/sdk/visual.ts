// Pure data, no imports: the chat UI reads this file in the browser.

/** The field that marks a visual result. */
export const VISUAL_KEY = "$viz";

/**
 * The drawings the chat knows.
 * @public
 */
export type VisualKind = "table" | "metrics" | "chart";

/**
 * A table: columns and rows.
 * @public
 */
export interface TableSpec {
  title: string;
  /** `key` must match a property in every row. */
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  /** One line under the table: a caveat, a source, an as-of date. */
  note?: string;
}

/**
 * A row of number cards.
 * @public
 */
export interface MetricsSpec {
  title: string;
  cards: Array<{
    label: string;
    value: number | string;
    unit?: string;
    /** `good` says whether the movement is good news: bounce rate going up is not. */
    change?: { value: number; direction: "up" | "down" | "flat"; good?: boolean };
  }>;
  note?: string;
}

/**
 * A line, bar or area chart.
 * @public
 */
export interface ChartSpec {
  title: string;
  /** Defaults to line. */
  type?: "line" | "bar" | "area";
  /** Two series with different units get a second Y axis. */
  series: Array<{ name: string; unit?: string; data: Array<{ x: string; y: number }> }>;
  note?: string;
}

/**
 * The spec of each drawing, by its kind.
 * @public
 */
export interface VisualSpecs {
  table: TableSpec;
  metrics: MetricsSpec;
  chart: ChartSpec;
}

/**
 * A tool result that the chat draws. Make it with `visualResult`.
 * @public
 */
export type VisualResult<Kind extends VisualKind = VisualKind> = VisualSpecs[Kind] & {
  $viz: Kind;
};

/**
 * Return this from a tool's `execute` to have the chat draw the result.
 * @public
 */
export function visualResult<Kind extends VisualKind>(
  kind: Kind,
  spec: VisualSpecs[Kind]
): VisualResult<Kind> {
  return { ...spec, [VISUAL_KEY]: kind } as VisualResult<Kind>;
}

const KINDS: ReadonlySet<string> = new Set<VisualKind>(["table", "metrics", "chart"]);

/** The kind of a visual result, or null for any other tool output. */
export function visualKindOf(output: unknown): VisualKind | null {
  if (!output || typeof output !== "object") return null;
  const kind = (output as Record<string, unknown>)[VISUAL_KEY];

  return typeof kind === "string" && KINDS.has(kind) ? (kind as VisualKind) : null;
}
