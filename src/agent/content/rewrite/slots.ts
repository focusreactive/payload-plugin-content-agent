import type { SchemaContext, SchemaField } from "../../../types.js";
import type { DocumentWorkspace } from "../blockTools.js";
import { collectContentFields, getByPath, parsePath, resolveFieldAtPath } from "../discovery.js";
import { collectTextNodes } from "../lexicalEngine.js";
import type { LexicalNode, TextNode } from "../lexicalEngine.js";
import { sharedFieldRefusal } from "../sharedField.js";

/** `code` and `email` are left out on purpose. */
export const PROSE_TYPES = new Set(["text", "textarea"]);

export interface Slot {
  n: number;
  ref: string;
  text: string;
  node?: TextNode;
  seg?: number;
  linkNode?: LexicalNode;
  linkTarget?: string;
  block?: LexicalNode;
  part?: { ref: string; index: number };
  /** A write turned the entry's text node into several nodes (a link, bold). */
  rebuilt?: boolean;
}

const LONG_TEXT_CHARS = 1200;

export interface Parts {
  parts: string[];
  seps: string[];
}

export function collectSlots(
  workspace: DocumentWorkspace,
  rootFields: SchemaField[]
): {
  slots: Slot[];
  skipped: { ref: string; type: string }[];
  parts: Map<string, Parts>;
  known: Map<string, unknown>;
} {
  const doc = workspace.ref.current;
  const leaves = collectContentFields(rootFields, doc, {
    basePath: "",
    parentLocalized: false,
    warnings: [],
  });
  const slots: Slot[] = [];
  const skipped: { ref: string; type: string }[] = [];
  const parts = new Map<string, Parts>();
  const known = new Map<string, unknown>();
  let entryNumber = 0;

  for (const leaf of leaves) {
    if (leaf.richText) {
      if (leaf.embeddedInRichText) continue;
      const value = getByPath(doc, parsePath(leaf.ref));

      known.set(leaf.ref, value);
      const nodes = collectTextNodes(value);

      nodes.forEach((nodeRef, i) => {
        const text = typeof nodeRef.node?.text === "string" ? nodeRef.node.text : "";

        if (!text.trim()) return;
        slots.push({
          n: ++entryNumber,
          ref: leaf.ref,
          text,
          node: nodeRef.node,
          seg: i + 1,
          linkNode: nodeRef.linkNode,
          linkTarget: nodeRef.linkTarget,
          block: nodeRef.block,
        });
      });
      continue;
    }

    if (typeof leaf.value !== "string" || !leaf.value.trim()) continue;

    if (!PROSE_TYPES.has(leaf.type)) {
      if (["code", "email"].includes(leaf.type)) skipped.push({ ref: leaf.ref, type: leaf.type });
      continue;
    }

    known.set(leaf.ref, leaf.value);

    if (leaf.value.length > LONG_TEXT_CHARS) {
      const pieces = leaf.value.split(/(\n[ \t]*\n+)/u);
      const fieldParts: Parts = { parts: [], seps: [] };

      for (let i = 0; i < pieces.length; i += 1)
        (i % 2 === 0 ? fieldParts.parts : fieldParts.seps).push(pieces[i]);
      parts.set(leaf.ref, fieldParts);
      fieldParts.parts.forEach((text, index) => {
        if (!text.trim()) return;
        slots.push({
          n: ++entryNumber,
          ref: leaf.ref,
          text,
          seg: index + 1,
          part: { ref: leaf.ref, index },
        });
      });
      continue;
    }

    slots.push({ n: ++entryNumber, ref: leaf.ref, text: leaf.value });
  }

  return { slots, skipped, parts, known };
}

export function joinParts(fieldParts: Parts): string {
  let out = "";

  for (let i = 0; i < fieldParts.parts.length; i += 1)
    out += fieldParts.parts[i] + (fieldParts.seps[i] ?? "");

  return out;
}

export interface EditorSession {
  textPassReads: number;
  /** Read at each check: the editor can declare a shorter text after the session opened. */
  shrinkRatio?: () => number | null;
  /** Read at each check, as above: "more" when the editor declared that links are added. */
  linkIntent?: () => "fewer" | "more" | null;
}

interface ReadSnapshot {
  slots: Slot[];
  token: string;
  parts: Map<string, Parts>;
  known: Map<string, unknown>;
  origin: { n: number; text: string }[];
}

export interface RewriteContext {
  workspace: DocumentWorkspace;
  schema: SchemaContext;
  session?: EditorSession;
  // `reads` is a counter, not a timestamp:
  // two reads in the same millisecond must not share a token.
  state: { current: ReadSnapshot | null; reads: number };
}

export interface ApplyRun {
  byN: Map<string, Slot>;
  linksCreated: number;
  applied: string[];
  failed: { n: string; error: string }[];
  warnings: string[];
  touchedRefs: Set<string>;
  relinked: string[];
  appended: string[];
}

export const isOpen = ({ workspace }: RewriteContext) =>
  (workspace.collection || workspace.global) && workspace.ref.current != null;

export const rootFields = ({ workspace, schema }: RewriteContext): SchemaField[] =>
  workspace.global
    ? (schema.globals.find((global) => global.slug === workspace.global)?.fields ?? [])
    : (schema.collections.find((collection) => collection.slug === workspace.collection)?.fields ??
      []);

export const isStale = ({ workspace, state }: RewriteContext, ref: string): boolean => {
  const { current } = state;

  if (!current || !current.known.has(ref)) return false;
  const now = getByPath(workspace.ref.current, parsePath(ref));

  return now !== current.known.get(ref);
};

export const staleError = (key: string, ref: string) =>
  `Entry ${key}: "${ref}" changed after this readDocumentText (another tool wrote it). Nothing was written to it - call readDocumentText again and send this entry against the new numbering.`;

export function sharedRefusal(rewrite: RewriteContext, ref: string): string | null {
  const { workspace } = rewrite;
  const res = resolveFieldAtPath(rootFields(rewrite), workspace.ref.current, parsePath(ref));

  return res ? sharedFieldRefusal(workspace, ref, res.localized) : null;
}
