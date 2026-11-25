import { tool } from "ai";
import { z } from "zod";
import type { SchemaContext, SchemaField } from "../../types.js";
import { collectBlockDefs } from "../../schema/introspector.js";
import { capMcpToolOutput } from "./outputCap.js";

const MAX_INLINE_JSON_CHARS = 20_000;

function slimBlocksFields(fields: SchemaField[]): SchemaField[] {
  return fields.map((field) => {
    if (field.type === "blocks" && field.blocks?.length) {
      return {
        ...field,
        blocks: field.blocks.map((block) => ({
          slug: block.slug,
          label: block.label,
          description: block.description,
          group: block.group,
          fields: [],
        })),
      };
    }

    if (field.fields?.length) return { ...field, fields: slimBlocksFields(field.fields) };

    return field;
  });
}

function blockInfo(block: NonNullable<SchemaField["blocks"]>[number]) {
  const full = { type: "block", ...block };

  if (JSON.stringify(full).length <= MAX_INLINE_JSON_CHARS) return full;

  return capMcpToolOutput({
    ...full,
    fields: slimBlocksFields(block.fields),
    note: "Nested blocks fields shown by slug only (this block's full schema is large) - call getSchemaInfo(blockSlug) for a specific nested block's fields.",
  });
}

export type BlockDefs = ReturnType<typeof collectBlockDefs>;

export function schemaTargets(schema: SchemaContext, blockDefs: BlockDefs) {
  return {
    collections: schema.collections.map((entry) => ({
      slug: entry.slug,
      label: entry.labels?.singular || entry.slug,
      fieldCount: entry.fields.length,
      hasDrafts: entry.hasDrafts,
      hasAuth: entry.hasAuth,
    })),
    globals: schema.globals.map((entry) => ({
      slug: entry.slug,
      label: entry.label || entry.slug,
      fieldCount: entry.fields.length,
      hasDrafts: entry.hasDrafts,
    })),
    blocks: [...blockDefs.keys()],
  };
}

export function schemaInfo(schema: SchemaContext, blockDefs: BlockDefs, target: string) {
  const collection = schema.collections.find((candidate) => candidate.slug === target);

  if (collection) {
    const full = { type: "collection", ...collection };

    if (JSON.stringify(full).length <= MAX_INLINE_JSON_CHARS) return full;
    const slimmed = {
      ...full,
      fields: slimBlocksFields(collection.fields),
      note: "Blocks fields shown by slug only (this collection's full schema is large) - call getSchemaInfo(blockSlug) for a specific block's fields.",
    };

    return capMcpToolOutput(slimmed);
  }

  const global = schema.globals.find((candidate) => candidate.slug === target);

  if (global) {
    const full = { type: "global", ...global };

    if (JSON.stringify(full).length <= MAX_INLINE_JSON_CHARS) return full;
    const slimmed = {
      ...full,
      fields: slimBlocksFields(global.fields),
      note: "Blocks fields shown by slug only (this global's full schema is large) - call getSchemaInfo(blockSlug) for a specific block's fields.",
    };

    return capMcpToolOutput(slimmed);
  }

  const variants = blockDefs.get(target);

  if (variants?.length === 1) return blockInfo(variants[0].block);

  if (variants?.length)
    return capMcpToolOutput({
      type: "block",
      slug: target,
      note: `"${target}" names ${variants.length} different blocks. Use the one whose \`usedIn\` lists the field you write to.`,
      variants: variants.map(({ block, usedIn }) => ({
        usedIn,
        ...block,
        fields: slimBlocksFields(block.fields),
      })),
    });

  return {
    error: `"${target}" not found. Available collections: ${schema.collections.map((entry) => entry.slug).join(", ")}. Globals: ${schema.globals.map((entry) => entry.slug).join(", ")}. Blocks: ${[...blockDefs.keys()].join(", ")}`,
  };
}

export function createSchemaInfoTool(schema: SchemaContext) {
  const blockDefs = collectBlockDefs(schema);

  return tool({
    description:
      "Returns the schema of one collection, global or block by slug, or lists all of them. The schema overview in your instructions already shows the fields of every collection and global, so call this for a block the overview lists by slug only, or for a detail the overview does not show.",
    inputSchema: z.object({
      target: z
        .string()
        .optional()
        .describe("Collection, global, or block slug to inspect. Omit to list all available."),
    }),
    execute: ({ target }: { target?: string }) =>
      Promise.resolve(
        target ? schemaInfo(schema, blockDefs, target) : schemaTargets(schema, blockDefs)
      ),
    toModelOutput: ({ output }) => ({
      type: "text" as const,
      value: typeof output === "string" ? output : JSON.stringify(output),
    }),
  });
}
