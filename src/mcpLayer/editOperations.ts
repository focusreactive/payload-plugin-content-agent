import { z } from "zod";
import type { ToolExecutionOptions } from "ai";
import type { SanitizedConfig } from "payload";
import type { SchemaContext, SchemaField } from "../types.js";
import { createBlockTools } from "../agent/content/blockTools.js";
import type { DocumentWorkspace } from "../agent/content/blockTools.js";
import { createRichTextTools } from "../agent/content/richtextTools.js";
import {
  TEXT_TYPES,
  getByPath,
  parsePath,
  resolveFieldAtPath,
  setByPath,
} from "../agent/content/discovery.js";
import { isEmptyRichText } from "../agent/content/lexicalEngine.js";
import {
  notWrittenError,
  resolveRichText,
  topLevelNodes,
} from "../agent/content/richtext/context.js";
import { extractText, replaceTextInLexical } from "../agent/subAgents/programmaticOps.js";
import type { SurgicalEdit } from "../agent/subAgents/lexicalMarkdown.js";
import { isRecord } from "../borders.js";
import type { EditAdvice } from "../agent/content/editAdvice.js";

const LAYER_ADVICE: EditAdvice = {
  shorterField:
    "No operation of this tool cuts a text this much. A person shortens it in the admin panel of the site.",
  onePhrase: "use the operation replaceText with the exact string to change.",
  shorterPart:
    "No operation of this tool cuts a part this much. A person shortens it in the admin panel of the site.",
  removedLinks: "Keep these links in `markdown`, each as [words](address).",
  existingItem:
    'Change that item with set, replaceText or replacePart on "<path>[<itemId>].<field>" instead of adding a second one. If a second item with this title is wanted, send the operation again with sameTitle: true.',
  richTextField:
    "send its text as a Markdown string. Inside a nested row, insert the item first and add the text with insertText in the next call.",
};

const OPERATIONS = {
  set: z.object({
    type: z.literal("set"),
    ref: z.string().min(1),
    value: z.unknown().optional(),
    add: z.array(z.unknown()).optional(),
  }),
  insertItem: z.object({
    type: z.literal("insertItem"),
    path: z.string().min(1),
    blockType: z.string().optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    afterId: z.string().optional(),
    index: z.number().int().min(0).optional(),
    sameTitle: z.boolean().optional(),
  }),
  moveItem: z.object({
    type: z.literal("moveItem"),
    path: z.string().min(1),
    id: z.string().min(1),
    toIndex: z.number().int().min(0),
  }),
  replaceText: z.object({
    type: z.literal("replaceText"),
    ref: z.string().min(1),
    find: z.string().min(1),
    replace: z.string(),
    all: z.boolean().optional(),
  }),
  insertText: z.object({
    type: z.literal("insertText"),
    ref: z.string().min(1),
    markdown: z.string().min(1),
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
    at: z.enum(["start", "end"]).optional(),
  }),
  replacePart: z.object({
    type: z.literal("replacePart"),
    ref: z.string().min(1),
    match: z.string().min(1),
    markdown: z.string().min(1),
  }),
};

type OperationType = keyof typeof OPERATIONS;
type Operation<Type extends OperationType> = z.infer<(typeof OPERATIONS)[Type]>;

export const OPERATION_TYPES = Object.keys(OPERATIONS) as OperationType[];

export interface OperationRun {
  workspace: DocumentWorkspace;
  schema: SchemaContext;
  fields: SchemaField[];
  config?: SanitizedConfig;
}

interface Tools {
  blocks: ReturnType<typeof createBlockTools>;
  rich: ReturnType<typeof createRichTextTools>;
}

type Outcome = string | null;

const CALL: ToolExecutionOptions<Record<string, unknown>> = {
  toolCallId: "mcp-layer-edit",
  messages: [],
  context: {},
};

const READ_OUTLINE =
  'Take it from readDocument with view "outline": "<field>", "<group>.<field>" or "<blocksField>[<itemId>].<field>".';
const READ_TEXT =
  'Read the field with readDocument (view "text") and copy a fragment of one paragraph as plain text, without Markdown marks.';

function errorOf(result: unknown): Outcome {
  if (!isRecord(result)) return "the operation returned no result";
  if (typeof result.error === "string") return result.error;
  const first: unknown = Array.isArray(result.errors) ? result.errors[0] : undefined;

  if (isRecord(first) && typeof first.error === "string") return first.error;

  return result.ok === false ? String(result.message ?? "the operation did not apply") : null;
}

const fieldAt = ({ fields, workspace }: OperationRun, ref: string): SchemaField | null =>
  resolveFieldAtPath(fields, workspace.ref.current, parsePath(ref))?.field ?? null;

function containerError(run: OperationRun, path: string): Outcome {
  const type = fieldAt(run, path)?.type;

  if (type === "blocks" || type === "array") return null;

  return type
    ? `"${path}" is a ${type} field. Items are inserted and moved only in an array or a blocks field.`
    : `"${path}" is not a field of this document. ${READ_OUTLINE}`;
}

