import { tool } from "ai";
import { z } from "zod";
import { isRecord } from "../../../borders.js";
import type { McpCallOptions, McpTool } from "../../../borders.js";
import type { SchemaContext } from "../../../types.js";
import { containsBlocksArray } from "../blockWriteGuard.js";
import { UPDATE_CONTROL_KEYS } from "../mcp/controlKeys.js";
import { parseMcpDoc } from "../../mcpParse.js";
import { capMcpToolOutput } from "../outputCap.js";
import { isUpdatePreview, previewUpdate } from "../review.js";
import { summarizeMcpOutput } from "../mcp/shared.js";
import { CHAT_SURFACE } from "../../toolSurface.js";
import type { ToolSurface } from "../../toolSurface.js";
import { destructiveUpdateApproval, gatedMcpWrite } from "../mcp/writeGate.js";
import type { WriteGateContext, WriteTarget } from "../mcp/writeGate.js";
import { unknownFieldsError } from "../../toolErrors.js";
import { BULK_CONFIRM_THRESHOLD } from "../../content/bulk.js";
import type { DocumentIO } from "../../content/documentIo.js";
import { changedList } from "../../content/listEdit.js";
import type { ListEdit } from "../../content/listEdit.js";
import { ownLocaleValues } from "../../content/localeState.js";
import { documentNotFoundError } from "../../toolErrors.js";

export const UPDATE_DOCUMENT_TOOL = "updateDocument";

/**
 * One collection or global `updateDocument` may write. `mcpTool` is the site's update tool
 * that carries the write; without it the write goes through `DocumentIO`.
 */
export interface UpdateTarget {
  mcpTool?: McpTool;
  collection?: string;
  global?: string;
}

export interface UpdateInput {
  collection?: string;
  global?: string;
  id?: string | number;
  data?: Record<string, unknown>;
  add?: Record<string, unknown[]>;
  remove?: Record<string, unknown[]>;
  locale?: string;
  preview?: boolean;
}

type Lists = Record<string, ListEdit>;

/** The `add` parameter of an update, the same for the chat and for an outside agent. */
export const listAddInput = z
  .record(z.string(), z.array(z.unknown()))
  .optional()
  .describe(
    "Fields with many values (hasMany) only: { <field name>: [<entries>] }, the entries to put at the end of each list, each of the type one entry of the field takes: a document id for a relationship or upload, or { relationTo: <collection slug>, value: <id> } when the field points to several collections; an option value for a select; a string or a number for a text or number list. Every entry the field holds stays where it is, and an entry it holds already is not added twice."
  );

/** `data` = the fields the update writes; `lists` = the `add`/`remove` edits not read yet. */
export type ResolvedUpdate = {
  target: WriteTarget;
  params: Record<string, unknown>;
  data: Record<string, unknown>;
  lists: Lists;
};

type Resolved = ResolvedUpdate | { error: string };

const quoted = (names: string[]) => names.map((name) => `"${name}"`).join(", ");

function targetError(schema: SchemaContext, targets: UpdateTarget[], input: UpdateInput): string {
  const collections = targets.flatMap((target) => (target.collection ? [target.collection] : []));
  const globals = targets.flatMap((target) => (target.global ? [target.global] : []));
  const valid = `Collections: ${quoted(collections) || "none"}. Globals: ${quoted(globals) || "none"}.`;
  const slug = input.collection ?? input.global;

  if (!slug || (input.collection && input.global))
    return `Pass either \`collection\` with \`id\`, or \`global\`. ${valid}`;
  const inSchema = input.collection
    ? schema.collections.some((collection) => collection.slug === slug)
    : schema.globals.some((global) => global.slug === slug);

  if (!inSchema) return `Unknown ${input.collection ? "collection" : "global"} "${slug}". ${valid}`;

  return `The site gives the agent no direct update of "${slug}". Change it with editContent({ ${input.collection ? "collection, id" : "global"}, instruction }). What updateDocument writes: ${valid}`;
}

