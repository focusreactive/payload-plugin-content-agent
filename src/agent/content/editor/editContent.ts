import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { turnContextSchema } from "../../../borders.js";
import type { DocTarget } from "../documentIo.js";
import { validateLocaleArg } from "../discovery.js";
import { unknownTargetError } from "../../toolErrors.js";
import type { SchemaContext } from "../../../types.js";
import { WHERE_FORMAT } from "../whereClause.js";
import type { ApprovalPolicy } from "../../approvals.js";
import type { ContentEditorDeps } from "../editorDeps.js";
import { runContentEditor } from "./session.js";
import {
  bulkResult,
  doneEvent,
  emitProgress,
  outputFields,
  sessionCap,
  singleResult,
  targetError,
} from "./shared.js";
import { manyApproval, planScope, refusedResult, runMany, runPlan, storedRun } from "./toolRun.js";
import type { ManyPlan, Plan, ToolCallOptions } from "./toolRun.js";
import { BULK_CONFIRM_THRESHOLD } from "../bulk.js";

const editContentInputSchema = z.object({
  collection: z
    .string()
    .optional()
    .describe("Collection slug (with `id`, `ids` or `where`). Omit when editing a global."),
  global: z
    .string()
    .optional()
    .describe(
      "Global slug. Globals are singletons - no id. Provide EITHER `global` OR `collection`."
    ),
  id: z.union([z.string(), z.number()]).optional().describe("Document id, for ONE document."),
  ids: z
    .array(z.union([z.string(), z.number()]))
    .optional()
    .describe(
      "Document ids, for MANY documents (must already exist). Also used to CONTINUE with the `remaining` ids a previous call returned."
    ),
  where: z
    .string()
    .optional()
    .describe(
      `INSTEAD of ids, for MANY documents: a Payload where clause as a JSON string selecting them. ${WHERE_FORMAT} Every document: '{}'. The tool pages through the collection itself, so the count is exact - always prefer this over collecting ids by hand for "every"/"all" tasks.`
    ),
  instruction: z
    .string()
    .optional()
    .describe(
      "What to do with the content. Be specific. Applied to every document when there are several. The language of the person's message is not the language of the content: the content keeps the language it is written in, so name a language in the instruction only when the person asks for a translation. Required unless `continue` is set."
    ),
  modelDocument: z
    .string()
    .optional()
    .describe(
      "Set it ONLY when the task says the document must follow an existing one as its model (the same structure, layout or sections): the id, slug, title or URL of that document, as the task gives it. A document that has no sections yet is then refused with the way to copy the model first."
    ),
  locale: z
    .string()
    .optional()
    .describe(
      "Locale code when editing/translating a localized field in a specific language. Omit for the default locale."
    ),
  continue: z
    .boolean()
    .optional()
    .describe(
      "Resume the previous many-document run of this tool in this conversation that stopped for time: the remaining documents and the instruction are kept server-side. Pass collection + continue: true, nothing else."
    ),
});

type EditContentInput = z.infer<typeof editContentInputSchema>;

/** What to edit after `continue` is resolved: the stored run replaces the arguments. */
interface EditRequest {
  givenIds: (string | number)[] | undefined;
  where: string | undefined;
  instruction: string;
  locale: string | undefined;
  modelDocument?: string;
}

async function resumedRequest(
  deps: ContentEditorDeps,
  collection: string | undefined
): Promise<{ error: string } | { request: EditRequest }> {
  const stored = await storedRun(
    deps,
    "editContent",
    collection,
    `Nothing to continue for "${collection}" in this conversation - the previous run finished, was never started, or the server restarted. Select the documents again with \`where\` (the tool skips nothing on its own, so name what must still be missing in the instruction).`
  );

  if ("error" in stored) return stored;
  const { ids, instruction, locale, modelDocument } = stored.pending;

  return { request: { givenIds: ids, instruction, locale, modelDocument, where: undefined } };
}

function unknownTarget(schema: SchemaContext, { collection, global }: EditContentInput) {
  const known = global
    ? schema.globals.some((entry) => entry.slug === global)
    : !collection || schema.collections.some((entry) => entry.slug === collection);

  return known ? null : unknownTargetError(schema, { collection, global });
}

function invalidRequest(deps: ContentEditorDeps, input: EditContentInput, request: EditRequest) {
  const { givenIds, where, instruction, locale } = request;

  if (!instruction.trim()) return refusedResult(input, "An `instruction` is required.");
  const bad =
    targetError(input, givenIds, where) ??
    unknownTarget(deps.schema, input) ??
    validateLocaleArg(deps.schema, locale);

  return bad ? refusedResult(input, bad) : null;
}

