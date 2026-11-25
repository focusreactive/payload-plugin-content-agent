import { z } from "zod";
import { tool } from "ai";
import { parsePath, setByPath } from "../discovery.js";
import { topLevelHeadings, trimAfterHeading } from "../../subAgents/programmaticOps.js";
import { ensureNonEmptyRichText } from "../schemaValues.js";
import { sharedFieldRefusal } from "../sharedField.js";
import { notWrittenError, resolveRichText } from "./context.js";
import type { RichTextToolsContext } from "./context.js";

const BY_INDEX = (ref: string) =>
  `call viewRichText({ ref: "${ref}", mode: "surgical" }) and remove the nodes with "remove" edits of applyRichText, each by its index`;

/** Why nothing was trimmed, with the headings the field has. */
function notTrimmed(content: unknown, ref: string, headingText: string, matches?: number) {
  const headings = topLevelHeadings(content);

  if (matches)
    return {
      message: `Nothing was removed: ${matches} headings of this field read "${headingText}", and this tool cannot tell them apart. To remove one of these sections ${BY_INDEX(ref)}.`,
    };
  if (!headings.length)
    return {
      message: `Nothing was removed: this field has no heading at its top level, so there is no section to trim. To remove content ${BY_INDEX(ref)}.`,
    };

  return {
    message: `Nothing was removed: no heading of this field reads "${headingText}". The match is the whole text of a heading, letter case aside. Its headings are under \`headings\`: send one of them as \`headingText\`, or say in your summary that the section is not in the field.`,
    headings,
  };
}

async function trimRichText(
  context: RichTextToolsContext,
  { ref, headingText }: { ref: string; headingText: string }
) {
  const resolved = resolveRichText(context, ref);

  if ("error" in resolved) return { error: resolved.error };
  const shared = sharedFieldRefusal(context.workspace, ref, resolved.localized);

  if (shared) return { error: shared };
  const {
    content: trimmed,
    removedCount,
    matches,
  } = trimAfterHeading(resolved.content, headingText);

  if (removedCount === 0)
    return { ok: false, ref, ...notTrimmed(resolved.content, ref, headingText, matches) };
  if (!setByPath(context.workspace.ref.current, parsePath(ref), ensureNonEmptyRichText(trimmed)))
    return { error: notWrittenError(ref) };
  context.onApplied?.({ ref, mode: "trim" });

  return { ok: true, ref, removedCount };
}

export function createTrimRichTextTool(context: RichTextToolsContext) {
  return tool({
    description:
      "Deterministically remove a heading and everything after it in a richText field (by ref). Use it to remove a named section and all that follows it.",
    inputSchema: z.object({
      ref: z.string().describe("The richText field ref."),
      headingText: z
        .string()
        .describe(
          "The whole text of one top-level heading of the field, letter case aside. A part of a heading does not match."
        ),
    }),
    execute: (input: { ref: string; headingText: string }) => trimRichText(context, input),
  });
}
