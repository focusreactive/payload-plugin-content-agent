import type {
  ArrayField,
  Block,
  BlocksField,
  Field,
  JoinField,
  RadioField,
  RichTextField,
  SelectField,
  Tab,
} from "payload";
import { isRecord } from "../borders.js";
import type { SchemaField } from "../types.js";
import { featureNodeTypes, rememberEditorConfig } from "./editorNodes.js";
import { plainText } from "./plainText.js";

export interface IntrospectCtx {
  blocksBySlug: Map<string, Block>;
  /** How often each block is being expanded on the current path. */
  expandingBlocks: Map<string, number>;
  /** A block on the current path already repeats its parent. */
  repeated: boolean;
  /** The block whose fields are being expanded. */
  parentBlock?: string;
  language: string;
}

const isBlock = (value: unknown): value is Block =>
  isRecord(value) &&
  typeof value.slug === "string" &&
  value.slug !== "" &&
  Array.isArray(value.fields);

// Duck-typed on purpose: a Map from another realm (a test sandbox) fails `instanceof Map`.
type FeatureMap = { get: (key: string) => unknown; keys: () => Iterable<unknown> };

const isFeatureMap = (value: unknown): value is FeatureMap =>
  isRecord(value) && typeof value.get === "function" && typeof value.keys === "function";

function featureMapOf(field: RichTextField): FeatureMap | undefined {
  const editor: unknown = field.editor;
  const featureMap =
    isRecord(editor) && isRecord(editor.editorConfig)
      ? editor.editorConfig.resolvedFeatureMap
      : undefined;

  return isFeatureMap(featureMap) ? featureMap : undefined;
}

function applyIdentityMeta(base: Partial<SchemaField>, field: Field | Tab, language: string): void {
  if ("name" in field && field.name) {
    base.name = field.name;
  }

  if ("label" in field && field.label) {
    base.label = plainText(field.label, language);
  }

  if ("unique" in field && field.unique) {
    base.unique = true;
  }

  if ("required" in field) {
    base.required = !!field.required;
  }

  if ("localized" in field && field.localized) {
    base.localized = true;
  }
}

function applyAdminMeta(base: Partial<SchemaField>, field: Field | Tab, language: string): void {
  const admin: unknown = "admin" in field ? field.admin : undefined;
  const isVirtual = "virtual" in field && !!field.virtual;

  if (isRecord(admin) && "description" in admin) {
    base.description = plainText(admin.description, language);
  }

  if (isVirtual || (isRecord(admin) && (admin.readOnly || admin.hidden === true))) {
    base.readOnly = true;
  }

  if (isRecord(admin) && typeof admin.condition === "function") {
    base.conditional = true;
  }
}

function extractBaseMeta(field: Field | Tab, ctx: IntrospectCtx): Partial<SchemaField> {
  const base: Partial<SchemaField> = {};

  applyIdentityMeta(base, field, ctx.language);
  applyAdminMeta(base, field, ctx.language);

  if ("defaultValue" in field) {
    const defaultValue = field.defaultValue;

    if (
      typeof defaultValue === "string" ||
      typeof defaultValue === "number" ||
      typeof defaultValue === "boolean"
    ) {
      base.defaultValue = defaultValue;
    }
  }

  return base;
}

export function introspectFields(fields: Field[], ctx: IntrospectCtx): SchemaField[] {
  const result: SchemaField[] = [];

  for (const field of fields) {
    if (field.type === "ui") continue;
    if ("hidden" in field && field.hidden === true) continue;

    if (field.type === "tabs") {
      for (const tab of field.tabs) {
        if ("name" in tab && tab.name) {
          result.push({
            ...extractBaseMeta(tab, ctx),
            name: tab.name,
            type: "group",
            fields: introspectFields(tab.fields, ctx),
          });
        } else {
          result.push(...introspectFields(tab.fields, ctx));
        }
      }

      continue;
    }

    if (field.type === "collapsible" || field.type === "row") {
      result.push(...introspectFields(field.fields, ctx));
      continue;
    }

    if (field.type === "group" && !("name" in field && field.name)) {
      result.push(...introspectFields(field.fields ?? [], ctx));
      continue;
    }

    const introspected = introspectField(field, ctx);

    if (introspected) result.push(introspected);
  }

  return result;
}

