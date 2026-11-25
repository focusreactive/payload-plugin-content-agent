import { z } from "zod";
import { tool } from "ai";
import { TEXT_TYPES, parsePath, getByPath } from "../discovery.js";
import { editorSummary } from "../editorFit.js";
import { keyedMarkdownView } from "../../subAgents/lexicalMarkdown.js";
import { gluedBoundaries } from "../gluedSpaces.js";
import { collectTextNodes, inlineContext, isEmptyRichText } from "../lexicalEngine.js";
import type { TextNodeRef } from "../lexicalEngine.js";
import { resolveRichText } from "./context.js";
import type { RichTextToolsContext } from "./context.js";

function plainFieldView(
  { workspace }: RichTextToolsContext,
  ref: string,
  resolved: { error: string; wrongType?: string | null }
) {
  if ("wrongType" in resolved && resolved.wrongType && TEXT_TYPES.has(resolved.wrongType)) {
    const value = getByPath(workspace.ref.current, parsePath(ref));

    if (typeof value === "string") {
      return {
        ref,
        type: resolved.wrongType,
        value,
        note: `"${ref}" is a plain ${resolved.wrongType} field, not richText - here is its value. Write it with setValues({ edits: [{ ref, value }] }).`,
      };
    }
  }

  return { error: resolved.error };
}

/** The glued boundaries of a field, named by segment index, and the segments that fix them. */
export function gluedSegments(nodes: TextNodeRef[]) {
  const { glued, fix } = gluedBoundaries(
    nodes.map((nodeRef) => ({
      text: nodeRef.node.text,
      node: nodeRef.node,
      block: nodeRef.block,
      link: Boolean(nodeRef.linkNode),
    }))
  );

  return {
    glued: glued.map(({ left, right, shows }) => ({
      between: `${left ?? "prev"}|${right ?? "next"}`,
      shows,
    })),
    fix: fix as Record<string, string>,
  };
}

function transformView<Mode>(
  { transformCoverage }: RichTextToolsContext,
  ref: string,
  mode: Mode,
  content: Record<string, unknown>
) {
  if (isEmptyRichText(content)) {
    return {
      ref,
      mode,
      segments: {},
      hint: `This richText field is empty - there is nothing to transform. To write its first text call applyRichText({ ref: "${ref}", mode: "surgical", edits: [{ key: "0", action: "insertAfter", markdown: "<the text>" }] }).`,
    };
  }

  const nodes = collectTextNodes(content);
  const refs = nodes.map((nodeRef) => nodeRef.node);
  const segments: Record<number, string> = {};

  refs.forEach((textNode, i) => {
    segments[i] = textNode.text;
  });
  const linkTargets: Record<number, string> = {};

  nodes.forEach((nodeRef, i) => {
    if (nodeRef.linkTarget) linkTargets[i] = nodeRef.linkTarget;
  });
  const linkCount = Object.keys(linkTargets).length;
  const context: Record<number, { before: string; after: string }> = {};

  nodes.forEach((nodeRef, i) => {
    if (!nodeRef.block) return;
    const surrounding = inlineContext(nodeRef.block, nodeRef.node);

    if (surrounding.before || surrounding.after) context[i] = surrounding;
  });

  const { glued } = gluedSegments(nodes);

  transformCoverage.set(ref, { nodeCount: refs.length, covered: new Set() });

  return {
    ref,
    mode,
    segments,
    nodeCount: refs.length,
    ...(Object.keys(context).length ? { context } : {}),
    ...(glued.length ? { glued } : {}),
    ...(linkCount > 0 ? { linkTargets } : {}),
    ...(linkCount > 0
      ? {
          linkNote:
            `${linkCount} of these segment(s) are hyperlink ANCHORS - linkTargets maps the segment index to where it points. ` +
            "A transform changes the words of an existing anchor, never its target. So if you rewrite an anchor, its text must still describe the page it links to: " +
            "keep the wording compatible with the existing target, or leave that segment unchanged and report that the link needs repointing " +
            "(readDocumentText + applyDocumentText({ token, links }) changes where an existing link points, and surgical mode can remove the link entirely). " +
            "Never leave an anchor promising one thing while it navigates somewhere else.",
        }
      : {}),
    hint:
      'Transform each value as instructed, then call applyRichText({ ref, mode:"transform", segments, nodeCount }) with the SAME indices and the nodeCount from this view (guards against a stale view if the field changed since). Omit an index to leave it unchanged. Do NOT add or drop indices - that would change structure; use surgical mode for structural changes.' +
      (Object.keys(context).length
        ? ' A segment under "context" shares its paragraph with other segments: "before"/"after" are the exact characters next to it on the page, and they BELONG TO THE NEIGHBOURING SEGMENTS - never repeat them in this one. Segments render back to back exactly as stored, so if "before" ends with a letter and the segment starts with one, the words are glued: add the space inside ONE of the two segments. "glued" lists exactly those boundaries ("|" marks the spot): applyRichText({ ref, mode:"transform", nodeCount, fixGlued: true }) puts the one space at every listed boundary, outside the links, so a spacing task needs no retyped segment; boundaries not listed already have their space - do not shift spaces around there.'
        : "") +
      (refs.length > 40
        ? ` This field has ${refs.length} segments - that is too many for one reliable pass. Translate/transform and apply them in SEVERAL batches (e.g. ~30 indices per applyRichText call) instead of one giant call. Each response reports how many segments are still uncovered ("remaining") - for a WHOLE-FIELD task like translation, keep applying batches until remaining is 0. Do not stop early.`
        : ""),
  };
}

export interface ViewRichTextInput {
  ref: string;
  mode: "surgical" | "transform";
}

async function viewRichText(context: RichTextToolsContext, { ref, mode }: ViewRichTextInput) {
  const resolved = resolveRichText(context, ref);

  if ("error" in resolved) return plainFieldView(context, ref, resolved);
  if (mode === "transform") return transformView(context, ref, mode, resolved.content);

  const editor = editorSummary(resolved.field);

  return {
    ref,
    mode,
    content: await keyedMarkdownView(resolved.content),
    ...(editor ? { editor } : {}),
  };
}

export function createViewRichTextTool(context: RichTextToolsContext) {
  return tool({
    description:
      'View a richText field (by its ref from getEditableContent). "surgical" = an indexed view ([i] per top-level node) for STRUCTURAL edits (insert/replace/remove specific nodes). "transform" = a numbered map of the field\'s text segments, for a 1:1 TEXT transform of the whole field (translate / rewrite tone / fix grammar) that preserves all structure exactly.',
    inputSchema: z.object({
      ref: z
        .string()
        .describe('The richText field ref, e.g. "<field>" or "<blocksField>[<blockId>].<field>".'),
      mode: z
        .enum(["surgical", "transform"])
        .describe(
          "`surgical`: the indexed view of the top-level nodes, for an edit of the structure. `transform`: the numbered text segments, for a change of the words of the whole field."
        ),
    }),
    execute: (input: ViewRichTextInput) => viewRichText(context, input),
  });
}
