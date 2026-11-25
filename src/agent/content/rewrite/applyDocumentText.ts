import { tool } from "ai";
import { z } from "zod";
import { applyAppends } from "./appendEntries.js";
import { applyLinkEntries } from "./linkEntries.js";
import { isOpen } from "./slots.js";
import type { ApplyRun, RewriteContext, Slot } from "./slots.js";
import { gluedEntries } from "./readDocumentText.js";
import { applyTextEntries } from "./textEntries.js";
import { NO_OPEN_DOCUMENT } from "../noOpenDocument.js";

export interface ApplyDocumentTextInput {
  token?: string;
  text?: Record<string, string>;
  links?: Record<string, string>;
  append?: Record<string, string>;
  fixGlued?: boolean;
}

function refusal(rewrite: RewriteContext, input: ApplyDocumentTextInput): string | null {
  const { token, text = {}, links, append, fixGlued } = input;
  const { current } = rewrite.state;

  if (!isOpen(rewrite)) return NO_OPEN_DOCUMENT;
  if (
    !fixGlued &&
    !Object.keys(text).length &&
    !Object.keys(links ?? {}).length &&
    !Object.keys(append ?? {}).length
  )
    return "Nothing to apply: pass `text`, `links`, `append` or `fixGlued`.";
  const needsRead =
    Boolean(fixGlued) || Object.keys(text).length > 0 || Object.keys(links ?? {}).length > 0;

  if (needsRead && !current)
    return "Call readDocumentText first - there is no numbering to write against (only `append` works without a read).";
  if (needsRead && !token)
    return "`token` is missing: `text`, `links` and `fixGlued` answer one read of the document. Pass the `token` of your last readDocumentText result.";
  if (needsRead && current && current.token !== token)
    return `Stale token: these edits answer a different read of the document (got "${token}", current is "${current.token}"). Call readDocumentText again and rewrite against the new numbering - the numbers are not stable across reads.`;

  return null;
}

const NOTHING_WRITTEN =
  "Nothing was written: every entry you sent reads exactly as the document already does. An entry is written only when its text differs. Send the entry with the text it must have after the change. This tool does not delete text: to delete a paragraph call applyRichText on its rich text field, or setValues on its plain field with the text that must stay.";

const NOTHING_GLUED =
  "Nothing was written: no two words run together in this document, so there is no space to add. Do not move spaces anywhere else; say in your summary that the spacing is already right.";

/** What is still glued after a write that was about spacing or that made a glued boundary. */
function gluedLeft(
  slots: Slot[],
  before: Set<string>,
  asked: boolean
): { gluedLeft?: { between: string; shows: string }[]; gluedNote?: string } {
  const { glued } = gluedEntries(slots);
  const made = glued.filter((boundary) => !before.has(boundary.between));
  const fixedSome = glued.length < before.size;

  if (!glued.length || !(asked || made.length || fixedSome)) return {};

  return {
    gluedLeft: glued,
    gluedNote: `${glued.length} boundar${glued.length === 1 ? "y" : "ies"} still join${glued.length === 1 ? "s" : ""} two words with no space${made.length ? ` (${made.length} of them made by this write)` : ""}. Call applyDocumentText({ token, fixGlued: true }) with the same token: the tool puts the one space at each of them.`,
  };
}