const MAX_SELF_NESTING = 2;

function introspectBlock(
  block: Block,
  ctx: IntrospectCtx
): NonNullable<SchemaField["blocks"]>[number] {
  const label = plainText(block.labels?.singular, ctx.language);
  const description = plainText(block.admin?.custom?.description, ctx.language);
  const group = plainText(block.admin?.group, ctx.language);
  const head = {
    slug: block.slug,
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    ...(group ? { group } : {}),
  };

  // One level of a block directly inside itself keeps its fields. Any other cycle is cut, and so
  // is every repeat after the first on a path, so blocks that hold each other do not multiply.
  const onPath = ctx.expandingBlocks.get(block.slug) ?? 0;
  const repeat = onPath > 0;
  const parent = ctx.parentBlock;

  if (repeat && (onPath >= MAX_SELF_NESTING || ctx.repeated || parent !== block.slug))
    return { ...head, fields: [] };
  ctx.expandingBlocks.set(block.slug, onPath + 1);
  ctx.parentBlock = block.slug;
  if (repeat) ctx.repeated = true;

  try {
    return { ...head, fields: introspectFields(block.fields, ctx) };
  } finally {
    ctx.expandingBlocks.set(block.slug, onPath);
    ctx.parentBlock = parent;
    if (repeat) ctx.repeated = false;
  }
}

function extractRichTextBlocks(
  featureMap: FeatureMap | undefined,
  ctx: IntrospectCtx
): {
  blocks?: SchemaField["blocks"];
  inlineBlocks?: SchemaField["inlineBlocks"];
} {
  try {
    const blocksFeature = featureMap?.get("blocks");
    const props = isRecord(blocksFeature) ? blocksFeature.sanitizedServerFeatureProps : undefined;

    if (!isRecord(props)) return {};

    const resolve = (list: unknown): Block[] => {
      const entries: unknown[] = Array.isArray(list) ? list : [];

      return entries
        .map((entry) => (typeof entry === "string" ? ctx.blocksBySlug.get(entry) : entry))
        .filter(isBlock);
    };

    const blocks = resolve(props.blocks).map((block) => introspectBlock(block, ctx));
    const inlineBlocks = resolve(props.inlineBlocks).map((block) => introspectBlock(block, ctx));

    return {
      ...(blocks.length ? { blocks } : {}),
      ...(inlineBlocks.length ? { inlineBlocks } : {}),
    };
  } catch {
    return {};
  }
}

function detectRichTextEditor(field: RichTextField): "lexical" | "slate" | "unknown" {
  const editor: unknown = field.editor;

  if (!isRecord(editor)) return "unknown";
  if (isRecord(editor.editorConfig) && editor.editorConfig.resolvedFeatureMap) return "lexical";
  const cellComponent = editor.CellComponent;
  const cellPath =
    typeof cellComponent === "string"
      ? cellComponent
      : isRecord(cellComponent)
        ? cellComponent.path
        : undefined;

  if (typeof cellPath === "string" && cellPath.includes("richtext-slate")) return "slate";

  return "unknown";
}

function introspectRichTextField(
  field: RichTextField,
  base: Partial<SchemaField>,
  ctx: IntrospectCtx
): SchemaField {
  const editor = detectRichTextEditor(field);
  const featureMap = featureMapOf(field);
  const features = [...(featureMap?.keys() ?? [])].filter(
    (key): key is string => typeof key === "string"
  );

  if (editor !== "lexical")
    return { ...base, name: base.name!, type: "richText", editor, unsupported: true };
  const result: SchemaField = {
    ...base,
    name: base.name!,
    type: "richText",
    editor,
    features,
    nodeTypes: featureNodeTypes(features.map((key) => featureMap?.get(key))),
    ...extractRichTextBlocks(featureMap, ctx),
  };

  const adapter: unknown = field.editor;

  rememberEditorConfig(result, isRecord(adapter) ? adapter.editorConfig : undefined);

  return result;
}

