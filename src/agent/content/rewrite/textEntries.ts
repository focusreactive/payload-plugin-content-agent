import { getByPath, isObjectLike, parsePath, resolveFieldAtPath } from "../discovery.js";
import { writeTextNode } from "../lexicalEngine.js";
import { keepSpacesOutOfLinks } from "../linkEdges.js";
import type { TextNode } from "../lexicalEngine.js";
import { htmlMarkupError, plainHtmlError } from "../richtext/surgical.js";
import { validateFieldValue } from "../schemaValues.js";
import {
  shiftedEntryError,
  duplicatePassage,
  neighbourOverlapError,
  normalizeForMatch,
  shrinkError,
  SHRINK_RATIO,
} from "../guards.js";
import { isStale, joinParts, rootFields, sharedRefusal, staleError } from "./slots.js";
import type { ApplyRun, RewriteContext, Slot } from "./slots.js";

function inlinePlainText(value: string): string {
  return value
    .replace(/\[([^\]]*)\]\(\s*(?:<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1");
}

function plainEntryHint(
  value: string,
  anchor: Slot,
  origin: { n: number; text: string }[],
  byN: Map<string, Slot>
): string {
  const match = /\[([^\]]+)\]\(\s*(<[^>]*>|[^\s)]+)/u.exec(value);

  if (!match) return "";
  const word = match[1].trim(),
    url = match[2].replace(/^<|>$/gu, "");

  if (!word) return "";
  const wordRe = new RegExp(
    `(^|[^\\p{L}\\p{N}])(${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")})(?=$|[^\\p{L}\\p{N}])`,
    "u"
  );

  for (const entry of origin) {
    const slot = byN.get(String(entry.n));

    if (!slot || !slot.node || slot.linkNode || slot.ref !== anchor.ref) continue;
    const hit = wordRe.exec(entry.text);

    if (!hit) continue;
    const linked =
      entry.text.slice(0, hit.index + hit[1].length) +
      `[${hit[2]}](${url})` +
      entry.text.slice(hit.index + hit[0].length);

    return ` The first PLAIN entry in ${slot.ref} with "${word}" is entry ${entry.n}: ${JSON.stringify(entry.text.length > 80 ? `${entry.text.slice(0, 80)}…` : entry.text)}. To link that mention send text: { "${entry.n}": ${JSON.stringify(linked)} }.`;
  }

  return ` No plain entry in ${anchor.ref} contains "${word}" - every mention is already an anchor, so there is nothing to link; say so in your summary.`;
}

function excerptAround(a: string, b: string): string {
  let i = 0;

  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const start = Math.max(0, i - 25);
  const out = a.slice(start, start + 60);

  return `${start ? "…" : ""}${out}${start + 60 < a.length ? "…" : ""}`;
}

interface TextEntry {
  key: string;
  slot: Slot;
  value: string;
}

function entryGuardError(rewrite: RewriteContext, { key, slot, value }: TextEntry): string | null {
  const { workspace, session, state } = rewrite;
  const current = state.current!;
  const shifted = shiftedEntryError(
    `Entry ${key}`,
    slot.text,
    value,
    current.origin.filter((entry) => entry.n !== slot.n)
  );

  if (shifted) return shifted;
  if (isStale(rewrite, slot.ref)) return staleError(key, slot.ref);
  const shrink = shrinkError(
    `entry ${key} (${slot.ref})`,
    slot.text,
    value,
    session?.shrinkRatio ? session.shrinkRatio() : SHRINK_RATIO
  );

  if (shrink) return shrink;
  const dup = duplicatePassage(workspace.ref.current, slot.text, value, workspace.original);

  if (dup)
    return `Entry ${key} would add text the document already contains elsewhere ("${dup.slice(0, 80)}…") - a duplicate, not an edit.`;

  return null;
}

function writePartEntry(
  rewrite: RewriteContext,
  { slot, value }: TextEntry,
  part: { ref: string; index: number }
): string | null {
  const { workspace } = rewrite;
  const current = rewrite.state.current!;
  const fieldParts = current.parts.get(part.ref)!;
  const path = parsePath(slot.ref);
  const res = resolveFieldAtPath(rootFields(rewrite), workspace.ref.current, path);

  if (!res || !res.field) return `"${slot.ref}" no longer resolves to a field.`;
  fieldParts.parts[part.index] = value;
  const rebuilt = joinParts(fieldParts);
  const guard = validateFieldValue(res.field, rebuilt);

  if (!guard.ok) {
    fieldParts.parts[part.index] = slot.text;

    return guard.error ?? `"${slot.ref}" rejected by field validation`;
  }

  const parent =
    path.length > 1 ? getByPath(workspace.ref.current, path.slice(0, -1)) : workspace.ref.current;
  const last = path[path.length - 1];

  if (!isObjectLike(parent) || typeof last !== "string") {
    fieldParts.parts[part.index] = slot.text;

    return `Could not write to "${slot.ref}".`;
  }

  parent[last] = rebuilt;
  current.known.set(slot.ref, rebuilt);

  return null;
}

function writeNodeEntry(
  rewrite: RewriteContext,
  run: ApplyRun,
  { key, slot, value }: TextEntry,
  node: TextNode
): string | null {
  const current = rewrite.state.current!;
  const idx = slot.n - 1;
  const prev = current.slots[idx - 1];
  const next = current.slots[idx + 1];
  const sameBlock = (other?: Slot) =>
    other && other.node && other.ref === slot.ref && other.block === slot.block;
  const overlap = neighbourOverlapError(`Entry ${key}`, slot.text, value, {
    prev: sameBlock(prev) ? prev.text : undefined,
    next: sameBlock(next) ? next.text : undefined,
  });

  if (overlap) return overlap;
  const field =
    resolveFieldAtPath(rootFields(rewrite), rewrite.workspace.ref.current, parsePath(slot.ref))
      ?.field ?? undefined;
  const written = writeTextNode(slot.block, node, value, { label: `Entry ${key}`, field });

  if ("error" in written)
    return (
      written.error + (slot.linkNode ? plainEntryHint(value, slot, current.origin, run.byN) : "")
    );
  if (written.links) run.linksCreated += written.links;

  if (written.links || written.bold) {
    const plainBefore = normalizeForMatch(slot.text);
    const plainAfter = normalizeForMatch(inlinePlainText(value));

    if (plainBefore !== plainAfter) {
      run.warnings.push(
        `Entry ${key}: the WORDS changed as well as the markup - the page read "${excerptAround(plainBefore, plainAfter)}" and now reads "${excerptAround(plainAfter, plainBefore)}". If you meant only to add a link or bold, send this entry's original words with [..](url) or **..** around the ones to mark, and nothing added.`
      );
    }
  }

  if (written.node !== node) slot.rebuilt = true;
  slot.node = written.node;

  return null;
}

function writeFieldEntry(rewrite: RewriteContext, { slot, value }: TextEntry): string | null {
  const { workspace } = rewrite;
  const path = parsePath(slot.ref);
  const res = resolveFieldAtPath(rootFields(rewrite), workspace.ref.current, path);

  if (!res || !res.field) return `"${slot.ref}" no longer resolves to a field.`;
  const guard = validateFieldValue(res.field, value);

  if (!guard.ok) return guard.error ?? `"${slot.ref}" rejected by field validation`;
  const parent =
    path.length > 1 ? getByPath(workspace.ref.current, path.slice(0, -1)) : workspace.ref.current;
  const last = path[path.length - 1];
  const prop = typeof last === "string" ? last : null;

  if (!isObjectLike(parent) || !prop) return `Could not write to "${slot.ref}".`;
  parent[prop] = value;
  rewrite.state.current!.known.set(slot.ref, value);

  return null;
}

function writeEntry(rewrite: RewriteContext, run: ApplyRun, entry: TextEntry): string | null {
  if (entry.slot.part) return writePartEntry(rewrite, entry, entry.slot.part);
  if (entry.slot.node) return writeNodeEntry(rewrite, run, entry, entry.slot.node);

  return writeFieldEntry(rewrite, entry);
}

function blankEntryError(key: string, slot: Slot): string {
  const next = slot.node
    ? `call applyRichText on "${slot.ref}": mode "transform" with "removeText" deletes a part of a paragraph, heading or list item, and a surgical "remove" deletes a whole one`
    : `call setValues({ edits: [{ ref: "${slot.ref}", value }] }) with the text the field must hold after the deletion`;

  return `Entry ${key} would be blank, and this tool does not delete text. To delete it, ${next}. To keep the entry, leave it out.`;
}

function fieldText(rewrite: RewriteContext, slot: Slot): string {
  const whole = rewrite.state.current?.known.get(slot.ref);

  return typeof whole === "string" ? whole : slot.text;
}

function applyTextEntry(
  rewrite: RewriteContext,
  run: ApplyRun,
  key: string,
  value: string
): string | null {
  const slot = run.byN.get(key);

  if (!slot) return `No entry ${key} in this read (1..${rewrite.state.current!.slots.length}).`;
  if (typeof value !== "string" || !value.trim()) return blankEntryError(key, slot);
  if (value === slot.text) return null;
  if (slot.rebuilt)
    return `Entry ${key} became several pieces (a link or bold) in an earlier write of this read, so this read no longer addresses it. Call readDocumentText again and send the entry from the new read.`;
  const shared = sharedRefusal(rewrite, slot.ref);

  if (shared) return shared;
  const html = slot.node
    ? htmlMarkupError(`Entry ${key}`, value)
    : plainHtmlError(`Entry ${key}`, fieldText(rewrite, slot), value);

  if (html) return html;
  const entry: TextEntry = { key, slot, value };
  const guardError = entryGuardError(rewrite, entry);

  if (guardError !== null) return guardError;
  const writeError = writeEntry(rewrite, run, entry);

  if (writeError !== null) return writeError;
  run.applied.push(key);
  run.touchedRefs.add(slot.ref);
  slot.text = value;

  return null;
}

export function applyTextEntries(
  rewrite: RewriteContext,
  run: ApplyRun,
  text: Record<string, string>
): void {
  const units = (rewrite.state.current?.slots ?? []).map((slot) => ({
    text: slot.text,
    link: Boolean(slot.linkNode),
    group: slot.node && slot.block ? slot.block : undefined,
  }));

  for (const [key, value] of Object.entries(keepSpacesOutOfLinks(text, units, 1))) {
    const error = applyTextEntry(rewrite, run, key, value);

    if (error !== null) run.failed.push({ n: key, error });
  }
}
