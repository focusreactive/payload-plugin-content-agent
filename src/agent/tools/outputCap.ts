import { isRecord } from "../../borders.js";
import { isObjectLike } from "../content/discovery.js";
import { mcpText } from "../mcpParse.js";

// The AI SDK stores the raw execute() result and resends it on every later turn.
// `toModelOutput` does not change what is stored, so the cap applies to the result itself.
export const MAX_STRIPPED_JSON_CHARS = 40_000;

export function stringifyCapped(value: unknown): string {
  const json = JSON.stringify(value);

  if (json.length <= MAX_STRIPPED_JSON_CHARS) return json;

  return (
    json.slice(0, MAX_STRIPPED_JSON_CHARS) +
    `... [truncated, ${json.length} chars total - this result is too large to keep in full, and this is not its end. For the content of a document call readDocument({ view: "text" }) and follow its \`next\` cursor, for one part readDocument({ path }); for a list narrow it with \`where\`, \`limit\` or \`fields\`]`
  );
}

export function capJsonRows(text: string, limit: number = MAX_STRIPPED_JSON_CHARS): string | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isObjectLike(parsed)) return null;

  let holder: Record<string, unknown> | null = null;
  let rows: unknown[] = [];
  let key = "";
  let best = 0;

  if (Array.isArray(parsed)) {
    holder = { items: parsed };
    rows = parsed;
    key = "items";
    best = parsed.length;
  } else {
    for (const [name, value] of Object.entries(parsed)) {
      if (Array.isArray(value) && value.length > best) {
        holder = parsed;
        rows = value;
        key = name;
        best = value.length;
      }
    }
  }

  if (!holder || best === 0) return null;

  const build = (keep: number) =>
    JSON.stringify({
      ...holder,
      [key]: rows.slice(0, keep),
      ...(keep < rows.length
        ? {
            _truncated: `kept ${keep} of ${rows.length} "${key}" rows - the full result was ${text.length} chars, over the ${limit} cap. Narrow the query (a smaller limit, fewer columns, a filter) if you need the rest; do NOT assume the omitted rows are empty.`,
          }
        : {}),
    });

  let low = 0;
  let high = rows.length;
  let bestFit = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (mid === 0) break;
    const candidate = build(mid);

    if (candidate.length <= limit) {
      bestFit = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return bestFit || null;
}

/**
 * Keeps the result of an MCP tool under the size the agent can hold. A result over the limit
 * loses rows or text, and says so in the result.
 * @beta
 */
export function capMcpToolOutput<Result>(result: Result): Result | string {
  if (result === undefined) return result;
  const text = mcpText(result);

  if (text.length <= MAX_STRIPPED_JSON_CHARS) return result;
  const capped =
    capJsonRows(text) ??
    text.slice(0, MAX_STRIPPED_JSON_CHARS) +
      `... [truncated, ${text.length} chars total - this tool's output is too large to keep in full. ` +
      `This is not the end of the content and not a reason to ask the user how to proceed: for a document's content use readDocument({ view: "text" }) and follow its \`next\` cursor, for its structure readDocument({ view: "outline" }), for one section readDocument({ path }); for a list narrow it with where/limit or use searchContent]`;

  if (isRecord(result) && Array.isArray(result.content) && result.content[0]) {
    const first: unknown = result.content[0];

    return {
      ...result,
      content: [{ ...(isRecord(first) ? first : {}), text: capped }, ...result.content.slice(1)],
    };
  }

  return capped;
}
