import type { SchemaContext, SchemaCollection, SchemaGlobal, SchemaField } from "../types.js";

type SchemaBlock = NonNullable<SchemaField["blocks"]>[number];

export interface SchemaRenderOptions {
  blockDetail?: "full" | "compact";
  /** Replaces the sentence that says which tools take a locale code. */
  localeHint?: string;
  /** Replaces the line under a collection or global that has no drafts. */
  noDraftsNote?: string;
}

const CHAT_LOCALE_HINT =
  "When the user asks to edit or translate content in a specific language, pass that locale code to editContent / findReplaceContent / searchContent.";

interface RenderState {
  noDraftsNote: string;
  blockDetail: "full" | "compact";
  seenBlocks: Map<string, string>;
}

interface FieldFrame {
  depth: number;
  indent: string;
  nested: string[];
  renderState: RenderState;
}

const AUTO_COMPACT_THRESHOLD = 24_000;
const LIVE_WITHOUT_DRAFTS =
  "Agent access: no drafts. A change of an existing document is live at once: the chat asks the person to confirm it before the write. No new documents.";

export interface BlockVariant {
  block: SchemaBlock;
  /** The fields that hold this block, as `<collection or global>.<field path>`. */
  usedIn: string[];
}

const blockShape = (block: SchemaBlock): string => JSON.stringify(block.fields);

/**
 * Every block of the schema by slug. A slug is unique only inside one field,
 * so one slug can name several blocks with different fields: each is a variant.
 */
export function collectBlockDefs(context: SchemaContext): Map<string, BlockVariant[]> {
  const map = new Map<string, BlockVariant[]>();

  const walkFields = (fields: SchemaField[] | undefined, owner: string) => {
    for (const field of fields ?? []) {
      const path = `${owner}.${field.name}`;

      for (const block of [...(field.blocks ?? []), ...(field.inlineBlocks ?? [])]) {
        const variants = map.get(block.slug) ?? [];
        const shape = blockShape(block);
        const known = variants.find((variant) => blockShape(variant.block) === shape);

        if (known) {
          if (!known.usedIn.includes(path)) known.usedIn.push(path);
          continue;
        }

        variants.push({ block, usedIn: [path] });
        map.set(block.slug, variants);
        walkFields(block.fields, `${path}[${block.slug}]`);
      }

      walkFields(field.fields, path);
    }
  };

  for (const collection of context.collections) walkFields(collection.fields, collection.slug);
  for (const global of context.globals) walkFields(global.fields, global.slug);

  return map;
}

function appendFieldFlags(start: string, field: SchemaField): string {
  let line = start;

  if (field.editor) line += ` [${field.editor}]`;
  if (field.required) line += " [required]";
  if (field.localized) line += " [localized]";
  if (field.hasMany) line += " [hasMany]";
  if (field.readOnly) line += " [readOnly - NEVER write this field]";
  if (field.conditional) line += " [conditional - may be hidden depending on other fields]";

  if (field.unsupported) {
    line +=
      field.type === "richText"
        ? " [non-Lexical rich text editor - not editable via agent tools]"
        : " [custom field type - not editable via agent tools]";
  }

  if (field.relationTo) {
    line += ` → ${Array.isArray(field.relationTo) ? field.relationTo.join(" | ") : field.relationTo}`;
  }

  return line;
}

function appendFieldDetails(start: string, field: SchemaField): string {
  let line = start;

  if (field.options) {
    const values = field.options.map((option) =>
      typeof option === "string" ? option : option.value
    );

    line += ` [options: ${values.join(", ")}]`;
  }

  if (field.defaultValue !== undefined) line += ` [default: ${JSON.stringify(field.defaultValue)}]`;

  if (field.minRows !== undefined || field.maxRows !== undefined) {
    line += ` [rows: ${field.minRows ?? 0}-${field.maxRows ?? "∞"}]`;
  }

  if (field.type === "richText" && (field.blocks?.length || field.inlineBlocks?.length)) {
    line += ` [embeds blocks - address fields inside as ${field.name}[blockId].subField]`;
  }

  if (field.description) line += ` - ${field.description}`;
  if (field.label && field.label !== field.name) line += ` (label: "${field.label}")`;

  return line;
}

