import type { SchemaField } from "../../types.js";
import { wordsOf } from "../../words.js";
import { isObjectLike } from "./discovery.js";

export interface LinkTarget {
  url?: string;
  collection?: string;
  id?: string | number;
}

export interface RelabelledLink {
  /** `relabelled`: the label changed, the target did not. `self`: it now opens this document. */
  kind: "relabelled" | "self";
  ref: string;
  from: string;
  to: string;
  targets: LinkTarget[];
  /** Puts the label, and for `self` also the target, back as they were. */
  restore: () => void;
}

type Level = Record<string, unknown>;

const URL_VALUE = /^(?:https?:\/\/|\/)\S*$/u;
const MIN_WORD_CHARS = 3;
const KEPT_SHARE = 0.5;

const isUrl = (value: unknown): value is string =>
  typeof value === "string" && URL_VALUE.test(value.trim()) && value.trim().length > 1;

const isLabel = (field: SchemaField, value: unknown): value is string =>
  field.type === "text" && typeof value === "string" && value.trim() !== "" && !isUrl(value);

const hasContent = (value: unknown): boolean =>
  Array.isArray(value) ? value.length > 0 : value != null && value !== "";

function relationTarget(field: SchemaField, value: unknown): LinkTarget | null {
  if (field.type !== "relationship" || field.hasMany || value == null || value === "") return null;
  const single = typeof field.relationTo === "string" ? field.relationTo : undefined;

  if (typeof value === "string" || typeof value === "number")
    return single ? { collection: single, id: value } : null;
  if (!isObjectLike(value)) return null;

  if (typeof value.relationTo === "string" && value.value != null) {
    const inner = isObjectLike(value.value) ? value.value.id : value.value;

    return typeof inner === "string" || typeof inner === "number"
      ? { collection: value.relationTo, id: inner }
      : null;
  }

  return single && (typeof value.id === "string" || typeof value.id === "number")
    ? { collection: single, id: value.id }
    : null;
}

function ownTargets(fields: SchemaField[], level: Level): LinkTarget[] {
  const targets: LinkTarget[] = [];

  for (const field of fields) {
    const value = level[field.name];
    const relation = relationTarget(field, value);

    if (relation) targets.push(relation);
    else if (field.type === "text" && isUrl(value)) targets.push({ url: value.trim() });
  }

  return targets;
}

const ownLabels = (fields: SchemaField[], level: Level): SchemaField[] =>
  fields.filter((field) => isLabel(field, level[field.name]));

/** The targets a level's labels name: its own, and those of a group that has no label itself. */
function targetsOf(fields: SchemaField[], level: Level): LinkTarget[] {
  const targets = ownTargets(fields, level);

  for (const field of fields) {
    const value = level[field.name];

    if (field.type !== "group" || !field.fields || !isObjectLike(value)) continue;
    if (!ownLabels(field.fields, value).length) targets.push(...ownTargets(field.fields, value));
  }

  return targets;
}

const sameText = (a: string, b: string): boolean =>
  a.replace(/\s+/gu, " ").trim().toLowerCase() === b.replace(/\s+/gu, " ").trim().toLowerCase();

const isSelf = (target: LinkTarget, self: LinkTarget | undefined): boolean =>
  !!self && target.collection === self.collection && String(target.id) === String(self.id);

/** The labels, the addresses and the targets that now open the document itself. */
function selfLinkFieldNames(
  fields: SchemaField[],
  levels: { before: Level; after: Level },
  self: LinkTarget | undefined
): string[] {
  const { before, after } = levels;

  return fields
    .filter((field) => {
      const target = relationTarget(field, after[field.name]);

      return (
        [before, after].some(
          (level) =>
            isLabel(field, level[field.name]) || (field.type === "text" && isUrl(level[field.name]))
        ) ||
        (target !== null && isSelf(target, self))
      );
    })
    .map((field) => field.name);
}

/** Puts the link back; the other fields keep what the edit wrote. */
function restoreSelfLink(
  fields: SchemaField[],
  levels: { before: Level; after: Level },
  self: LinkTarget | undefined
): void {
  const { before, after } = levels;

  for (const name of selfLinkFieldNames(fields, levels, self))
    after[name] = structuredClone(before[name]);

  for (const field of fields) {
    const was = before[field.name];
    const now = after[field.name];

    if (field.type !== "group" || !field.fields || !isObjectLike(was) || !isObjectLike(now))
      continue;
    if (!ownLabels(field.fields, now).length)
      for (const name of selfLinkFieldNames(field.fields, { before: was, after: now }, self))
        now[name] = structuredClone(was[name]);
  }
}

