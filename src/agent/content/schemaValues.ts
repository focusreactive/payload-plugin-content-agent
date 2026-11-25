import { randomUUID } from "node:crypto";
import type { SerializedParagraphNode, SerializedTextNode } from "@payloadcms/richtext-lexical";
import { isRecord } from "../../borders.js";
import type { DocFields, RichTextState } from "../../borders.js";
import type { SchemaField } from "../../types.js";
import { editorFitError } from "./editorFit.js";

const TEMP_ID_PREFIX = "tmp_";

function tempId(): string {
  return `${TEMP_ID_PREFIX}${randomUUID()}`;
}

export function isTempId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(TEMP_ID_PREFIX);
}

function stripTempIdsFromFields(value: object): DocFields {
  const out: DocFields = {};

  for (const [key, child] of Object.entries(value)) {
    if (key === "id" && isTempId(child)) continue;
    out[key] = stripTempIds(child);
  }

  return out;
}

export function stripTempIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTempIds);
  if (value && typeof value === "object") return stripTempIdsFromFields(value);

  return value;
}

const RESERVED_SAVE_KEYS = new Set(["id", "createdAt", "updatedAt"]);

export function buildChangedFields(
  original: DocFields,
  current: DocFields
): { patch: DocFields; changed: string[] } {
  const originalFields = stripTempIdsFromFields(original ?? {});
  const currentFields = stripTempIdsFromFields(current ?? {});
  const patch: DocFields = {};
  const changed: string[] = [];
  const keys = new Set([...Object.keys(originalFields), ...Object.keys(currentFields)]);

  for (const key of keys) {
    if (RESERVED_SAVE_KEYS.has(key)) continue;
    const value = key in currentFields ? currentFields[key] : null;

    if (JSON.stringify(originalFields[key]) !== JSON.stringify(value)) {
      patch[key] = value;
      changed.push(key);
    }
  }

  return { patch, changed };
}

function emptyParagraph(): SerializedParagraphNode<SerializedTextNode> {
  return {
    type: "paragraph",
    children: [
      { type: "text", detail: 0, format: 0, mode: "normal", style: "", text: "", version: 1 },
    ],
    direction: null,
    format: "",
    indent: 0,
    textFormat: 0,
    textStyle: "",
    version: 1,
  };
}

// The root must hold one empty paragraph: `children: []` breaks the admin editor on load.
export function emptyRichText(): RichTextState {
  return {
    root: {
      type: "root",
      children: [emptyParagraph()],
      direction: null,
      format: "",
      indent: 0,
      version: 1,
    },
  };
}

export function ensureNonEmptyRichText<Value>(value: Value): Value {
  if (
    isRecord(value) &&
    isRecord(value.root) &&
    Array.isArray(value.root.children) &&
    value.root.children.length === 0
  ) {
    value.root.children.push(emptyParagraph());
  }

  return value;
}

export function healEmptyRichTextDeep<Value>(value: Value, depth = 0): Value {
  if (depth > 100) return value;

  if (Array.isArray(value)) {
    for (const item of value) healEmptyRichTextDeep(item, depth + 1);

    return value;
  }

  if (isRecord(value)) {
    if (isRecord(value.root) && Array.isArray(value.root.children)) {
      ensureNonEmptyRichText(value);

      return value;
    }

    for (const child of Object.values(value)) healEmptyRichTextDeep(child, depth + 1);
  }

  return value;
}

/** Rows and blocks inside the fields of a new item get an id, so the session can address them. */
function withNestedIds(fields: SchemaField[], values: DocFields): DocFields {
  const out: DocFields = { ...values };

  for (const field of fields) {
    const value: unknown = out[field.name];

    if (field.type === "group" && isRecord(value)) {
      out[field.name] = withNestedIds(field.fields ?? [], value);
      continue;
    }

    if ((field.type !== "array" && field.type !== "blocks") || !Array.isArray(value)) continue;
    out[field.name] = value.map((row: unknown) => {
      if (!isRecord(row)) return row;
      const rowFields =
        field.type === "blocks"
          ? (field.blocks?.find((block) => block.slug === row.blockType)?.fields ?? [])
          : (field.fields ?? []);

      return { ...withNestedIds(rowFields, row), id: row.id ?? tempId() };
    });
  }

  return out;
}

function groupDefaults(fields: SchemaField[]): DocFields {
  const out: DocFields = {};

  for (const field of fields) {
    if (!field.name) continue;

    if (field.required) {
      const def = defaultForField(field);

      if (def !== undefined) out[field.name] = def;
    } else if (field.type === "group") {
      const nested = groupDefaults(field.fields ?? []);

      if (Object.keys(nested).length > 0) out[field.name] = nested;
    }
  }

  return out;
}

function firstOptionDefault(field: SchemaField): unknown {
  const first = field.options?.[0];
  const val = typeof first === "string" ? first : first?.value;

  return field.hasMany ? [] : (val ?? null);
}