async function applySet(run: OperationRun, tools: Tools, { ref, value, add }: Operation<"set">) {
  const type = fieldAt(run, ref)?.type;

  if (!type) return `"${ref}" is not a field of this document. ${READ_OUTLINE}`;
  if ((value === undefined) === (add === undefined))
    return `Send either \`value\` with the new value of "${ref}", or \`add\` with the entries to put into its list when the field has hasMany.`;
  if (type === "richText")
    return `"${ref}" is a rich text field. Change it with the operations replaceText, insertText or replacePart.`;
  if (type === "array" || type === "blocks")
    return `"${ref}" holds items. Add one with insertItem, reorder with moveItem, and set a field of one item with the ref "${ref}[<itemId>].<field>".`;
  if (type === "group") return `"${ref}" is a group. Set its fields one by one: "${ref}.<field>".`;

  const edit = add === undefined ? { ref, value } : { ref, add };

  return errorOf(await tools.blocks.setValues.execute!({ edits: [edit] }, CALL));
}

function itemFields(run: OperationRun, { path, blockType }: Operation<"insertItem">) {
  const field = fieldAt(run, path);

  return (
    (field?.type === "blocks"
      ? field.blocks?.find((block) => block.slug === blockType)?.fields
      : field?.fields) ?? []
  );
}

async function surgical(tools: Tools, ref: string, edit: SurgicalEdit): Promise<Outcome> {
  return errorOf(
    await tools.rich.applyRichText.execute!({ ref, mode: "surgical", edits: [edit] }, CALL)
  );
}

async function applyInsertItem(
  run: OperationRun,
  tools: Tools,
  operation: Operation<"insertItem">
) {
  const refused = containerError(run, operation.path);

  if (refused) return refused;
  const richNames = new Set(
    itemFields(run, operation)
      .filter((field) => field.type === "richText")
      .map((field) => field.name)
  );
  const entries = Object.entries(operation.fields ?? {});
  const markdown = entries.filter(
    ([name, value]) => richNames.has(name) && typeof value === "string"
  );
  const { type: _type, ...input } = operation;
  const inserted: unknown = await tools.blocks.insertItem.execute!(
    { ...input, fields: Object.fromEntries(entries.filter((entry) => !markdown.includes(entry))) },
    CALL
  );
  const failed = errorOf(inserted);

  if (failed)
    return failed.includes("Lexical value")
      ? `${failed} Rich text is Markdown text in \`fields\` only at the top level of the new item. For rich text inside a nested row, insert the item first and add the text with insertText in the next call.`
      : failed;
  const id = isRecord(inserted) ? String(inserted.id) : "";

  for (const [name, value] of markdown) {
    const written = await surgical(tools, `${operation.path}[${id}].${name}`, {
      key: "0",
      action: "replace",
      markdown: String(value),
      expectedType: "paragraph",
    });

    if (written) return `the rich text of "${name}": ${written}`;
  }

  return null;
}

async function applyMoveItem(run: OperationRun, tools: Tools, operation: Operation<"moveItem">) {
  const { type: _type, ...input } = operation;

  return (
    containerError(run, operation.path) ??
    errorOf(await tools.blocks.moveItem.execute!(input, CALL))
  );
}

function countError(
  ref: string,
  { find, count, all, plain }: { find: string; count: number; all?: boolean; plain: boolean }
): Outcome {
  if (count === 0)
    return plain
      ? `"${ref}" does not hold ${JSON.stringify(find)}. The match is literal and case-sensitive. ${READ_TEXT} Or write the whole field with the operation set.`
      : `"${ref}" does not hold ${JSON.stringify(find)} inside one run of the same formatting. The match is literal and case-sensitive, and it does not cross bold, italic or a link: for such a string use replacePart. ${READ_TEXT}`;

  return count > 1 && !all
    ? `${JSON.stringify(find)} occurs ${count} times in "${ref}". Send a longer string that occurs once, or pass all: true to replace every occurrence.`
    : null;
}

function richTextError(run: OperationRun, ref: string, operation: string): Outcome {
  const type = fieldAt(run, ref)?.type;

  if (type === "richText") {
    const resolved = resolveRichText({ ...run, transformCoverage: new Map() }, ref);

    return "error" in resolved ? resolved.error : null;
  }

  return type
    ? `"${ref}" is a ${type} field, and ${operation} works on ${operation === "replaceText" ? "text and rich text fields" : "rich text fields"}. Write this field with the operation set.`
    : `"${ref}" is not a field of this document. ${READ_OUTLINE}`;
}

