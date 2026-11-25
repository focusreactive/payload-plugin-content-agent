import { z } from "zod";
import { tool } from "ai";
import { parsePath, getByPath, setByPath } from "../discovery.js";
import { keyedMarkdownView } from "../../subAgents/lexicalMarkdown.js";
import type { SurgicalEdit } from "../../subAgents/lexicalMarkdown.js";
import { editorFitError } from "../editorFit.js";
import { collectTextNodes, validateLexical } from "../lexicalEngine.js";
import type { TextNode } from "../lexicalEngine.js";
import { ensureNonEmptyRichText } from "../schemaValues.js";
import { sharedFieldRefusal } from "../sharedField.js";
import { notWrittenError, resolveRichText, topLevelNodes } from "./context.js";
import type { AppliedMode, RichTextToolsContext } from "./context.js";
import { applySurgical, applyTransform } from "./surgical.js";
import { gluedSegments } from "./viewRichText.js";

export interface ApplyRichTextInput {
  ref: string;
  mode: "surgical" | "transform";
  edits?: SurgicalEdit[];
  segments?: Record<string, string>;
  nodeCount?: number;
  fixGlued?: boolean;
  removeText?: string;
}

function droppedNodesError(
  before: unknown,
  updated: unknown,
  { mode, edits }: ApplyRichTextInput
): string | null {
  const beforeNodes = topLevelNodes(before).length;
  const afterNodes = topLevelNodes(updated).length;
  const declaredRemoves =
    mode === "surgical" ? (edits?.filter((edit) => edit.action === "remove").length ?? 0) : 0;

  if (beforeNodes - afterNodes > declaredRemoves) {
    return (
      `Refusing - this edit drops content (${beforeNodes}→${afterNodes} top-level nodes, only ${declaredRemoves} removal(s) declared), which is loss/corruption, ` +
      `not the requested change. To ADD text use a surgical insertAfter; to CHANGE text use transform mode or a surgical ` +
      `replace; for removal use trimRichText or a remove action.`
    );
  }

  return null;
}

interface TransformOutcome<Mode> {
  ref: string;
  mode: Mode;
  segments: Record<string, string>;
  transformRefs: TextNode[];
  transformApplied: number;
  linksCreated: number;
}

function transformReport<Mode extends AppliedMode>(
  { transformCoverage, onApplied }: RichTextToolsContext,
  { ref, mode, segments, transformRefs, transformApplied, linksCreated }: TransformOutcome<Mode>
) {
  let coverage = transformCoverage.get(ref);

  if (!coverage || coverage.nodeCount !== transformRefs.length)
    coverage = { nodeCount: transformRefs.length, covered: new Set() };
  for (const key of Object.keys(segments)) coverage.covered.add(Number(key));
  transformCoverage.set(ref, coverage);
  const remaining = coverage.nodeCount - coverage.covered.size;

  onApplied?.({ ref, mode, remaining, nodeCount: coverage.nodeCount });

  return {
    ok: true,
    ref,
    mode,
    applied: transformApplied,
    covered: coverage.covered.size,
    nodeCount: coverage.nodeCount,
    remaining,
    ...(linksCreated > 0
      ? {
          linksCreated,
          linksNote: `${linksCreated} markdown link(s) in your segments became real link nodes. The field now has more text segments than this view showed, so the indices have moved: call viewRichText(mode:"transform") again before any further transform edit on this field.`,
        }
      : {}),
    ...(remaining === 0 && linksCreated === 0
      ? { hint: "Every segment in this field is covered - no need to view it again." }
      : {}),
    ...(remaining > 0
      ? {
          note: `${remaining} of ${coverage.nodeCount} text segment(s) in this field are not covered by any apply yet (still in their original form). When the task changes the WHOLE field (a translation, a rewrite of all of it), call viewRichText(mode:"transform") again and applyRichText with the remaining indices, and do not report the field as done until remaining is 0. When the task changes only some of the text, the other segments must stay as they are: do not apply them.`,
        }
      : {}),
  };
}

