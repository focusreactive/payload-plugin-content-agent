import { isRecord } from "../../borders.js";
import type { SchemaField } from "../../types.js";

const CORE_TYPES = ["paragraph", "text", "linebreak", "tab"];
const ROOT_TYPE = "root";
const INLINE_LEAVES = new Set(["text", "linebreak", "tab"]);

// Lexical's text format bits, each next to the key of the Payload feature that turns it on.
const TEXT_FORMATS: ReadonlyArray<readonly [number, string]> = [
  [1, "bold"],
  [2, "italic"],
  [4, "strikethrough"],
  [8, "underline"],
  [16, "inlineCode"],
  [32, "subscript"],
  [64, "superscript"],
];

interface Usage {
  nodes: Map<string, number>;
  formats: Map<string, number>;
}

export interface Misfit {
  nodes: string[];
  formats: string[];
}

const bump = (counts: Map<string, number>, key: string) =>
  counts.set(key, (counts.get(key) ?? 0) + 1);

// Children only: rich text nested in the fields of a block belongs to another editor.
function usageOf(content: unknown): Usage {
  const usage: Usage = { nodes: new Map(), formats: new Map() };

  const walk = (node: unknown): void => {
    if (!isRecord(node)) return;
    if (typeof node.type === "string") bump(usage.nodes, node.type);

    if (node.type === "text" && typeof node.format === "number") {
      for (const [bit, name] of TEXT_FORMATS) if (node.format & bit) bump(usage.formats, name);
    }

    if (Array.isArray(node.children)) node.children.forEach(walk);
  };

  walk(isRecord(content) ? (content.root ?? content) : content);

  return usage;
}

const added = (before: Map<string, number>, after: Map<string, number>): string[] =>
  [...after].filter(([key, count]) => count > (before.get(key) ?? 0)).map(([key]) => key);

const nodesOf = (field: SchemaField): Set<string> | null =>
  field.nodeTypes ? new Set([ROOT_TYPE, ...CORE_TYPES, ...field.nodeTypes]) : null;

const formatsOf = (field: SchemaField): string[] | null =>
  field.features
    ? TEXT_FORMATS.map(([, name]) => name).filter((name) => field.features!.includes(name))
    : null;

/** What a write adds that the field's own editor does not have. An unknown editor fits anything. */
function editorMisfit(field: SchemaField, before: unknown, after: unknown): Misfit | null {
  const nodes = nodesOf(field);
  const formats = formatsOf(field);
  const was = usageOf(before);
  const now = usageOf(after);
  const misfit: Misfit = {
    nodes: nodes ? added(was.nodes, now.nodes).filter((type) => !nodes.has(type)) : [],
    formats: formats
      ? added(was.formats, now.formats).filter((name) => !formats.includes(name))
      : [],
  };

  return misfit.nodes.length || misfit.formats.length ? misfit : null;
}

const quoted = (names: string[]) => names.map((name) => `"${name}"`).join(", ");

/** What the field's own editor has, as one line for a tool result. */
export function editorSummary(field: SchemaField): string | undefined {
  if (!field.nodeTypes) return undefined;
  const has = formatsOf(field);

  return (
    `Node types it has: ${[...CORE_TYPES, ...field.nodeTypes].join(", ")}.` +
    (has ? ` Text formats it has: ${has.length ? has.join(", ") : "none"}.` : "")
  );
}

function misfitError(field: SchemaField, { nodes, formats }: Misfit): string {
  const missing = [
    nodes.length ? `no ${quoted(nodes)} node` : "",
    formats.length ? `no ${quoted(formats)} text format` : "",
  ].filter(Boolean);
  const summary = editorSummary(field);

  return (
    `The editor of "${field.name}" has ${missing.join(" and ")}, so nothing was written. ` +
    (summary ? `${summary} ` : "") +
    `Send the same content again with these only.`
  );
}

export function editorFitError(field: SchemaField, before: unknown, after: unknown): string | null {
  const misfit = editorMisfit(field, before, after);

  return misfit ? misfitError(field, misfit) : null;
}

/** For a writer that changes the document in place: the check runs before the write. */
export function inlineMarkupError(
  field: SchemaField | undefined,
  marks: { links: number; bold: number }
): string | null {
  if (!field) return null;
  const misfit: Misfit = {
    nodes: marks.links > 0 && nodesOf(field)?.has("link") === false ? ["link"] : [],
    formats: marks.bold > 0 && formatsOf(field)?.includes("bold") === false ? ["bold"] : [],
  };

  return misfit.nodes.length || misfit.formats.length ? misfitError(field, misfit) : null;
}

type Node = Record<string, unknown>;

const isInline = (node: unknown): boolean =>
  isRecord(node) && typeof node.type === "string" && INLINE_LEAVES.has(node.type);

function paragraphOf(children: Node[]): Node {
  return {
    type: "paragraph",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    textFormat: 0,
    textStyle: "",
    children,
  };
}

/**
 * Rewrites content made for any editor into what this field's editor has: a node of a missing
 * type gives way to its children (in a paragraph when they are inline), a missing text format is
 * cleared.
 */
export function simplifyForEditor(
  field: SchemaField,
  content: unknown
): { content: unknown; simplified: string[] } {
  const nodes = nodesOf(field);
  const formats = formatsOf(field);
  const simplified = new Set<string>();

  if (!isRecord(content) || !isRecord(content.root) || (!nodes && !formats))
    return { content, simplified: [] };
  const { root } = content;
  const top: unknown[] = Array.isArray(root.children) ? root.children : [];

  const offBits = formats
    ? TEXT_FORMATS.filter(([, name]) => !formats.includes(name)).reduce(
        (bits, [bit]) => bits | bit,
        0
      )
    : 0;

  const fitText = (node: Node): Node => {
    if (typeof node.format !== "number" || !(node.format & offBits)) return node;

    for (const [bit, name] of TEXT_FORMATS) if (node.format & bit & offBits) simplified.add(name);

    return { ...node, format: node.format & ~offBits };
  };

  const fit = (list: unknown[], inlineLevel: boolean): Node[] =>
    list.filter(isRecord).flatMap((node): Node[] => {
      if (node.type === "text") return [fitText(node)];
      const children: unknown[] = Array.isArray(node.children) ? node.children : [];
      const holdsInline = children.some(isInline);
      const type = typeof node.type === "string" ? node.type : "";

      if (!nodes || nodes.has(type))
        return [Array.isArray(node.children) ? { ...node, children: fit(children, true) } : node];
      simplified.add(type);
      const kept = fit(children, inlineLevel || holdsInline);

      if (!kept.length) return [];

      return inlineLevel || !holdsInline ? kept : [paragraphOf(kept)];
    });

  return {
    content: { ...content, root: { ...root, children: fit(top, false) } },
    simplified: [...simplified],
  };
}