function defaultForField(field: SchemaField): unknown {
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "code":
      return "";
    case "number":
      return 0;
    case "checkbox":
      return false;
    case "richText":
      return emptyRichText();
    case "array":
    case "blocks":
      // An empty array would violate minRows: leave it unset so the caller supplies the rows.
      return field.minRows && field.minRows > 0 ? undefined : [];
    case "group":
      return groupDefaults(field.fields ?? []);
    case "select":
    case "radio":
      return firstOptionDefault(field);
    default:
      return null;
  }
}

function buildFieldsSkeleton(fields: SchemaField[], overrides: DocFields): DocFields {
  const obj: DocFields = { id: tempId() };

  for (const field of fields) {
    if (!field.name || field.name in overrides) continue;

    if (field.required) {
      const def = defaultForField(field);

      if (def !== undefined) obj[field.name] = def;
      continue;
    }

    if (field.type === "group") {
      const nested = groupDefaults(field.fields ?? []);

      if (Object.keys(nested).length > 0) obj[field.name] = nested;
    }
  }

  return { ...obj, ...withNestedIds(fields, overrides) };
}

export function buildBlockSkeleton(
  blockDef: { slug: string; fields: SchemaField[] },
  overrides: DocFields = {}
): DocFields {
  return { ...buildFieldsSkeleton(blockDef.fields, overrides), blockType: blockDef.slug };
}

export function buildRowSkeleton(fields: SchemaField[], overrides: DocFields = {}): DocFields {
  return buildFieldsSkeleton(fields, overrides);
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

const optionValues = (field: SchemaField): string[] =>
  (field.options ?? []).map((option) => (typeof option === "string" ? option : option.value));

const fail = (msg: string): ValidationResult => ({ ok: false, error: msg });

function validateText(field: SchemaField, value: unknown): ValidationResult {
  if (field.hasMany) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string")
      ? { ok: true }
      : fail(`"${field.name}" expects an array of strings (hasMany: true)`);
  }

  return typeof value === "string" ? { ok: true } : fail(`"${field.name}" expects a string`);
}

function validatePlainString(field: SchemaField, value: unknown): ValidationResult {
  return typeof value === "string" ? { ok: true } : fail(`"${field.name}" expects a string`);
}

function validateNumber(field: SchemaField, value: unknown): ValidationResult {
  if (field.hasMany) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "number")
      ? { ok: true }
      : fail(`"${field.name}" expects an array of numbers (hasMany: true)`);
  }

  return typeof value === "number" ? { ok: true } : fail(`"${field.name}" expects a number`);
}

function validateCheckbox(field: SchemaField, value: unknown): ValidationResult {
  return typeof value === "boolean" ? { ok: true } : fail(`"${field.name}" expects a boolean`);
}

function validateDate(field: SchemaField, value: unknown): ValidationResult {
  if (value instanceof Date) return { ok: true };

  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? { ok: true }
    : fail(
        `"${field.name}" expects a date as an ISO 8601 string, e.g. "2000-01-31" or "2000-01-31T09:00:00.000Z"`
      );
}

function validateOption(field: SchemaField, value: unknown): ValidationResult {
  const allowed = optionValues(field);
  const check = (candidate: unknown) =>
    typeof candidate === "string" && allowed.includes(candidate);

  if (field.hasMany) {
    if (!Array.isArray(value)) return fail(`"${field.name}" expects an array of options`);
    const bad = value.find((entry) => !check(entry));

    return bad === undefined
      ? { ok: true }
      : fail(
          `"${bad}" is not an allowed option for "${field.name}" (allowed: ${allowed.join(", ")})`
        );
  }

  return check(value)
    ? { ok: true }
    : fail(
        `"${value}" is not an allowed option for "${field.name}" (allowed: ${allowed.join(", ")})`
      );
}

function validateReference(field: SchemaField, value: unknown): ValidationResult {
  const targets = Array.isArray(field.relationTo) ? field.relationTo : null;
  const isPair = (candidate: unknown) =>
    isRecord(candidate) &&
    "value" in candidate &&
    (!targets ||
      (typeof candidate.relationTo === "string" && targets.includes(candidate.relationTo)));
  const isRef = (candidate: unknown) =>
    isPair(candidate) ||
    (!targets && (typeof candidate === "string" || typeof candidate === "number"));

  if (targets && !(field.hasMany && Array.isArray(value) ? value.every(isRef) : isRef(value)))
    return fail(
      `"${field.name}" points to several collections, so ${field.hasMany ? "each item" : "the value"} is { relationTo, value }: relationTo is one of ${targets.join(", ")} and value is the id of a document there`
    );

  if (field.hasMany) {
    if (!Array.isArray(value)) return fail(`"${field.name}" expects an array of related ids`);

    return value.every(isRef)
      ? { ok: true }
      : fail(`"${field.name}" items must be ids or {relationTo, value}`);
  }

  return isRef(value)
    ? { ok: true }
    : fail(`"${field.name}" expects a related id or {relationTo, value}`);
}

