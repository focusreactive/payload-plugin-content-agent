import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { turnContextSchema } from "../../../borders.js";
import type { DocTarget } from "../documentIo.js";
import type { ApprovalPolicy } from "../../approvals.js";
import { translateLocaleError, buildTranslateInstruction } from "../editorPrompts.js";
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
import { WHERE_FORMAT } from "../whereClause.js";
import type { SchemaContext } from "../../../types.js";
import { BULK_CONFIRM_THRESHOLD } from "../bulk.js";

const translateContentInputSchema = z.object({
  collection: z
    .string()
    .optional()
    .describe("Collection slug (with `id`, `ids` or `where`). Omit when translating a global."),
  global: z.string().optional().describe("Global slug. Provide EITHER `global` OR `collection`."),
  id: z.union([z.string(), z.number()]).optional().describe("Document id, for ONE document."),
  ids: z
    .array(z.union([z.string(), z.number()]))
    .optional()
    .describe(
      "Document ids, for MANY documents (must already exist), or the `remaining` ids of a previous call."
    ),
  where: z
    .string()
    .optional()
    .describe(
      `INSTEAD of ids, for MANY documents: a Payload where clause as a JSON string selecting them. ${WHERE_FORMAT} Every document: '{}'. The tool pages through the collection itself, so the count is exact.`
    ),
  to: z
    .string()
    .optional()
    .describe(
      "Target locale code to translate INTO. Required, except with `continue: true`, which takes it from the run it continues."
    ),
  from: z
    .string()
    .optional()
    .describe("Source locale code to translate FROM. Omit for the default locale."),
  instruction: z
    .string()
    .optional()
    .describe(
      "Optional extra guidance (tone, terminology to keep, etc.), applied to every document."
    ),
  continue: z
    .boolean()
    .optional()
    .describe(
      "Resume the previous many-document translation in this conversation that stopped for time: the remaining documents, locales and guidance are kept server-side. Pass collection + continue: true."
    ),
});

type TranslateContentInput = z.infer<typeof translateContentInputSchema>;

/** What to translate after `continue` is resolved: the stored run replaces the arguments. */
interface TranslateRequest {
  givenIds: (string | number)[] | undefined;
  where: string | undefined;
  to: string;
  from: string | undefined;
  instruction: string | undefined;
}

/** The request with its locales checked and the editor instruction built. */
interface TranslateJob extends TranslateRequest {
  src: string | undefined;
  editInstruction: string;
}

async function resumedRequest(
  deps: ContentEditorDeps,
  collection: string | undefined,
  given: TranslateRequest
): Promise<{ error: string } | { request: TranslateRequest }> {
  const stored = await storedRun(
    deps,
    "translateContent",
    collection,
    `Nothing to continue for "${collection}" in this conversation - select the documents again with \`where\`.`
  );

  if ("error" in stored) return stored;
  const { ids, to, from, instruction } = stored.pending;

  return {
    request: {
      givenIds: ids,
      to: to ?? given.to,
      from,
      instruction: instruction || undefined,
      where: undefined,
    },
  };
}

function invalidRequest(
  deps: ContentEditorDeps,
  input: TranslateContentInput,
  request: TranslateRequest
) {
  const { givenIds, where, to, from } = request;

  if (!to) return refusedResult(input, "A target locale `to` is required.");
  const bad =
    targetError(input, givenIds, where) ??
    translateLocaleError(deps.schema, from ?? deps.schema.defaultLocale, to);

  return bad ? refusedResult(input, bad) : null;
}

async function translateOne(
  deps: ContentEditorDeps,
  input: TranslateContentInput,
  { src, to, editInstruction }: TranslateJob,
  { context: turnContext, abortSignal, toolCallId }: ToolCallOptions
) {
  const { collection, global, id } = input;
  const target: DocTarget = global ? { global } : { collection };
  const shownId = global ?? id!;
  // Counted per target locale: one document into two locales is two tasks.
  const capped = sessionCap(
    turnContext,
    `${collection ?? `global:${global}`}#${shownId}@${to}`,
    "translateContent"
  );

  if (capped) return { id: shownId, status: "error" as const, error: capped };
  const opId = randomUUID();
  const progress = {
    op: "translateContent",
    phase: "processing",
    collection: collection ?? `global:${global}`,
    id: shownId,
    task: `→ ${to}`,
  };

  emitProgress(turnContext, progress, opId);
  const result = await runContentEditor({
    deps,
    target,
    id,
    instruction: editInstruction,
    signal: abortSignal,
    locale: src,
    writeLocale: to,
    parentToolCallId: toolCallId,
    onStep: (info) => emitProgress(turnContext, { ...progress, ...info }, opId),
  });

  emitProgress(turnContext, doneEvent(progress, result), opId);

  return result;
}

