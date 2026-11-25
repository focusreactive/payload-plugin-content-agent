import type { SchemaContext, SchemaField } from "../../types.js";
import { isRecord } from "../../borders.js";
import type { PayloadDoc } from "../../borders.js";
import type { DocumentIO } from "../content/documentIo.js";
import { isObjectLike, rowId } from "../content/discovery.js";
import { countNodes } from "../content/lexicalEngine.js";
import { documentNotFoundError } from "../toolErrors.js";
import { CHAT_SURFACE } from "../toolSurface.js";
import type { ToolSurface } from "../toolSurface.js";
import { UPDATE_CONTROL_KEYS } from "./mcp/controlKeys.js";

export interface RiskFinding {
  field: string;
  kind: "forbidden" | "reviewable";
  reason: string;
  /** What a reviewable change does, in words for the person who confirms it. */
  effect?: string;
}

const shownField = ({ key, def }: { key: string; def: SchemaField | undefined }): string =>
  `"${def?.label?.trim() || key}"`;

const isRichText = (value: unknown): boolean => isObjectLike(value) && !!value.root;

const isPolymorphicRef = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && !isRichText(value) && "value" in value;

export function topLevelField(field: string): string {
  const cut = [field.indexOf("."), field.indexOf("[")].filter((i) => i >= 0);

  return cut.length ? field.slice(0, Math.min(...cut)) : field;
}

// Ids compare as strings: the database returns numbers, the model often sends strings.
const keyFor = (item: unknown): string => {
  if (isObjectLike(item) && "value" in item)
    return `${item.relationTo ?? ""}:${String(item.value)}`;
  if (typeof item === "number" || typeof item === "string") return `s:${String(item)}`;

  return JSON.stringify(item);
};

function removedArrayItems(before: unknown[], after: unknown[]): number {
  const hasIds = before.every((item) => isObjectLike(item) && item.id != null);

  if (hasIds) {
    // `after` may mix populated objects with bare ids:
    // a relationship read at depth > 0 returns objects.
    const afterIds = new Set(
      after.map((item) => (isObjectLike(item) ? String(item.id) : String(item)))
    );

    return before.filter((item) => !afterIds.has(rowId(item))).length;
  }

  const afterKeys = new Set(after.map(keyFor));

  return before.filter((item) => !afterKeys.has(keyFor(item))).length;
}

interface FieldChange {
  key: string;
  def: SchemaField | undefined;
  prev: unknown;
  after: unknown;
  hasAuth: boolean;
}

// A check returns true when it has settled the field: the checks after it are skipped.
type RiskCheck = (change: FieldChange, risks: RiskFinding[]) => boolean;

function readOnlyRisk({ key, def }: FieldChange, risks: RiskFinding[]): boolean {
  if (def?.readOnly) {
    risks.push({
      field: key,
      kind: "forbidden",
      reason: `"${key}" is read-only and must never be modified.`,
    });

    return true;
  }

  return false;
}

function unsupportedRisk({ key, def }: FieldChange, risks: RiskFinding[]): boolean {
  if (def?.unsupported) {
    risks.push({
      field: key,
      kind: "forbidden",
      reason: `"${key}" has a custom field type the agent cannot safely edit.`,
    });

    return true;
  }

  return false;
}

function accountRisk(
  { key, def, prev, after, hasAuth }: FieldChange,
  risks: RiskFinding[]
): boolean {
  if (!hasAuth || JSON.stringify(prev ?? null) === JSON.stringify(after ?? null)) return false;

  risks.push({
    field: key,
    kind: "reviewable",
    reason: `"${key}" belongs to a document of an auth-enabled collection (an account) - a change to it requires review before it is written.`,
    effect: `${shownField({ key, def })} changes on a user account.`,
  });

  return true;
}

function groupRisk({ key, def, prev, after, hasAuth }: FieldChange, risks: RiskFinding[]): boolean {
  if (def?.type === "group" && isRecord(after)) {
    const prevObj = isRecord(prev) ? prev : {};

    for (const nested of assessUpdateRisk(def.fields ?? [], prevObj, after, hasAuth)) {
      risks.push({ ...nested, field: `${key}.${nested.field}` });
    }

    return true;
  }

  return false;
}

function clearedReferenceRisk(
  { key, def, prev, after }: FieldChange,
  risks: RiskFinding[]
): boolean {
  if (
    // Gated on the field's own type, not on the shape: a json field may hold a `value` key.
    (def?.type === "relationship" || def?.type === "upload") &&
    isPolymorphicRef(prev) &&
    prev.value != null
  ) {
    const afterIsPopulatedRef = isPolymorphicRef(after) && after.value != null;

    if (!afterIsPopulatedRef) {
      risks.push({
        field: key,
        kind: "reviewable",
        reason: `"${key}" currently references a document and would be cleared.`,
        effect: `${shownField({ key, def })} links to a document now. The update removes the link.`,
      });
    }

    return true;
  }

  return false;
}