function validateRichText(field: SchemaField, value: unknown): ValidationResult {
  if (!isRecord(value) || !value.root)
    return fail(`"${field.name}" expects a Lexical value with a root node`);
  const fitError = editorFitError(field, undefined, value);

  return fitError ? fail(fitError) : { ok: true };
}

function validatePoint(field: SchemaField, value: unknown): ValidationResult {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((coordinate) => typeof coordinate === "number")
    ? { ok: true }
    : fail(`"${field.name}" expects [lng, lat]`);
}

function validateSubfields(
  field: SchemaField,
  value: Record<string, unknown>,
  label: string
): ValidationResult {
  const sub = (field.fields ?? []).filter((subField) => subField.name);

  if (!sub.length) return { ok: true };
  const known = new Set(sub.map((subField) => subField.name!));

  for (const key of Object.keys(value)) {
    if (key === "id" || key === "blockType" || key === "blockName") continue;
    if (!known.has(key))
      return {
        ok: false,
        error: `${label} has no field "${key}". Its fields: ${sub.map((subField) => `${subField.name} (${subField.type})`).join(", ")}.`,
      };
  }

  for (const subField of sub) {
    if (!((subField.name as string) in value) || value[subField.name!] === undefined) continue;
    const result = validateFieldValue(subField, value[subField.name!]);

    if (!result.ok)
      return { ok: false, error: `${label}.${String(result.error ?? "").replace(/^"/u, "")}` };
  }

  return { ok: true };
}

function validateGroup(field: SchemaField, value: unknown): ValidationResult {
  if (!isRecord(value)) return fail(`"${field.name}" expects an object`);

  return validateSubfields(field, value, `"${field.name}"`);
}

function validateArray(field: SchemaField, value: unknown): ValidationResult {
  if (!Array.isArray(value)) return fail(`"${field.name}" expects an array`);
  const sub = (field.fields ?? []).filter((subField) => subField.name);

  for (let i = 0; i < value.length; i++) {
    const row: unknown = value[i];

    if (!isRecord(row)) {
      return fail(
        `"${field.name}"[${i}] must be an object with the row's fields { ${sub.map((subField) => `${subField.name}: ${subField.type}`).join(", ")} }, ` +
          `not ${Array.isArray(row) ? "an array" : typeof row}${typeof row === "string" ? ` ("${String(row).slice(0, 40)}")` : ""}. ` +
          `A row's text goes in its text field: { ${sub[0]?.name ?? "text"}: "..." }.`
      );
    }

    if (sub.length) {
      const result = validateSubfields(field, row, `"${field.name}"[${i}]`);

      if (!result.ok) return result;
    }
  }

  return { ok: true };
}

function validateBlocks(field: SchemaField, value: unknown): ValidationResult {
  if (!Array.isArray(value)) return fail(`"${field.name}" expects an array`);
  const allowed = (field.blocks ?? []).map((block) => block.slug);

  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    const def = isRecord(item)
      ? field.blocks?.find((block) => block.slug === item.blockType)
      : undefined;

    if (!isRecord(item) || !def)
      return fail(
        `"${field.name}"[${i}] must be an object with a \`blockType\` that "${field.name}" allows: ${allowed.join(", ")}`
      );
    const result = validateSubfields(
      { ...field, fields: def.fields },
      item,
      `"${field.name}"[${i}]`
    );

    if (!result.ok) return result;
  }

  return { ok: true };
}

function validateByType(field: SchemaField, value: unknown): ValidationResult {
  switch (field.type) {
    case "text":
      return validateText(field, value);
    case "textarea":
    case "email":
    case "code":
      return validatePlainString(field, value);

    case "number":
      return validateNumber(field, value);

    case "checkbox":
      return validateCheckbox(field, value);

    case "date":
      return validateDate(field, value);

    case "select":
    case "radio":
      return validateOption(field, value);

    case "relationship":
    case "upload":
      return validateReference(field, value);

    case "richText":
      return validateRichText(field, value);

    case "point":
      return validatePoint(field, value);

    case "group":
      return validateGroup(field, value);

    case "array":
      return validateArray(field, value);

    case "blocks":
      return validateBlocks(field, value);

    default:
      return { ok: true };
  }
}

export function validateFieldValue(field: SchemaField, value: unknown): ValidationResult {
  if (field.readOnly) return fail(`Field "${field.name}" is read-only and must not be modified`);
  if (field.unsupported)
    return fail(
      `Field "${field.name}" has a custom field type ("${field.type}") the agent cannot safely edit`
    );

  if (value === null || value === undefined) {
    return field.required
      ? fail(
          `Field "${field.name}" is required and cannot be empty: pass a value of its type (${field.type})`
        )
      : { ok: true };
  }

  return validateByType(field, value);
}