async function applyReplaceText(
  run: OperationRun,
  tools: Tools,
  { ref, find, replace, all }: Operation<"replaceText">
) {
  const type = fieldAt(run, ref)?.type;
  const path = parsePath(ref);
  const current: unknown = getByPath(run.workspace.ref.current, path);

  if (type && TEXT_TYPES.has(type)) {
    const text = typeof current === "string" ? current : "";
    const parts = text.split(find);

    return (
      countError(ref, { find, count: parts.length - 1, all, plain: true }) ??
      errorOf(
        await tools.blocks.setValues.execute!(
          { edits: [{ ref, value: parts.join(replace) }] },
          CALL
        )
      )
    );
  }

  const refused = richTextError(run, ref, "replaceText");

  if (refused) return refused;
  const { content, count } = replaceTextInLexical(structuredClone(current), find, replace);
  const miscount = countError(ref, { find, count, all, plain: false });

  if (miscount) return miscount;

  return setByPath(run.workspace.ref.current, path, content) ? null : notWrittenError(ref);
}

function partIndex(run: OperationRun, ref: string, snippet: string): number | string {
  const nodes = topLevelNodes(getByPath(run.workspace.ref.current, parsePath(ref)));
  const hits = nodes.flatMap((node, index) => (extractText(node).includes(snippet) ? [index] : []));

  if (hits.length === 1) return hits[0];

  return hits.length
    ? `${JSON.stringify(snippet)} is in ${hits.length} parts of "${ref}". Send a longer fragment that only one part holds.`
    : `No part of "${ref}" holds ${JSON.stringify(snippet)}. ${READ_TEXT}`;
}

function insertEdit(
  run: OperationRun,
  { ref, markdown, after, before, at }: Operation<"insertText">
): SurgicalEdit | string {
  if ([after, before, at].filter((place) => place !== undefined).length > 1)
    return "Pass one of `after`, `before` or `at`, not several. Without any of them the text goes to the end.";
  const content: unknown = getByPath(run.workspace.ref.current, parsePath(ref));

  if (isEmptyRichText(content))
    return { key: "0", action: "replace", markdown, expectedType: "paragraph" };
  const anchor = after ?? before;

  if (anchor !== undefined) {
    const index = partIndex(run, ref, anchor);

    return typeof index === "string"
      ? index
      : {
          key: String(index),
          action: after === undefined ? "insertBefore" : "insertAfter",
          markdown,
          expectedText: anchor,
        };
  }

  return at === "start"
    ? { key: "0", action: "insertBefore", markdown }
    : { key: String(topLevelNodes(content).length - 1), action: "insertAfter", markdown };
}

async function applyInsertText(
  run: OperationRun,
  tools: Tools,
  operation: Operation<"insertText">
) {
  const refused = richTextError(run, operation.ref, "insertText");

  if (refused) return refused;
  const edit = insertEdit(run, operation);

  return typeof edit === "string" ? edit : surgical(tools, operation.ref, edit);
}

async function applyReplacePart(
  run: OperationRun,
  tools: Tools,
  { ref, match, markdown }: Operation<"replacePart">
) {
  const refused = richTextError(run, ref, "replacePart");

  if (refused) return refused;
  const index = partIndex(run, ref, match);

  return typeof index === "string"
    ? index
    : surgical(tools, ref, {
        key: String(index),
        action: "replace",
        markdown,
        expectedText: match,
      });
}

const APPLY: {
  [Type in OperationType]: (
    run: OperationRun,
    tools: Tools,
    operation: Operation<Type>
  ) => Promise<Outcome>;
} = {
  set: applySet,
  insertItem: applyInsertItem,
  moveItem: applyMoveItem,
  replaceText: applyReplaceText,
  insertText: applyInsertText,
  replacePart: applyReplacePart,
};

const isOperationType = (type: unknown): type is OperationType =>
  typeof type === "string" && type in OPERATIONS;

async function applyOne(run: OperationRun, tools: Tools, raw: Record<string, unknown>) {
  if (!isOperationType(raw.type))
    return `unknown type ${JSON.stringify(raw.type)}. The types: ${OPERATION_TYPES.join(", ")}.`;
  const parsed = OPERATIONS[raw.type].safeParse(raw);

  if (!parsed.success)
    return `wrong input: ${parsed.error.issues.map((issue) => `\`${issue.path.join(".")}\` ${issue.message}`).join("; ")}. The input of each type is in the description of editDocument.`;
  const apply = APPLY[raw.type] as (
    run: OperationRun,
    tools: Tools,
    operation: unknown
  ) => Promise<Outcome>;

  try {
    return await apply(run, tools, parsed.data);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Applies the operations in order to the open document. Returns the first failure, or null. */
export async function applyOperations(
  run: OperationRun,
  operations: Array<Record<string, unknown>>
): Promise<string | null> {
  const tools: Tools = {
    blocks: createBlockTools(run.workspace, run.schema, { advice: LAYER_ADVICE }),
    rich: createRichTextTools(run.workspace, run.schema, {
      config: run.config,
      guards: { advice: LAYER_ADVICE },
    }),
  };

  for (const [index, operation] of operations.entries()) {
    const failed = await applyOne(run, tools, operation);

    if (failed)
      return `Nothing was written. Operation ${index + 1} of ${operations.length}${isOperationType(operation.type) ? ` (${operation.type})` : ""} did not apply: ${failed}`;
  }

  return null;
}