function richTextRisk({ key, def, prev, after }: FieldChange, risks: RiskFinding[]): boolean {
  if (isRichText(prev)) {
    if (!isRichText(after)) {
      risks.push({
        field: key,
        kind: "reviewable",
        reason: `"${key}" currently holds rich text (${countNodes(prev)} nodes) and would be replaced by a ${after === null || after === undefined ? "empty" : typeof after} value - its content would be lost.`,
        effect: `${shownField({ key, def })} has text now. The update removes all of it.`,
      });

      return true;
    }

    const beforeNodes = countNodes(prev);
    const afterNodes = countNodes(after);

    if (beforeNodes > 1 && afterNodes < beforeNodes * 0.5) {
      const kept = Math.round((afterNodes / beforeNodes) * 100);

      risks.push({
        field: key,
        kind: "reviewable",
        reason: `"${key}" would shrink from ${beforeNodes} to ${afterNodes} rich text nodes (${kept}% of the original) - possible content loss.`,
        effect: `${shownField({ key, def })} loses about ${100 - kept}% of its text.`,
      });
    }

    return true;
  }

  return false;
}

const emptiedObject = (prev: unknown, after: unknown): boolean =>
  isRecord(prev) &&
  !isRichText(prev) &&
  Object.keys(prev).length > 0 &&
  (after === null || (isRecord(after) && Object.keys(after).length === 0));

function emptiedValueRisk({ key, def, prev, after }: FieldChange, risks: RiskFinding[]): boolean {
  if (
    (typeof prev === "string" && prev.trim() !== "" && (after === "" || after === null)) ||
    (typeof prev === "number" && after === null) ||
    emptiedObject(prev, after)
  ) {
    risks.push({
      field: key,
      kind: "reviewable",
      reason: `"${key}" currently has a value and would be emptied.`,
      effect: `${shownField({ key, def })} has a value now. The update empties it.`,
    });

    return true;
  }

  return false;
}

function arrayRisk({ key, def, prev, after, hasAuth }: FieldChange, risks: RiskFinding[]): boolean {
  if (Array.isArray(prev) && prev.length > 0) {
    if (!Array.isArray(after) || after.length === 0) {
      risks.push({
        field: key,
        kind: "reviewable",
        reason: `"${key}" currently has ${prev.length} item(s) and would be ${Array.isArray(after) ? "emptied" : "replaced by a non-array value"}.`,
        effect: `${shownField({ key, def })} has ${prev.length} ${prev.length === 1 ? "item" : "items"} now. The update removes all of them.`,
      });

      return true;
    }

    const prevItems: unknown[] = prev;
    const afterItems: unknown[] = after;
    const removed = removedArrayItems(prevItems, afterItems);

    if (removed > 0) {
      risks.push({
        field: key,
        kind: "reviewable",
        reason: `"${key}" would lose ${removed} of its ${prev.length} item(s) - Payload replaces the whole array on update, so anything omitted is removed.`,
        effect: `${shownField({ key, def })} loses ${removed} of its ${prev.length} items.`,
      });
    }

    if (def?.type === "array" && def.fields?.length && afterItems.every(isObjectLike)) {
      const prevById = new Map(
        prevItems
          .filter(isObjectLike)
          .filter((item) => item.id != null)
          .map((item) => [String(item.id), item])
      );

      for (const row of afterItems) {
        if (row.id == null) continue;
        const prevRow = prevById.get(String(row.id));

        if (!prevRow) continue;

        for (const nested of assessUpdateRisk(def.fields, prevRow, row, hasAuth)) {
          risks.push({ ...nested, field: `${key}[${row.id}].${nested.field}` });
        }
      }
    }

    return true;
  }

  return false;
}

const RISK_CHECKS: RiskCheck[] = [
  readOnlyRisk,
  unsupportedRisk,
  accountRisk,
  groupRisk,
  clearedReferenceRisk,
  richTextRisk,
  emptiedValueRisk,
  arrayRisk,
];

export function assessUpdateRisk(
  fields: SchemaField[],
  before: unknown,
  proposed: Record<string, unknown>,
  hasAuth = false
): RiskFinding[] {
  const risks: RiskFinding[] = [];

  if (!isObjectLike(before) || !proposed || typeof proposed !== "object") return risks;

  for (const [key, after] of Object.entries(proposed)) {
    if (UPDATE_CONTROL_KEYS.has(key)) continue;
    const def = fields.find((field) => field.name === key);
    const prev = before[key];
    const change: FieldChange = { key, def, prev, after, hasAuth };

    RISK_CHECKS.some((check) => check(change, risks));
  }

  return risks;
}