function listsOf({ add, remove }: UpdateInput): { lists: Lists } | { error: string } {
  const lists: Lists = {};

  for (const [key, edits] of [
    ["add", add],
    ["remove", remove],
  ] as const) {
    for (const [name, entries] of Object.entries(edits ?? {})) {
      if (!Array.isArray(entries))
        return {
          error: `\`${key}\` maps a field name to an array of entries, e.g. { "${name}": [<entry>] }.`,
        };
      lists[name] = { ...lists[name], [key]: entries };
    }
  }

  return { lists };
}

function listError(
  slug: string,
  fields: SchemaContext["collections"][number]["fields"],
  data: Record<string, unknown>,
  lists: Lists
): string | null {
  const names = Object.keys(lists);
  const many = fields.filter((field) => field.hasMany).map((field) => field.name);
  const other = names.filter((name) => !many.includes(name));

  if (other.length)
    return `Nothing was written: "${slug}" has no field with many values named ${quoted(other)}. \`add\` and \`remove\` take the fields with many values (${quoted(many) || "it has none"}); any other field takes its new value in \`data\`.`;
  const both = names.filter((name) => name in data);

  return both.length
    ? `Nothing was written: ${quoted(both)} is in \`data\` and in \`add\`/\`remove\`. Send the whole new list in \`data\`, or the entries to change in \`add\`/\`remove\`, not both.`
    : null;
}

function dataError(
  schema: SchemaContext,
  target: UpdateTarget,
  { data, lists }: { data: Record<string, unknown>; lists: Lists },
  surface: ToolSurface
): string | null {
  const fields = target.global
    ? schema.globals.find((global) => global.slug === target.global)?.fields
    : schema.collections.find((collection) => collection.slug === target.collection)?.fields;
  const control = Object.keys(data).filter((key) => UPDATE_CONTROL_KEYS.has(key));
  // A field may have the name of a parameter of the update call, which cannot tell the two apart.
  const shadowed = control.filter((key) => fields?.some((field) => field.name === key));

  if (shadowed.length)
    return `Nothing was written: ${surface.update} cannot set the field(s) ${quoted(shadowed)}, because each name is also a parameter of the update call. Change ${shadowed.length === 1 ? "this field" : "these fields"} with ${surface.edit}, and send the other fields to ${surface.update} without ${shadowed.length === 1 ? "it" : "them"}.`;
  if (control.length)
    return `\`data\` holds only fields of the document; remove ${quoted(control)} from it. The document id goes in \`id\`${schema.locales?.length ? " and the locale in `locale`" : ""}. The agent does not set the publication state.`;
  if (!Object.keys(data).length && !Object.keys(lists).length)
    return "`data` is empty and there is no `add` or `remove`, so nothing was written. Send at least one field of the document with its new value.";
  const blocks = Object.keys(data).find((key) => containsBlocksArray(data[key]));

  if (blocks) return surface.blocksUpdateRefusal(blocks);
  const richText = fields?.find((field) => field.type === "richText" && field.name in data);

  if (richText) return surface.richTextUpdateRefusal(richText.name);

  if (!fields) return null;
  const slug = target.global ?? target.collection ?? "";

  return unknownFieldsError(slug, fields, data) ?? listError(slug, fields, data, lists);
}