async function editOne(
  deps: ContentEditorDeps,
  input: EditContentInput,
  { instruction, locale, modelDocument }: EditRequest,
  { context: turnContext, abortSignal, toolCallId }: ToolCallOptions
) {
  const { collection, global, id } = input;
  const target: DocTarget = global ? { global } : { collection };
  const shownId = global ?? id!;
  const capped = sessionCap(turnContext, `${collection ?? `global:${global}`}#${shownId}`);

  if (capped) return { id: shownId, status: "error" as const, error: capped };
  const opId = randomUUID();
  const progress = {
    op: "editContent",
    phase: "processing",
    collection: collection ?? `global:${global}`,
    id: shownId,
    task: instruction.slice(0, 80),
  };

  emitProgress(turnContext, progress, opId);
  const result = await runContentEditor({
    deps,
    target,
    id,
    instruction,
    modelDocument,
    canAsk: true,
    signal: abortSignal,
    locale,
    parentToolCallId: toolCallId,
    onStep: (info) => emitProgress(turnContext, { ...progress, ...info }, opId),
  });

  emitProgress(turnContext, doneEvent(progress, result), opId);

  return result;
}

function editMany(deps: ContentEditorDeps, plan: ManyPlan<EditRequest>, options: ToolCallOptions) {
  const { instruction, locale, modelDocument } = plan.request;
  const editor = { instruction, locale, modelDocument };

  return runMany(
    deps,
    plan,
    { tool: "editContent", op: "bulkEditContent", editor, stored: editor },
    options
  );
}

async function planEdit(
  deps: ContentEditorDeps,
  input: EditContentInput,
  toolCallId: string | undefined,
  signal?: AbortSignal
): Promise<Plan<EditRequest>> {
  let request: EditRequest = {
    givenIds: input.ids,
    where: input.where,
    instruction: input.instruction ?? "",
    locale: input.locale,
    modelDocument: input.modelDocument,
  };

  if (input.continue) {
    const resumed = await resumedRequest(deps, input.collection);

    if ("error" in resumed) return { kind: "refused", result: { error: resumed.error } };
    ({ request } = resumed);
  }

  const invalid = invalidRequest(deps, input, request);

  if (invalid) return { kind: "refused", result: invalid };

  return planScope(deps, {
    tool: "editContent",
    target: input,
    request,
    locale: request.locale,
    toolCallId,
    signal,
  });
}

async function editContent(
  deps: ContentEditorDeps,
  input: EditContentInput,
  options: ToolCallOptions
) {
  const plan = await planEdit(deps, input, options.toolCallId, options.abortSignal);

  return runPlan(
    deps,
    { target: input, plan, toolCallId: options.toolCallId },
    {
      one: (request) => editOne(deps, input, request, options),
      many: (many) => editMany(deps, many, options),
    }
  );
}

const SHOWN_INSTRUCTION_LENGTH = 300;

export const editContentApproval = (deps: ContentEditorDeps): ApprovalPolicy =>
  manyApproval(deps, {
    tool: "editContent",
    plan: (input, toolCallId, signal) =>
      planEdit(deps, editContentInputSchema.parse(input), toolCallId, signal),
    locale: (request) => request.locale,
    request: ({ collection, ids, request: { instruction } }, documents) => ({
      kind: "edit",
      collection,
      count: ids.length,
      documents,
      instruction:
        instruction.length > SHOWN_INSTRUCTION_LENGTH
          ? `${instruction.slice(0, SHOWN_INSTRUCTION_LENGTH)}...`
          : instruction,
    }),
  });

export function createEditContentTool(deps: ContentEditorDeps) {
  return tool({
    description: `Edit the content of existing documents of any collection, OR of a GLOBAL - compose/reorder/fill sections (blocks), set fields, edit or translate rich text, audit. Works for any schema. ONE document: collection+id (create it first if it does not exist), or a global by slug. MANY documents with the same instruction: collection + \`ids\` (a hand-picked set, or the \`remaining\` ids of a previous call) or \`where\` (a selection the tool pages itself) - each is edited and reviewed independently; for more than ${BULK_CONFIRM_THRESHOLD} documents the chat asks the person to confirm the run before it starts. Changes are saved as drafts. The editor reads the document itself: read it before this call only when you must choose between several candidates or take content from another document. To replace one exact string by another, in one document or in many, use findReplaceContent and not this tool: it runs without a model and changes nothing else.`,
    contextSchema: turnContextSchema,
    inputSchema: editContentInputSchema,
    execute: (input, options) => editContent(deps, input, options),
    toModelOutput: ({ output }) => {
      const fields = outputFields(output);

      return {
        type: "text" as const,
        value:
          fields.total !== undefined
            ? bulkResult("editContent", fields)
            : singleResult("editContent", fields),
      };
    },
  });
}