function translateMany(
  deps: ContentEditorDeps,
  plan: ManyPlan<TranslateJob>,
  options: ToolCallOptions
) {
  const { to, from, instruction, src, editInstruction } = plan.request;

  return runMany(
    deps,
    plan,
    {
      tool: "translateContent",
      op: "bulkTranslateContent",
      editor: { instruction: editInstruction, locale: src, writeLocale: to },
      stored: { instruction: instruction ?? "", to, from },
      shown: { to },
    },
    options
  );
}

async function planTranslation(
  deps: ContentEditorDeps,
  input: TranslateContentInput,
  toolCallId: string | undefined,
  signal?: AbortSignal
): Promise<Plan<TranslateJob>> {
  let request: TranslateRequest = {
    givenIds: input.ids,
    where: input.where,
    to: input.to ?? "",
    from: input.from,
    instruction: input.instruction,
  };

  if (input.continue) {
    const resumed = await resumedRequest(deps, input.collection, request);

    if ("error" in resumed) return { kind: "refused", result: { error: resumed.error } };
    ({ request } = resumed);
  }

  const invalid = invalidRequest(deps, input, request);

  if (invalid) return { kind: "refused", result: invalid };
  const src = request.from ?? deps.schema.defaultLocale;
  const editInstruction = buildTranslateInstruction(
    src,
    request.to,
    request.instruction,
    deps.agentInstructions
  );

  return planScope(deps, {
    tool: "translateContent",
    target: input,
    request: { ...request, src, editInstruction },
    locale: src,
    toolCallId,
    signal,
  });
}

async function translateContent(
  deps: ContentEditorDeps,
  input: TranslateContentInput,
  options: ToolCallOptions
) {
  const plan = await planTranslation(deps, input, options.toolCallId, options.abortSignal);

  return runPlan(
    deps,
    { target: input, plan, toolCallId: options.toolCallId },
    {
      one: (job) => translateOne(deps, input, job, options),
      many: (many) => translateMany(deps, many, options),
    }
  );
}

export const translateContentApproval = (deps: ContentEditorDeps): ApprovalPolicy =>
  manyApproval(deps, {
    tool: "translateContent",
    plan: (input, toolCallId, signal) =>
      planTranslation(deps, translateContentInputSchema.parse(input), toolCallId, signal),
    locale: (job) => job.src,
    request: ({ collection, ids, request: { src, to } }, documents) => ({
      kind: "translate",
      collection,
      count: ids.length,
      documents,
      from: src,
      to,
    }),
  });

/** `to` and `from` take the locale codes of the schema only. */
function localeInput(schema: SchemaContext) {
  const [first, ...rest] = schema.locales ?? [];

  if (!first) return translateContentInputSchema;
  const codes = z.enum([first, ...rest]).optional();
  const values = `One of: ${[first, ...rest].join(", ")}.`;
  const { to, from } = translateContentInputSchema.shape;

  return translateContentInputSchema.extend({
    to: codes.describe(`${to.description} ${values}`),
    from: codes.describe(
      `${from.description} ${values}${schema.defaultLocale ? ` The default locale is ${schema.defaultLocale}.` : ""}`
    ),
  });
}

export function createTranslateContentTool(deps: ContentEditorDeps) {
  return tool({
    description: `Translate the localized content of existing documents (or of a GLOBAL) into another locale. Reads the source locale, translates every localized text field (rich text losslessly), and saves to the target locale - the source locale and all non-localized/shared fields are left untouched. ONE document: collection+id, or a global by slug. MANY: collection + \`ids\` or \`where\` - each translated and reviewed independently; for more than ${BULK_CONFIRM_THRESHOLD} documents the chat asks the person to confirm the run before it starts. The locales of the site are the values of \`to\` and \`from\`.`,
    contextSchema: turnContextSchema,
    inputSchema: localeInput(deps.schema),
    execute: (input, options) => translateContent(deps, input, options),
    toModelOutput: ({ output }) => {
      const fields = outputFields(output);

      return {
        type: "text" as const,
        value:
          fields.total !== undefined
            ? bulkResult("translateContent", fields)
            : singleResult("translateContent", fields),
      };
    },
  });
}