/** The write target and the gate parameters of an update call, or what is wrong with the call. */
export function resolveUpdate(
  schema: SchemaContext,
  targets: UpdateTarget[],
  input: unknown,
  surface: ToolSurface = CHAT_SURFACE
): Resolved {
  const { collection, global, id, data = {}, locale } = input as UpdateInput;
  const found =
    collection && !global
      ? targets.find((target) => target.collection === collection)
      : global && !collection
        ? targets.find((target) => target.global === global)
        : undefined;

  if (!found) return { error: targetError(schema, targets, { collection, global, data }) };
  if (found.collection && (id === undefined || id === ""))
    return {
      error: `Pass the \`id\` of the document in "${found.collection}". Take it from a listDocuments or ${surface.nameSearch} result.`,
    };
  if (found.global && id !== undefined)
    return {
      error: `A global has no \`id\`: call again with \`global: "${found.global}"\` and \`data\` only. Nothing was written.`,
    };
  const edits = listsOf(input as UpdateInput);

  if ("error" in edits) return edits;
  const { lists } = edits;
  const invalid = dataError(schema, found, { data, lists }, surface);

  if (invalid) return { error: invalid };

  return {
    target: {
      name: surface.update,
      mcpTool: found.mcpTool,
      lower: "update",
      writeSlug: found.collection,
      writeGlobalSlug: found.global,
    },
    params: {
      ...data,
      ...(found.collection ? { id } : {}),
      ...(locale ? { locale } : {}),
    },
    data,
    lists,
  };
}

/** The update with each `add`/`remove` turned into the whole new list of the current draft. */
export async function withListEdits(
  {
    io,
    schema,
    surface = CHAT_SURFACE,
  }: { io: DocumentIO; schema: SchemaContext; surface?: ToolSurface },
  resolved: ResolvedUpdate,
  { id, locale }: UpdateInput
): Promise<Resolved> {
  const names = Object.keys(resolved.lists);

  if (!names.length) return resolved;
  const { writeSlug, writeGlobalSlug } = resolved.target;
  const read = { locale, ...ownLocaleValues(schema, locale), callId: "list-edit" };
  const { doc, error } = writeGlobalSlug
    ? await io.read({ global: writeGlobalSlug }, read)
    : await io.read({ collection: writeSlug }, { id, ...read });

  if (error) return { error };
  if (!doc)
    return {
      error: documentNotFoundError(
        `Document ${writeGlobalSlug ?? `${writeSlug}/${id}`}`,
        surface.nameSearch
      ),
    };
  const lists: Record<string, unknown[]> = {};

  for (const name of names) {
    const next = changedList(name, doc[name], resolved.lists[name]);

    if ("error" in next) return next;
    lists[name] = next.value;
  }

  return {
    ...resolved,
    params: { ...resolved.params, ...lists },
    data: { ...resolved.data, ...lists },
    lists: {},
  };
}

const writable = (targets: UpdateTarget[]): string => {
  const collections = targets.flatMap((target) => (target.collection ? [target.collection] : []));
  const globals = targets.flatMap((target) => (target.global ? [target.global] : []));

  return `collections: ${collections.join(", ") || "none"}; globals: ${globals.join(", ") || "none"}`;
};

function textValues(value: unknown, path: string[] = []): { path: string[]; text: string }[] {
  if (typeof value === "string") return value ? [{ path, text: value }] : [];
  if (Array.isArray(value))
    return value.flatMap((item, index) => textValues(item, [...path, String(index)]));
  if (!isRecord(value)) return [];

  return Object.entries(value).flatMap(([key, item]) => textValues(item, [...path, key]));
}

const valueAt = (document: unknown, path: string[]): unknown =>
  path.reduce<unknown>(
    (value, key) =>
      Array.isArray(value) ? value[Number(key)] : isRecord(value) ? value[key] : undefined,
    document
  );

/** The length of each text value an update stored, read from the saved document. */
export function storedLengthsNote(data: unknown, output: unknown): string {
  const failed = isRecord(output) && ("error" in output || output.isError === true);
  const saved = failed ? null : parseMcpDoc(output);

  if (!saved) return "";
  const lengths = textValues(data).map(({ path, text }) => {
    const stored = valueAt(saved, path);

    return `${path.join(".")} ${(typeof stored === "string" ? stored : text).length}`;
  });

  return lengths.length
    ? `\nLength in characters of each text value this update stored: ${lengths.join(", ")}. When the person or the field sets a limit, compare it with this number, not with your own count, and report this number.`
    : "";
}