const NOTHING_GLUED =
  "Nothing was written: no two words run together in this field, so there is no space to add. Do not move spaces anywhere else; report that the spacing is already right.";

/** What is still glued after a transform that was about spacing or that made a glued boundary. */
function gluedLeft(ref: string, before: string[], updated: unknown, asked: boolean) {
  const { glued } = gluedSegments(collectTextNodes(updated));
  const made = glued.filter((boundary) => !before.includes(boundary.between));

  if (!glued.length || !(asked || made.length || glued.length < before.length)) return {};

  return {
    gluedLeft: glued,
    gluedNote: `${glued.length} boundar${glued.length === 1 ? "y" : "ies"} still join${glued.length === 1 ? "s" : ""} two words with no space${made.length ? ` (${made.length} of them made by this write)` : ""}. Call viewRichText({ ref: "${ref}", mode: "transform" }) and then applyRichText with its nodeCount and fixGlued: true: the tool puts the one space at each of them.`,
  };
}

const EMPTY_SEGMENT =
  'An empty segment removes text by its index alone, and an index that is off by one removes the wrong text. Name the text instead: applyRichText({ ref, mode: "transform", removeText: "<the exact text to remove>" }) - the tool finds it and removes it, and nothing else.';

/** A parameter of the other mode: the call would run without it and say nothing. */
function otherModeError({ mode, edits, segments, removeText, fixGlued }: ApplyRichTextInput) {
  const sent =
    mode === "surgical"
      ? [
          Object.keys(segments ?? {}).length ? "segments" : null,
          removeText !== undefined ? "removeText" : null,
          fixGlued ? "fixGlued" : null,
        ].filter((name) => name !== null)
      : edits?.length
        ? ["edits"]
        : [];

  if (!sent.length) return null;
  const names = sent.map((name) => `\`${name}\``).join(", ");

  return mode === "surgical"
    ? `Nothing was written: ${names} belong${sent.length === 1 ? "s" : ""} to mode "transform", and this call is in mode "surgical", which takes only \`edits\`. Send one call for each mode: this one without ${names}, and a second one with mode "transform".`
    : `Nothing was written: \`edits\` belongs to mode "surgical", and this call is in mode "transform", which takes \`segments\`, \`removeText\` and \`fixGlued\`. Send one call for each mode: this one without \`edits\`, and a second one with mode "surgical".`;
}

/** The named text as a pattern: letter case and the amount of white space do not matter. */
function namedTextPattern(text: string): RegExp | null {
  const words = text.trim().split(/\s+/u).filter(Boolean);

  if (!words.length) return null;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));

  return new RegExp(`\\s*${escaped.join("\\s+")}`, "giu");
}