function applyReport({ state }: RewriteContext, run: ApplyRun, sent: number) {
  const { current } = state;
  const { applied, failed, warnings, touchedRefs, relinked, appended, linksCreated } = run;
  const wroteNothing =
    sent > 0 && !applied.length && !relinked.length && !appended.length && !failed.length;
  const coverage = [...touchedRefs].map((ref) => {
    const all = (current?.slots ?? []).filter((slot) => slot.ref === ref);
    const done = all.filter((slot) => applied.includes(String(slot.n)));

    return { ref, changed: done.length, entries: all.length };
  });
  const partial = coverage.filter((fieldCoverage) => fieldCoverage.changed < fieldCoverage.entries);

  return {
    ok: failed.length === 0 && !wroteNothing,
    ...(wroteNothing ? { error: NOTHING_WRITTEN } : {}),
    changed: applied.length,
    relinked: relinked.length,
    appended: appended.length,
    fieldsTouched: touchedRefs.size,
    failed: failed.length,
    ...(failed.length ? { errors: failed.slice(0, 20) } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(linksCreated > 0
      ? {
          linksCreated,
          linksNote: `${linksCreated} markdown link(s) in your entries became real link nodes. The entry numbers you have are still valid for the entries you have not touched; the new link text is not numbered - call readDocumentText again if you need to edit it.`,
        }
      : {}),
    coverage,
    ...(partial.length
      ? {
          note:
            `${partial.length} field(s) were only partly rewritten: ` +
            partial
              .map(
                (fieldCoverage) =>
                  `${fieldCoverage.ref} (${fieldCoverage.changed}/${fieldCoverage.entries})`
              )
              .slice(0, 8)
              .join(", ") +
            `. That is correct for a deliberately scoped edit; for a whole-document pass (translate, retone, rewrite for a new topic) the untouched entries are still in their original form.`,
        }
      : {}),
  };
}

async function applyDocumentText(rewrite: RewriteContext, input: ApplyDocumentTextInput) {
  const { links, append, fixGlued } = input;
  const refused = refusal(rewrite, input);

  if (refused !== null) return { error: refused };
  const slots = rewrite.state.current?.slots ?? [];
  const before = gluedEntries(slots);
  const text = { ...(fixGlued ? before.fix : {}), ...input.text };

  if (fixGlued && !Object.keys(text).length && !Object.keys(links ?? {}).length && !append)
    return { error: NOTHING_GLUED };

  const run: ApplyRun = {
    byN: new Map(slots.map((slot) => [String(slot.n), slot])),
    linksCreated: 0,
    applied: [],
    failed: [],
    warnings: [],
    touchedRefs: new Set<string>(),
    relinked: [],
    appended: [],
  };

  applyTextEntries(rewrite, run, text);
  applyLinkEntries(rewrite, run, links);
  applyAppends(rewrite, run, append);

  return {
    ...applyReport(
      rewrite,
      run,
      Object.keys(text).length + Object.keys(links ?? {}).length + Object.keys(append ?? {}).length
    ),
    ...gluedLeft(
      slots,
      new Set(before.glued.map((boundary) => boundary.between)),
      Boolean(fixGlued)
    ),
  };
}

export function createApplyDocumentTextTool(rewrite: RewriteContext) {
  return tool({
    description:
      "Write back what a readDocumentText pass changed - text, and the destination of any anchor whose target the rewrite makes wrong. Each entry replaces one existing string in place; omitted entries are left alone. Can be called several times against the same token for a large page (coverage adds up). Cannot remove or reorder anything, and cannot blank a value: to delete a paragraph use applyRichText on its field. To ADD a paragraph at the END of a field (an appended note or disclaimer) use `append` with the field ref: it lands after the last paragraph, deterministically - never rewrite an existing entry to smuggle new text in.",
    inputSchema: z.object({
      token: z
        .string()
        .optional()
        .describe(
          "The token from the readDocumentText call these edits answer. Required with `text`, `links` and `fixGlued`. Omit it in a call that has only `append`."
        ),
      text: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Map of entry number to its new text - only the entries that change. To ADD a link, write [words](url) around the words inside the entry; to bold, **words**. Both become real nodes, not literal characters."
        ),
      links: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Map of entry number to the new URL for that anchor - only for entries listed under "links" in the read (existing anchors). It cannot create a link: for that, write [words](url) in the entry text.'
        ),
      append: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Map of FIELD REF (from `fields[].ref`) to a paragraph to add at the very end of that field. Plain text fields get it after a blank line. Rich text fields get a new paragraph node, one for each paragraph when blank lines separate several; a heading, list, quote or code block is not added here but with applyRichText."
        ),
      fixGlued: z
        .boolean()
        .optional()
        .describe(
          'true: the tool itself puts one space at every boundary that the read lists under "glued" (two words that run together where a link or a bold run meets the text). It needs no `text` for those entries and changes nothing else.'
        ),
    }),
    execute: (input: ApplyDocumentTextInput) => applyDocumentText(rewrite, input),
  });
}