function fieldOptions(field: SelectField | RadioField, language: string) {
  return field.options?.map((opt) =>
    typeof opt === "string"
      ? opt
      : { label: plainText(opt.label, language) ?? opt.value, value: opt.value }
  );
}

function introspectSelectField(
  field: SelectField,
  base: Partial<SchemaField>,
  language: string
): SchemaField {
  const options = fieldOptions(field, language);

  return {
    ...base,
    name: base.name!,
    type: "select",
    hasMany: !!field.hasMany,
    options,
  };
}

function introspectRadioField(
  field: RadioField,
  base: Partial<SchemaField>,
  language: string
): SchemaField {
  const options = fieldOptions(field, language);

  return { ...base, name: base.name!, type: "radio", options };
}

function introspectArrayField(
  field: ArrayField,
  base: Partial<SchemaField>,
  ctx: IntrospectCtx
): SchemaField {
  return {
    ...base,
    name: base.name!,
    type: "array",
    fields: introspectFields(field.fields, ctx),
    ...(typeof field.minRows === "number" ? { minRows: field.minRows } : {}),
    ...(typeof field.maxRows === "number" ? { maxRows: field.maxRows } : {}),
  };
}

function introspectBlocksField(
  field: BlocksField,
  base: Partial<SchemaField>,
  ctx: IntrospectCtx
): SchemaField {
  // With hoisted blocks Payload fills `blockReferences` and leaves `blocks` empty.
  const rawBlocks = (field.blockReferences?.length ? field.blockReferences : field.blocks) ?? [];
  const resolved = rawBlocks
    .map((entry) => (typeof entry === "string" ? ctx.blocksBySlug.get(entry) : entry))
    .filter(isBlock);

  return {
    ...base,
    name: base.name!,
    type: "blocks",
    ...(typeof field.minRows === "number" ? { minRows: field.minRows } : {}),
    ...(typeof field.maxRows === "number" ? { maxRows: field.maxRows } : {}),
    blocks: resolved.map((block) => introspectBlock(block, ctx)),
  };
}

function introspectJoinField(field: JoinField, base: Partial<SchemaField>): SchemaField {
  return {
    ...base,
    name: base.name!,
    type: "join",
    relationTo: field.collection,
    readOnly: true,
    description:
      base.description || `Reverse relationship from ${field.collection} (virtual, read-only)`,
  };
}

function introspectUnknownField(field: Field, base: Partial<SchemaField>): SchemaField | null {
  const type: unknown = field.type;

  return base.name
    ? {
        ...base,
        name: base.name,
        type: typeof type === "string" ? type : "unknown",
        unsupported: true,
      }
    : null;
}

function introspectField(field: Field, ctx: IntrospectCtx): SchemaField | null {
  const base = extractBaseMeta(field, ctx);

  // A field with no name holds no data.
  if (!base.name) return null;

  switch (field.type) {
    case "text":
    case "number":
      return { ...base, name: base.name!, type: field.type, hasMany: !!field.hasMany };
    case "textarea":
    case "email":
    case "code":
    case "date":
    case "json":
    case "point":
      return { ...base, name: base.name!, type: field.type };

    case "richText":
      return introspectRichTextField(field, base, ctx);

    case "checkbox":
      return { ...base, name: base.name!, type: "checkbox" };

    case "select":
      return introspectSelectField(field, base, ctx.language);

    case "radio":
      return introspectRadioField(field, base, ctx.language);

    case "relationship":
      return {
        ...base,
        name: base.name!,
        type: "relationship",
        relationTo: field.relationTo,
        hasMany: !!field.hasMany,
      };

    case "upload":
      return {
        ...base,
        name: base.name!,
        type: "upload",
        relationTo: field.relationTo,
        hasMany: !!field.hasMany,
      };

    case "array":
      return introspectArrayField(field, base, ctx);

    case "group":
      return {
        ...base,
        name: base.name!,
        type: "group",
        fields: introspectFields(field.fields, ctx),
      };

    case "blocks":
      return introspectBlocksField(field, base, ctx);

    case "join":
      return introspectJoinField(field, base);

    default:
      return introspectUnknownField(field, base);
  }
}