function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string")
    return value.length > 100 ? `"${value.slice(0, 97)}..." (${value.length} chars)` : `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (isRichText(value)) return `rich text (${countNodes(value)} nodes)`;

  if (typeof value === "object") {
    const keys = Object.keys(value);

    return `{${keys.slice(0, 5).join(", ")}${keys.length > 5 ? `, +${keys.length - 5} more` : ""}}`;
  }

  return String(value);
}

interface ReviewContext {
  io: DocumentIO;
  schema: SchemaContext;
  surface?: ToolSurface;
}

export interface UpdatePreviewInput {
  collection?: string;
  global?: string;
  id?: string | number;
  data: Record<string, unknown>;
  locale?: string;
}

type FieldDiffs = Record<string, { before: string; after: string }>;

function diffProposedFields(
  doc: PayloadDoc,
  proposed: Record<string, unknown>,
  proposedFieldNames: string[]
) {
  const fieldDiffs: FieldDiffs = {};
  const unchanged: string[] = [];

  for (const key of proposedFieldNames) {
    if (JSON.stringify(doc[key]) === JSON.stringify(proposed[key])) {
      unchanged.push(key);
    } else {
      fieldDiffs[key] = {
        before: summarizeValue(doc[key]),
        after: summarizeValue(proposed[key]),
      };
    }
  }

  return { fieldDiffs, unchanged };
}

interface ReviewFindings {
  fieldDiffs: FieldDiffs;
  unchanged: string[];
  risks: RiskFinding[];
  forbidden: RiskFinding[];
  warnings: string[];
}

function reviewReport(
  { collection, global, id }: UpdatePreviewInput,
  { fieldDiffs, unchanged, risks, forbidden, warnings }: ReviewFindings,
  surface: ToolSurface
) {
  const MAX_DIFF_ENTRIES = 100;
  const diffKeys = Object.keys(fieldDiffs);
  const diffTruncated = diffKeys.length > MAX_DIFF_ENTRIES;
  const cappedDiff = diffTruncated
    ? Object.fromEntries(diffKeys.slice(0, MAX_DIFF_ENTRIES).map((key) => [key, fieldDiffs[key]]))
    : fieldDiffs;
  const MAX_WARNINGS = 50;
  const warningsTruncated = warnings.length > MAX_WARNINGS;
  const cappedWarnings = warningsTruncated ? warnings.slice(0, MAX_WARNINGS) : warnings;

  return {
    ...(global ? { global } : { documentId: id, collection }),
    fieldsChanged: Object.keys(fieldDiffs),
    fieldsUnchanged: unchanged,
    diff: cappedDiff,
    ...(diffTruncated
      ? {
          diffTruncated: true,
          diffTruncatedNote: `Showing ${MAX_DIFF_ENTRIES} of ${diffKeys.length} changed fields.`,
        }
      : {}),
    ...(cappedWarnings.length ? { warnings: cappedWarnings } : {}),
    ...(warningsTruncated
      ? {
          warningsTruncated: true,
          warningsTruncatedNote: `Showing ${MAX_WARNINGS} of ${warnings.length} warnings.`,
        }
      : {}),
    ...(forbidden.length
      ? {
          forbiddenFields: forbidden.map((risk) => risk.field),
          note: "Remove the forbidden field(s) from your update - they will be refused regardless of review.",
        }
      : {}),
    safe: risks.length === 0,
    ...(risks.some((risk) => risk.kind === "reviewable")
      ? {
          nextStep: surface.destructivePreviewNote,
        }
      : {}),
  };
}

/** What an update of these fields would change in the current draft. It writes nothing. */
export async function previewUpdate(
  { io, schema, surface = CHAT_SURFACE }: ReviewContext,
  input: UpdatePreviewInput
) {
  const { collection, global, id, data, locale } = input;
  const { doc, error } = global
    ? await io.read({ global }, { locale, callId: "review" })
    : await io.read({ collection }, { id, locale, callId: "review" });

  if (error) return { error };
  if (!doc)
    return {
      error: documentNotFoundError(
        `Document ${global ?? `${collection}/${id}`}`,
        surface.nameSearch
      ),
    };

  const targetCollection = global
    ? undefined
    : schema.collections.find((candidate) => candidate.slug === collection);
  const fields = global
    ? (schema.globals.find((candidate) => candidate.slug === global)?.fields ?? [])
    : (targetCollection?.fields ?? []);
  const proposedFieldNames = Object.keys(data).filter((key) => !UPDATE_CONTROL_KEYS.has(key));

  const { fieldDiffs, unchanged } = diffProposedFields(doc, data, proposedFieldNames);

  const risks = assessUpdateRisk(fields, doc, data, targetCollection?.hasAuth);
  const forbidden = risks.filter((risk) => risk.kind === "forbidden");
  const warnings = risks.map((risk) =>
    risk.kind === "forbidden" ? `FORBIDDEN: ${risk.reason}` : `WARNING: ${risk.reason}`
  );

  return reviewReport(input, { fieldDiffs, unchanged, risks, forbidden, warnings }, surface);
}

export const isUpdatePreview = (output: unknown): boolean =>
  isRecord(output) && Array.isArray(output.fieldsChanged);