function renderBlocks(blocks: SchemaBlock[], kind: string, frame: FieldFrame): void {
  const { depth, indent, nested, renderState } = frame;

  if (renderState.blockDetail === "compact") {
    const names = blocks.map((block) =>
      block.label && block.label !== block.slug ? `${block.slug} (${block.label})` : block.slug
    );

    nested.push(
      `${indent}  ${kind}s: ${names.join(", ")} - the fields of a block are not listed here: fetch them with your schema-inspection tool before using the block.`
    );

    return;
  }

  for (const block of blocks) {
    let header = `${indent}  ${kind} "${block.slug}"`;

    if (block.label && block.label !== block.slug) header += ` - ${block.label}`;
    if (block.group) header += ` [group: ${block.group}]`;
    if (block.description) header += `: ${block.description}`;

    const shape = blockShape(block);

    if (renderState.seenBlocks.get(block.slug) === shape) {
      nested.push(`${header} - fields as defined at its first occurrence above`);
      continue;
    }

    if (!renderState.seenBlocks.has(block.slug)) renderState.seenBlocks.set(block.slug, shape);
    nested.push(header);

    for (const child of block.fields) {
      nested.push(fieldToString(child, depth + 2, renderState));
    }
  }
}

function fieldToString(field: SchemaField, depth: number, renderState: RenderState): string {
  const indent = "  ".repeat(depth);
  let line = `${indent}- ${field.name} (${field.type})`;

  line = appendFieldFlags(line, field);
  line = appendFieldDetails(line, field);

  const nested: string[] = [];

  if (field.fields) {
    for (const child of field.fields) {
      nested.push(fieldToString(child, depth + 1, renderState));
    }
  }

  const frame: FieldFrame = { depth, indent, nested, renderState };

  if (field.blocks)
    renderBlocks(field.blocks, field.type === "richText" ? "Embedded block" : "Block", frame);
  if (field.inlineBlocks) renderBlocks(field.inlineBlocks, "Inline block", frame);

  return nested.length ? `${line}\n${nested.join("\n")}` : line;
}

function collectionToString(col: SchemaCollection, renderState: RenderState): string {
  const lines: string[] = [];
  const label = col.labels?.singular || col.slug;

  lines.push(`### ${label} (slug: "${col.slug}")`);
  if (col.description) lines.push(`Description: ${col.description}`);
  if (col.useAsTitle) lines.push(`Title field: "${col.useAsTitle}"`);

  const features: string[] = [];

  if (col.hasDrafts) features.push("drafts");
  if (col.hasVersions) features.push("versions");
  if (col.hasAuth) features.push("authentication");
  if (col.timestamps) features.push("timestamps (createdAt, updatedAt)");
  if (col.upload)
    features.push("upload (file-backed - requires an actual file; cannot be created without one)");
  if (features.length) lines.push(`Features: ${features.join(", ")}`);
  if (!col.hasDrafts) lines.push(renderState.noDraftsNote);

  lines.push("Fields:");

  for (const field of col.fields) {
    lines.push(fieldToString(field, 1, renderState));
  }

  return lines.join("\n") + "\n";
}

function globalToString(global: SchemaGlobal, renderState: RenderState): string {
  const lines: string[] = [];

  lines.push(`### ${global.label || global.slug} (slug: "${global.slug}")`);
  if (global.description) lines.push(`Description: ${global.description}`);
  if (!global.hasDrafts) lines.push(renderState.noDraftsNote);

  lines.push("Fields:");

  for (const field of global.fields) {
    lines.push(fieldToString(field, 1, renderState));
  }

  return lines.join("\n") + "\n";
}

export function schemaContextToString(context: SchemaContext, opts?: SchemaRenderOptions): string {
  const renderState: RenderState = {
    noDraftsNote: opts?.noDraftsNote ?? LIVE_WITHOUT_DRAFTS,
    blockDetail: opts?.blockDetail ?? "full",
    seenBlocks: new Map(),
  };
  const parts: string[] = [];

  if (context.locales?.length) {
    parts.push(
      `## Localization\nThis project is multi-locale. Locales: ${context.locales.join(", ")} (default: ${context.defaultLocale ?? context.locales[0]}).\n` +
        `Fields marked [localized] store a SEPARATE value per locale; other fields are shared across locales.\n` +
        `${opts?.localeHint ?? CHAT_LOCALE_HINT}\n`
    );
  }

  if (context.collections.length > 0) {
    parts.push("## Collections\n");

    for (const col of context.collections) {
      parts.push(collectionToString(col, renderState));
    }
  }

  if (context.globals.length > 0) {
    parts.push("## Globals\n");

    for (const global of context.globals) {
      parts.push(globalToString(global, renderState));
    }
  }

  return parts.join("\n");
}

export function renderSchemaForPrompt(
  context: SchemaContext,
  mode: "full" | "compact" | "auto" = "auto",
  opts: Pick<SchemaRenderOptions, "localeHint" | "noDraftsNote"> = {}
): { text: string; mode: "full" | "compact" } {
  const compact = () => schemaContextToString(context, { ...opts, blockDetail: "compact" });

  if (mode === "compact") return { text: compact(), mode: "compact" };
  const full = schemaContextToString(context, opts);

  if (mode === "full" || full.length <= AUTO_COMPACT_THRESHOLD) return { text: full, mode: "full" };

  return { text: compact(), mode: "compact" };
}
