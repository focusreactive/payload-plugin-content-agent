import type { SanitizedConfig } from "payload";
import type { SchemaContext, SchemaField } from "../../../types.js";
import type { DocumentWorkspace } from "../blockTools.js";
import {
  isObjectLike,
  parsePath,
  getByPath,
  resolveFieldAtPath,
  collectContentFields,
} from "../discovery.js";
import { emptyRichText, ensureNonEmptyRichText } from "../schemaValues.js";
import { NO_OPEN_DOCUMENT } from "../noOpenDocument.js";
import type { EditAdvice } from "../editAdvice.js";

export type AppliedMode = "surgical" | "transform" | "trim";

interface AppliedInfo {
  ref: string;
  mode: AppliedMode;
  remaining?: number;
  nodeCount?: number;
}

interface RichTextGuards {
  /** Read at each check: the editor can declare a shorter text after the session opened. */
  shrinkRatio?: () => number | null;
  /** Read at each check, as above: "fewer" when the editor declared that links are removed. */
  linkIntent?: () => "fewer" | "more" | null;
  /** The next-step sentences, when the tools run for another caller than the content editor. */
  advice?: EditAdvice;
}

export interface RichTextToolsOptions {
  config?: SanitizedConfig;
  onApplied?: (info: AppliedInfo) => void;
  guards?: RichTextGuards;
}

export interface RichTextToolsContext extends RichTextToolsOptions {
  workspace: DocumentWorkspace;
  schema: SchemaContext;
  transformCoverage: Map<string, { nodeCount: number; covered: Set<number> }>;
}

export const notWrittenError = (ref: string): string =>
  `"${ref}" could not be written: its parent item is not in the document. Read the document again and copy the ref from it.`;

export function topLevelNodes(content: unknown): unknown[] {
  const root = isObjectLike(content) ? content.root : undefined;
  const children = isObjectLike(root) ? root.children : undefined;

  return Array.isArray(children) ? children : [];
}

const rootFields = ({ workspace, schema }: RichTextToolsContext) =>
  workspace.global
    ? (schema.globals.find((global) => global.slug === workspace.global)?.fields ?? [])
    : (schema.collections.find((collection) => collection.slug === workspace.collection)?.fields ??
      []);

function richTextSiblingHint(context: RichTextToolsContext, ref: string): string {
  try {
    const leaves = collectContentFields(rootFields(context), context.workspace.ref.current, {
      basePath: "",
      parentLocalized: false,
      warnings: [],
    });
    const richRefs = leaves.filter((leaf) => leaf.richText).map((leaf) => leaf.ref);

    if (!richRefs.length) return ". This document has no richText fields at all.";
    const container = ref.includes(".") ? ref.slice(0, ref.lastIndexOf(".")) : "";
    const near = container ? richRefs.filter((richRef) => richRef.startsWith(`${container}.`)) : [];
    const shown = (near.length ? near : richRefs).slice(0, 8);
    const scope = near.length ? "in this block" : "in this document";
    const more = (near.length ? near : richRefs).length - shown.length;

    return (
      `. richText ${scope}: ${shown.join(", ")}${more > 0 ? ` (+${more} more)` : ""}` +
      `. For a plain-text field use setValues; call getEditableContent for every field with its type.`
    );
  } catch {
    return "";
  }
}

// Payload does not enforce `admin.readOnly` on the server, and a non-Lexical editor's value is
// not `{root}`: both are refused here.
export function resolveRichText(
  context: RichTextToolsContext,
  ref: string
):
  | { content: Record<string, unknown>; field: SchemaField; localized: boolean }
  | { error: string; wrongType?: string | null } {
  const { workspace } = context;

  if ((!workspace.collection && !workspace.global) || workspace.ref.current == null)
    return { error: NO_OPEN_DOCUMENT };
  const path = parsePath(ref);
  const res = resolveFieldAtPath(rootFields(context), workspace.ref.current, path);

  if (!res || res.field?.type !== "richText")
    return {
      error:
        `"${ref}" is not a richText field (${res?.field?.type ?? "not found"})` +
        richTextSiblingHint(context, ref),
      wrongType: res?.field?.type ?? null,
    };
  if (res.readOnly) return { error: `"${ref}" is read-only and must not be modified.` };
  if (res.field.unsupported || (res.field.editor && res.field.editor !== "lexical"))
    return {
      error: `"${ref}" uses a "${res.field.editor ?? "unsupported"}" rich text editor, not Lexical - this agent can only edit Lexical richText fields.`,
    };
  const content = getByPath(workspace.ref.current, path);

  // An empty `root.children` fails every bounds check: heal a copy so the first node can be
  // added. The open document keeps its value until an edit writes the field.
  return {
    field: res.field,
    localized: !!res.localized,
    content:
      isObjectLike(content) && content.root
        ? ensureNonEmptyRichText(structuredClone(content))
        : emptyRichText(),
  };
}
