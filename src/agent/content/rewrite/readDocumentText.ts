import { tool } from "ai";
import { z } from "zod";
import { gluedBoundaries } from "../gluedSpaces.js";
import { inlineContext } from "../lexicalEngine.js";
import { collectSlots, isOpen, rootFields } from "./slots.js";
import type { RewriteContext, Slot } from "./slots.js";
import { NO_OPEN_DOCUMENT } from "../noOpenDocument.js";

/** The glued boundaries of a read, named by entry number, and the entries that fix them. */
export function gluedEntries(slots: Slot[]) {
  const { glued, fix } = gluedBoundaries(
    slots.map((slot) => ({
      text: slot.text,
      node: slot.rebuilt ? undefined : slot.node,
      block: slot.block,
      link: Boolean(slot.linkNode),
    }))
  );
  const number = (index: number | null, missing: string) =>
    index === null ? missing : String(slots[index].n);

  return {
    glued: glued.map(({ left, right, shows }) => ({
      between: `${number(left, "prev")}|${number(right, "next")}`,
      shows,
    })),
    fix: Object.fromEntries(
      Object.entries(fix).map(([index, text]) => [String(slots[Number(index)].n), text])
    ),
  };
}

function inlineContexts(slots: Slot[]) {
  const context: Record<number, { before: string; after: string }> = {};

  for (const slot of slots) {
    if (!slot.node || !slot.block) continue;
    const surrounding = inlineContext(slot.block, slot.node);

    if (surrounding.before || surrounding.after) context[slot.n] = surrounding;
  }

  return context;
}

async function readDocumentText(rewrite: RewriteContext) {
  const { workspace, session, state } = rewrite;

  if (!isOpen(rewrite)) return { error: NO_OPEN_DOCUMENT };
  if (session) session.textPassReads += 1;
  const { slots, skipped, parts, known } = collectSlots(workspace, rootFields(rewrite));
  const token = `r${++state.reads}-${Date.now().toString(36)}-${slots.length}`;
  const origin = slots.map((slot) => ({ n: slot.n, text: slot.text }));

  state.current = { slots, token, parts, known, origin };
  const byRef: Record<string, number[]> = {};

  for (const slot of slots) (byRef[slot.ref] ??= []).push(slot.n);
  const context = inlineContexts(slots);
  const { glued } = gluedEntries(slots);

  return {
    token,
    count: slots.length,
    ...(glued.length
      ? {
          glued,
          gluedNote: `${glued.length} boundar${glued.length === 1 ? "y" : "ies"} where two words run together with no space between them. For a spacing task these ARE the task: call applyDocumentText({ token, fixGlued: true }) - the tool itself puts one space at each listed boundary, outside the links, and changes nothing else. Do not retype these entries. Entries not listed here already have their space.`,
        }
      : {}),
    text: Object.fromEntries(slots.map((slot) => [slot.n, slot.text])),
    ...(Object.keys(context).length ? { context } : {}),
    links: Object.fromEntries(
      slots.filter((slot) => slot.linkTarget).map((slot) => [slot.n, slot.linkTarget])
    ),
    ...(slots.some((slot) => slot.linkTarget)
      ? {
          linksNote:
            'Every entry under "links" is ALREADY a link (its anchor text). "Link the first plain mention of X" is never one of these: find the first entry NOT listed here whose text contains X and send it back with [X](url) around that word.',
        }
      : {}),
    fields: Object.entries(byRef).map(([ref, numbers]) => ({
      ref,
      entries: numbers.length,
      from: numbers[0],
      to: numbers[numbers.length - 1],
    })),
    ...(skipped.length ? { skipped: skipped.map((entry) => `${entry.ref} (${entry.type})`) } : {}),
    hint: 'Return ONLY the entries you are changing, keyed by the same number, to applyDocumentText({ token, text, links? }). Every entry is one existing string (a field, a rich text segment, or ONE PARAGRAPH of a long text field) and is rewritten in place: send the whole entry with your change in it, keep it a single string, never empty, never a fragment or a summary of it, and do not merge or split entries. An entry that comes back much shorter than it was is refused as lost content. You may send them in several calls against the SAME token - coverage adds up - so a large page can go 50-100 entries at a time; you do NOT have to produce them all at once. To ADD a paragraph at the end of a field, pass `append: { "<field ref>": "<paragraph>" }` - the tool puts it after the last paragraph; do not rewrite an existing entry for that. Any number that also appears under "links" is anchor text: if the rewrite makes its destination wrong, pass the new URL in `links` under the same number, or the words will change and the href will not. An entry under "context" shares its paragraph with other entries (a bold run, a link anchor): "before"/"after" are the exact characters next to it on the page, and they BELONG TO THE NEIGHBOURING ENTRIES - never repeat them in this one. Entries are rendered back to back exactly as stored, so if "before" ends with a letter and the entry starts with one, the two words are glued: add the space inside ONE of the two entries (a trailing space here or a leading space in the next). "glued" lists exactly those boundaries ("|" marks the spot, text is what the page shows there): applyDocumentText({ token, fixGlued: true }) puts the one space at every listed boundary, so a spacing task needs no retyped entry; a boundary not listed already has its space - do not shift spaces around there. Structure, blocks, uploads and every entry you omit are left exactly as they are. Entries under "skipped" are code or email fields and are not part of this pass.',
  };
}

export function createReadDocumentTextTool(rewrite: RewriteContext) {
  return tool({
    description:
      "Read every string of the open document that holds text at once - plain-text fields and each rich text field broken into its numbered text segments - as one flat map of { n: text }. Not in the map: a field with no text yet and a text field with several values (write those with setValues, their refs come from getEditableContent), and code and email fields (listed under `skipped`). Use this to rewrite, translate or retone a WHOLE document in one pass: read once, then write once with applyDocumentText. For a single field or a structural change (adding/removing/reordering blocks or rows) use the per-field tools instead.",
    inputSchema: z.object({}),
    execute: () => readDocumentText(rewrite),
  });
}