/** The segments of a field without the named text, for a removal that names what it removes. */
function removalSegments(
  content: unknown,
  removeText: string
): { segments: Record<string, string>; removed: number } | { error: string } {
  const pattern = namedTextPattern(removeText);

  if (!pattern) return { error: "`removeText` is empty: pass the exact text to remove." };
  const segments: Record<string, string> = {};
  let removed = 0;

  collectTextNodes(content).forEach((nodeRef, index) => {
    const { text } = nodeRef.node;
    const hits = text.match(pattern)?.length ?? 0;

    if (!hits) return;
    removed += hits;
    const rest = text.replace(pattern, "");

    segments[String(index)] = rest.trim() ? rest : "";
  });

  if (!removed)
    return {
      error: `No text segment of this field holds ${JSON.stringify(removeText)} (letter case and spacing aside). Nothing was removed. The text may differ in a word, or run across a link or a bold run: view the field in transform mode and send the exact text of one segment, or report that the field does not hold it.`,
    };

  return { segments, removed };
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** A segment that had words and keeps only marks: a removal that left characters behind. */
function residueNote(before: unknown, segments: Record<string, string> | undefined) {
  const nodes = collectTextNodes(before);
  const left = Object.entries(segments ?? {}).filter(([key, value]) => {
    const old = nodes[Number(key)]?.node.text;

    return (
      typeof old === "string" &&
      typeof value === "string" &&
      WORD_CHAR.test(old) &&
      value.length > 0 &&
      !WORD_CHAR.test(value)
    );
  });

  if (!left.length) return {};

  return {
    residue: left.map(([key, value]) => ({ segment: key, now: value })),
    residueNote: `${left.length} segment(s) lost every word and now hold only the characters shown under "residue". When the task was to REMOVE that text, those characters are left over on the page: call applyRichText({ ref, mode: "transform", removeText: "<these characters with the words around them, as the field now reads>" }) or put the segment back as it was and remove the text with removeText. When you meant to put exactly these characters there, no action is needed.`,
  };
}

/** The segments a transform call writes: what the model sent, the glued fixes and the removal. */
function transformPlan(
  input: ApplyRichTextInput,
  content: unknown,
  gluedFix: Record<string, string>
):
  | { segments: Record<string, string> | undefined; removal: { removed: number } | null }
  | { error: string } {
  const otherMode = otherModeError(input);

  if (otherMode) return { error: otherMode };
  if (input.mode !== "transform") return { segments: input.segments, removal: null };
  if (Object.values(input.segments ?? {}).some((value) => value === ""))
    return { error: EMPTY_SEGMENT };
  const removal =
    input.removeText === undefined ? null : removalSegments(content, input.removeText);

  if (removal && "error" in removal) return removal;
  if (!input.fixGlued && !removal) return { segments: input.segments, removal: null };

  return {
    segments: { ...(input.fixGlued ? gluedFix : {}), ...input.segments, ...removal?.segments },
    removal,
  };
}

/** Indices the model sends come from its last view: without a nodeCount, that view's count still
 * refuses a field that changed since. */
const expectedNodeCount = (
  { transformCoverage }: RichTextToolsContext,
  { ref, nodeCount, segments }: ApplyRichTextInput
) =>
  nodeCount ??
  (Object.keys(segments ?? {}).length ? transformCoverage.get(ref)?.nodeCount : undefined);

async function applyRichText(context: RichTextToolsContext, input: ApplyRichTextInput) {
  const { workspace, config, onApplied } = context;
  const { ref, mode, edits, fixGlued } = input;
  const resolved = resolveRichText(context, ref);

  if ("error" in resolved) return { error: resolved.error };
  const shared = sharedFieldRefusal(workspace, ref, resolved.localized);

  if (shared) return { error: shared };
  const before = gluedSegments(collectTextNodes(resolved.content));

  const plan = transformPlan(input, resolved.content, before.fix);

  if ("error" in plan) return { error: plan.error };
  const { segments, removal } = plan;

  if (mode === "transform" && fixGlued && !Object.keys(segments ?? {}).length)
    return { error: NOTHING_GLUED };

  try {
    let updated: unknown;
    let transformRefs: TextNode[] = [];
    let transformApplied = 0;
    let linksCreated = 0;

    if (mode === "surgical") {
      const result = await applySurgical(context, resolved.content, edits);

      if ("error" in result) return { error: result.error };
      updated = result.updated;
    } else {
      const result = applyTransform(resolved.content, segments, expectedNodeCount(context, input));

      if ("error" in result) return { error: result.error };
      ({ updated, refs: transformRefs, applied: transformApplied, linksCreated } = result);
    }

    const dropError = droppedNodesError(resolved.content, updated, input);

    if (dropError) return { error: dropError };

    const fitError = editorFitError(resolved.field, resolved.content, updated);

    if (fitError) return { error: fitError };

    const shadow = await validateLexical(updated, config, resolved.field);

    if (!shadow.ok)
      return {
        error: `Nothing was written: the edit would produce rich text that the editor of this field does not accept (${shadow.reason}). Call viewRichText({ ref: "${ref}", mode: "${mode}" }) and send the edit again with plain text, or with the markdown that this view shows.`,
      };

    if (!setByPath(workspace.ref.current, parsePath(ref), ensureNonEmptyRichText(updated)))
      return { error: notWrittenError(ref) };

    if (mode === "transform") {
      return {
        ...transformReport(context, {
          ref,
          mode,
          segments: segments!,
          transformRefs,
          transformApplied,
          linksCreated,
        }),
        ...(removal ? { removedOccurrences: removal.removed } : {}),
        ...residueNote(resolved.content, segments),
        ...gluedLeft(
          ref,
          before.glued.map((boundary) => boundary.between),
          updated,
          Boolean(fixGlued)
        ),
      };
    }

    onApplied?.({ ref, mode });

    return {
      ok: true,
      ref,
      mode,
      view: await keyedMarkdownView(getByPath(workspace.ref.current, parsePath(ref))),
      hint: "This is the field AFTER your edit, with fresh node indices - use it directly for the next surgical edit instead of calling viewRichText again.",
    };
  } catch (err) {
    return {
      error: `Nothing was written: the edit failed (${err instanceof Error ? err.message : String(err)}). Call viewRichText({ ref: "${ref}", mode: "${mode}" }) and send the edit again against that view.`,
    };
  }
}

export function createApplyRichTextTool(context: RichTextToolsContext) {
  return tool({
    description:
      'Apply edits to a richText field (by ref), writing back into the open document. "surgical": structural edits referencing node indices from the surgical view (insertAfter to add, replace/remove a node). "transform": a { index: newText } map from the transform view - a LOSSLESS 1:1 text transform (translate / tone / grammar) that never changes structure.',
    inputSchema: z.object({
      ref: z.string().describe("The richText field ref."),
      mode: z
        .enum(["surgical", "transform"])
        .describe(
          "The mode of the view you read the field in. `surgical` takes `edits`; `transform` takes the map of segment index to new text."
        ),
      edits: z
        .array(
          z.object({
            key: z
              .union([z.string(), z.number().int().min(0)])
              .describe(
                "Node index from the surgical view: the whole number in brackets before the node, with no other character."
              ),
            action: z
              .enum(["replace", "remove", "insertAfter", "insertBefore"])
              .describe(
                "`replace` puts `markdown` in place of the node. `remove` deletes the node. `insertAfter` and `insertBefore` add `markdown` as new content next to the node and leave the node as it is."
              ),
            markdown: z
              .string()
              .optional()
              .describe(
                "The new content as markdown, not HTML. Required and not empty for replace, insertAfter and insertBefore. Omit it for remove."
              ),
            expectedText: z
              .string()
              .optional()
              .describe(
                "REQUIRED for replace/remove of a text node: a distinctive snippet of that node's current text (verifies the index is right; refuses if it does not match or is ambiguous)."
              ),
            expectedType: z
              .string()
              .optional()
              .describe(
                'Use instead of expectedText for text-less structural nodes (e.g. "upload", "block"): the target node\'s type.'
              ),
          })
        )
        .optional()
        .describe('Surgical edits (mode:"surgical")'),
      segments: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Transform map { index: newText } from the transform view (mode:"transform"). A segment is never empty here: to remove text use `removeText`.'
        ),
      nodeCount: z
        .number()
        .optional()
        .describe(
          'The nodeCount returned by viewRichText(mode:"transform") - pass it back so a stale view (field changed since) is detected and refused, instead of applying.'
        ),
      removeText: z
        .string()
        .optional()
        .describe(
          'mode:"transform" only. The exact text to remove from the field, as the task names it. The tool finds it (letter case and spacing aside) and removes it and nothing else; the result says how many occurrences it removed. Use it for every removal of a phrase, a sentence or a note: an index is not needed and an empty segment is refused.'
        ),
      fixGlued: z
        .boolean()
        .optional()
        .describe(
          'mode:"transform" only. true: the tool itself puts one space at every boundary that the transform view lists under "glued" (two words that run together where a link or a bold run meets the text). It needs no `segments` for them and changes nothing else.'
        ),
    }),
    execute: ({ edits, ...input }) =>
      applyRichText(context, {
        ...input,
        ...(edits ? { edits: edits.map((edit) => ({ ...edit, key: String(edit.key) })) } : {}),
      }),
  });
}
