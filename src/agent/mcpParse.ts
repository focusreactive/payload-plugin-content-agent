import { isRecord } from "../borders.js";
import type { McpCallOptions, PayloadDoc } from "../borders.js";

// A plugin-mcp find returns text with one fenced ```json block per document.
// findById, create and update return one bare object after a text prefix.
type McpExecute = (params: Record<string, unknown>, options: McpCallOptions) => unknown;

function firstText(result: unknown): string | undefined {
  if (!isRecord(result) || !Array.isArray(result.content)) return undefined;
  const first: unknown = result.content[0];

  return isRecord(first) && typeof first.text === "string" ? first.text : undefined;
}

export const isMcpError = (result: unknown): boolean => isRecord(result) && Boolean(result.isError);

export function mcpText(result: unknown): string {
  return firstText(result) ?? (typeof result === "string" ? result : JSON.stringify(result));
}

// plugin-mcp does not throw on a rejected write: it returns a normal result whose text is an error.
export function mcpWriteError(result: unknown): string | null {
  if (isMcpError(result)) return mcpText(result).slice(0, 400);
  // The write gate refuses with a plain `{ error }`, not with a tool result.
  if (isRecord(result) && typeof result.error === "string") return result.error.slice(0, 400);
  const text = mcpText(result);
  // Only the status prefix is matched:
  // the echoed document's own prose may contain words like "error".
  const docStart = text.search(/```json|\{/u);
  const prefix = docStart === -1 ? text : text.slice(0, docStart);

  if (
    /(^|\n)\s*(❌|Error\b|Error:)/u.test(prefix) ||
    /\bError (updating|creating|deleting)\b/iu.test(prefix) ||
    /Invalid JSON|must be provided|validation/iu.test(prefix)
  ) {
    return text.slice(0, 400);
  }

  return null;
}

// The Payload MCP update tool refuses the `id` of an array row,
// although every row it returns has one.
export function refusedRowIdPaths(errorText: string): (string | number)[][] {
  const paths: (string | number)[][] = [];

  // Payload MCP 3.91 and later: "Unrecognized key(s) in object: 'id' at steps[0]".
  for (const match of errorText.matchAll(
    /Unrecognized key\(s\) in object: ([^\n]*?) at ([A-Za-z0-9_.[\]-]+)/gu
  )) {
    if (!/'id'/u.test(match[1])) continue;
    paths.push(
      [...match[2].matchAll(/([^.[\]]+)|\[(\d+)\]/gu)].map((seg) =>
        seg[2] !== undefined ? Number(seg[2]) : seg[1]
      )
    );
  }

  if (paths.length) return paths;
  // Earlier versions: the zod issue list as JSON.
  if (!/unrecognized_keys/u.test(errorText)) return [];
  const issue =
    /"code":\s*"unrecognized_keys",\s*"keys":\s*\[([^\]]*)\],\s*"path":\s*\[([^\]]*)\]/gu;

  for (const match of errorText.matchAll(issue)) {
    if (!/"id"/u.test(match[1])) continue;

    try {
      paths.push(JSON.parse(`[${match[2]}]`));
    } catch {}
  }

  return paths;
}

function childAt(node: unknown, key: string | number): unknown {
  if (Array.isArray(node)) return node[Number(key)];

  return isRecord(node) ? node[key] : undefined;
}

export function withoutRowIds(
  params: Record<string, unknown>,
  paths: (string | number)[][]
): Record<string, unknown> {
  const copy = structuredClone(params);

  for (const path of paths) {
    let node: unknown = copy;

    for (const key of path) node = childAt(node, key);
    if (isRecord(node)) delete node.id;
  }

  return copy;
}

export async function executeMcpWrite(
  execute: McpExecute,
  params: Record<string, unknown>,
  options: McpCallOptions
): Promise<unknown> {
  let current = params;

  for (let attempt = 0; ; attempt++) {
    let text: string;

    try {
      const res = await execute(current, options);

      text = isMcpError(res) ? mcpText(res) : "";
      if (!text) return res;
      const paths = attempt < 5 ? refusedRowIdPaths(text) : [];

      if (!paths.length) return res;
      current = withoutRowIds(current, paths);
    } catch (err) {
      text = err instanceof Error ? err.message : String(err);
      const paths = attempt < 5 ? refusedRowIdPaths(text) : [];

      if (!paths.length) throw err;
      current = withoutRowIds(current, paths);
    }
  }
}

export interface McpFindResult {
  docs: PayloadDoc[];
  totalDocs: number;
  totalPages: number;
  page: number;
  /** The text stated the total and the page count. False: both are only what this page shows. */
  counted: boolean;
}

function firstBalancedObject(
  text: string,
  from: number,
  to: number
): { json: string; end: number } | null {
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;

  for (let i = from; i < to; i++) {
    const char = text[i];

    if (inStr) {
      if (esc) esc = false;
      else if (char === "\\") esc = true;
      else if (char === '"') inStr = false;
      continue;
    }

    if (char === '"') inStr = true;
    else if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}") {
      if (depth > 0 && --depth === 0 && start !== -1)
        return { json: text.slice(start, i + 1), end: i + 1 };
    }
  }

  return null;
}

function parseJsonObject(json: string): PayloadDoc | null {
  try {
    const parsed: unknown = JSON.parse(json);

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseDocsFromText(text: string): { docs: PayloadDoc[]; fenced: boolean } {
  const docs: PayloadDoc[] = [];
  // Only a fence at the start of a line counts:
  // a document's own text may contain ```json inside a string.
  const fenceRe = /(^|\n)\s{0,3}```json[^\S\n]*\n?/gu;
  const opens: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(text)) !== null) opens.push(match.index + match[0].length);

  if (opens.length > 0) {
    for (let fenceIndex = 0; fenceIndex < opens.length; fenceIndex++) {
      const to = fenceIndex + 1 < opens.length ? opens[fenceIndex + 1] : text.length;
      const found = firstBalancedObject(text, opens[fenceIndex], to);
      const doc = found && parseJsonObject(found.json);

      if (doc) docs.push(doc);
    }

    return { docs, fenced: true };
  }

  let i = 0;

  while (i < text.length) {
    const found = firstBalancedObject(text, i, text.length);

    if (!found) break;
    const doc = parseJsonObject(found.json);

    if (doc) docs.push(doc);
    i = found.end;
  }

  return { docs, fenced: false };
}

export function parseMcpFind(result: unknown): McpFindResult {
  const text = mcpText(result);
  const { docs: parsed, fenced } = parseDocsFromText(text);

  // A page of a list, not one document that has a field named `docs`.
  const page = !fenced && parsed.length === 1 ? parsed[0] : undefined;
  const wrapped =
    page && Array.isArray(page.docs) && typeof page.totalDocs === "number" ? page.docs : undefined;
  const docs: PayloadDoc[] = Array.isArray(wrapped) ? wrapped.filter(isRecord) : parsed;

  const totalMatch = text.match(/Total:\s*(\d+)\s+document/iu);
  const pageMatch = text.match(/Page:\s*(\d+)\s+of\s+(\d+)/iu);

  return {
    docs,
    totalDocs: Number(totalMatch?.[1] ?? docs.length),
    totalPages: Number(pageMatch?.[2] ?? 1),
    page: Number(pageMatch?.[1] ?? 1),
    counted: !!totalMatch && !!pageMatch,
  };
}

/** One document in the shape of a Payload MCP write result. */
export const mcpDocResult = (doc: PayloadDoc) => ({
  content: [{ type: "text" as const, text: `Document saved.\n${JSON.stringify(doc)}` }],
});

export function parseMcpDoc(result: unknown): PayloadDoc | null {
  return parseMcpFind(result).docs[0] ?? null;
}