function relabelledAt(
  fields: SchemaField[],
  levels: { before: Level; after: Level },
  path: string,
  self: LinkTarget | undefined
): RelabelledLink[] {
  const { before, after } = levels;

  if (fields.some((field) => field.type === "richText" && hasContent(after[field.name]))) return [];
  const targets = targetsOf(fields, after);
  const targetsBefore = targetsOf(fields, before);
  const labels = ownLabels(fields, after);
  const refOf = (name: string) => (path ? `${path}.${name}` : name);

  if (!targets.length || !targetsBefore.length) return [];

  if (JSON.stringify(targets) !== JSON.stringify(targetsBefore)) {
    const first = labels[0]?.name;

    if (!targets.some((target) => isSelf(target, self))) return [];

    return [
      {
        kind: "self",
        ref: first ? refOf(first) : path,
        from: first && typeof before[first] === "string" ? before[first] : "",
        to: first ? (after[first] as string) : "",
        targets: targetsBefore,
        restore: () => restoreSelfLink(fields, levels, self),
      },
    ];
  }

  return labels.flatMap((field) => {
    const from = before[field.name];
    const to = after[field.name] as string;

    return typeof from === "string" && from.trim() !== "" && !sameText(from, to)
      ? [
          {
            kind: "relabelled" as const,
            ref: refOf(field.name),
            from,
            to,
            targets,
            restore: () => {
              after[field.name] = from;
            },
          },
        ]
      : [];
  });
}

const rowsById = (value: unknown): Map<string, Level> =>
  new Map(
    (Array.isArray(value) ? value : [])
      .filter((row): row is Level => isObjectLike(row) && row.id != null)
      .map((row) => [String(row.id), row])
  );

function walk(
  fields: SchemaField[],
  levels: { before: Level; after: Level },
  path: string,
  self: LinkTarget | undefined
): RelabelledLink[] {
  const { before, after } = levels;
  const found = relabelledAt(fields, levels, path, self);

  for (const field of fields) {
    const ref = path ? `${path}.${field.name}` : field.name;
    const now = after[field.name];
    const was = before[field.name];

    if (field.type === "group" && field.fields && isObjectLike(now) && isObjectLike(was)) {
      found.push(...walk(field.fields, { before: was, after: now }, ref, self));
      continue;
    }

    if (field.type !== "array" && field.type !== "blocks") continue;
    const earlier = rowsById(was);

    for (const [id, row] of rowsById(now)) {
      const rowBefore = earlier.get(id);
      const rowFields =
        field.type === "array"
          ? field.fields
          : field.blocks?.find((block) => block.slug === row.blockType)?.fields;

      if (rowBefore && rowFields)
        found.push(...walk(rowFields, { before: rowBefore, after: row }, `${ref}[${id}]`, self));
    }
  }

  return found;
}

/**
 * Links whose label and target stopped agreeing, in a row or group that holds no rich text of its
 * own: a label that changed next to a target that did not, and a link that now opens `self`.
 */
export function findRelabelledLinks(
  fields: SchemaField[],
  before: unknown,
  after: unknown,
  self?: LinkTarget
): RelabelledLink[] {
  return isObjectLike(before) && isObjectLike(after)
    ? walk(fields, { before, after }, "", self)
    : [];
}

function words(text: string): string[] {
  return wordsOf(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")).filter(
    (word) => word.length >= MIN_WORD_CHARS || !/^[\p{Script=Latin}\p{N}]+$/u.test(word)
  );
}

/**
 * True when the old label named the target with some of its words and the new label lost most of
 * them. A label that never shared a word with the target tells nothing, so it is not reported.
 */
export function lostTargetWords(
  { from, to }: Pick<RelabelledLink, "from" | "to">,
  targetTexts: string[]
): boolean {
  const targetWords = new Set(targetTexts.flatMap(words));
  const naming = words(from).filter((word) => targetWords.has(word));

  if (!naming.length) return false;
  const kept = new Set(words(to));

  return naming.filter((word) => kept.has(word)).length / naming.length < KEPT_SHARE;
}