export function createUpdateDocumentTool(context: WriteGateContext, targets: UpdateTarget[]) {
  const { schema } = context;

  const resolveWrite = async (input: UpdateInput): Promise<Resolved> => {
    const resolved = resolveUpdate(schema, targets, input);

    return "error" in resolved
      ? resolved
      : withListEdits({ io: context.documentIo(), schema }, resolved, input);
  };

  context.approvals?.policies.set(UPDATE_DOCUMENT_TOOL, async (input, toolCallId) => {
    if (!isRecord(input) || input.preview === true) return undefined;
    const resolved = await resolveWrite(input as UpdateInput);

    return "error" in resolved
      ? undefined
      : destructiveUpdateApproval(context, resolved.target)(resolved.params, toolCallId);
  });

  return tool({
    description: `Set fields of ONE existing document or global, saved as a draft. Every field you send replaces the stored value; a field you omit stays as it is, so send only the fields that change. The field names, types and options are in the schema overview. An array field is replaced whole: send its complete new value. A field with many values (hasMany) in \`data\` is replaced whole too; to put entries into its list or take some out, leave it out of \`data\` and name only those entries in \`add\` or \`remove\`: every other entry stays, so you never write the entries it holds again. Rich text and blocks fields are not written here: use editContent for them. It writes the collections and globals the site gives a direct update for (${writable(targets)}); change any other one with editContent. An update that removes or empties what the document holds runs only after the person confirms it in the chat. A request changes ${BULK_CONFIRM_THRESHOLD} documents without the person, whatever tool writes them; for every further document the chat asks the person. For one change in many documents call editContent or findReplaceContent with the ids of all of them: the chat then asks one time. With \`preview: true\` nothing is written: the call reads the current draft, diffs it against the fields in \`data\` and the lists that \`add\` and \`remove\` give, and returns { fieldsChanged, diff, warnings, safe }. After a write the answer is the saved document, and after it one line with the length in characters of each text value the update stored. Use it to check a change to existing content when you are not sure what it removes. A preview confirms nothing: the destructive update itself still waits for the person.`,
    inputSchema: z.object({
      collection: z.string().optional().describe("Collection slug. Pass it with `id`."),
      global: z.string().optional().describe("Global slug, in place of `collection` and `id`."),
      id: z.union([z.string(), z.number()]).optional().describe("The document id."),
      data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "The fields to set, by the field names of the schema. Leave it out when `add` and `remove` carry the whole change."
        ),
      add: listAddInput,
      remove: z
        .record(z.string(), z.array(z.unknown()))
        .optional()
        .describe(
          "Fields with many values (hasMany) only: { <field name>: [<entries>] }, the entries to take out of each list. Each one must be in the list; every other entry stays where it is."
        ),
      locale: z
        .string()
        .optional()
        .describe("Locale of localized fields. Omit for the default locale."),
      preview: z
        .boolean()
        .optional()
        .describe(
          "true = write nothing and return what this exact call would change. Pass the SAME input you plan to send."
        ),
    }),
    execute: async (input: UpdateInput, options: McpCallOptions) => {
      const resolved = await resolveWrite(input);

      if ("error" in resolved) return { error: resolved.error };
      if (input.preview)
        return previewUpdate(
          { io: context.documentIo(), schema },
          { ...input, data: resolved.data }
        );

      return capMcpToolOutput(
        await gatedMcpWrite(context, resolved.target, resolved.params, options)
      );
    },
    toModelOutput: ({ input, output }: { input?: UpdateInput; output: unknown }) => ({
      type: "text" as const,
      value: isUpdatePreview(output)
        ? JSON.stringify(output)
        : summarizeMcpOutput(UPDATE_DOCUMENT_TOOL, output) + storedLengthsNote(input?.data, output),
    }),
  });
}
