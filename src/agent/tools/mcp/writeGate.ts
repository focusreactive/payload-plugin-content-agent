import {
  CLONE_CREATE_WRITE_ID,
  COPY_BLOCK_WRITE_ID,
  CREATE_DOCUMENT_WRITE_ID,
  FIND_REPLACE_SAVE_ID,
  IMPORT_ARTICLE_WRITE_ID,
  WORKSPACE_SAVE_ID,
} from "../writeIds.js";
import { isDocId, isRecord } from "../../../borders.js";
import type { McpCallOptions, McpTool, PayloadDoc } from "../../../borders.js";
import type { EditRecordRef, SchemaContext } from "../../../types.js";
import type { DocumentIO } from "../../content/documentIo.js";
import { fitNulls } from "../../mcpNulls.js";
import { riskyUpdateReason } from "../../content/approvalDocuments.js";
import { hasNoDrafts } from "../../content/draftsOnly.js";
import { localeStateBeforeWrite, ownLocaleValues } from "../../content/localeState.js";
import { healEmptyRichTextDeep } from "../../content/schemaValues.js";
import { executeMcpWrite, mcpDocResult, mcpWriteError, parseMcpDoc } from "../../mcpParse.js";
import { assessUpdateRisk } from "../review.js";
import type { RiskFinding } from "../review.js";
import type { WriteStatus } from "../../writeStatus.js";
import { UPDATE_CONTROL_KEYS } from "./controlKeys.js";
import { askPerson, personApproved } from "../../approvals.js";
import type { ApprovalPolicy, TurnApprovals } from "../../approvals.js";
import { dropsWriteParam, runMcpTool } from "./shared.js";
import { consentRefusal } from "./writeConsent.js";
import { CHAT_SURFACE } from "../../toolSurface.js";
import type { ToolSurface } from "../../toolSurface.js";

// Internal saves record their own before/after and are already reviewed:
// the wrapper must not record or gate them.
const GATE_WRITE_ID = "gate-write";
const INTERNAL_WRITE_IDS = new Set([
  WORKSPACE_SAVE_ID,
  FIND_REPLACE_SAVE_ID,
  COPY_BLOCK_WRITE_ID,
  GATE_WRITE_ID,
]);
const RECORDED_BY_CALLER_IDS = new Set([
  CREATE_DOCUMENT_WRITE_ID,
  CLONE_CREATE_WRITE_ID,
  IMPORT_ARTICLE_WRITE_ID,
]);

function mcpWriteSummary(
  toolName: string,
  verb: string,
  params: Record<string, unknown>
): string | undefined {
  const sent = Object.keys(params ?? {}).filter((key) => !UPDATE_CONTROL_KEYS.has(key));

  if (!sent.length) return undefined;
  const what =
    sent.length > 8
      ? `${sent.slice(0, 8).join(", ")} and ${sent.length - 8} more`
      : sent.join(", ");

  return `${verb === "create" ? "Created with" : "Set"} ${what} via ${toolName}`;
}

export interface WriteGateContext {
  schema: SchemaContext;
  documentIo: () => DocumentIO;
  recordEdits: (refs: EditRecordRef[]) => void;
  /** The person's clicks of this request. Without it a destructive update is refused. */
  approvals?: TurnApprovals;
  /** Where the tools are offered. Without it: the chat. */
  surface?: ToolSurface;
}

const stableValue = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
};

export interface WriteTarget {
  name: string;
  /** The site's tool that carries the write. Without it the write goes through `DocumentIO`. */
  mcpTool?: McpTool;
  lower: string;
  writeSlug: string | undefined;
  writeGlobalSlug: string | undefined;
}

const writeVerbOf = (lower: string) => (lower.startsWith("create") ? "create" : "update");

interface WriteRequest {
  target: WriteTarget;
  internal: boolean;
  verb: ReturnType<typeof writeVerbOf>;
  isGlobalWrite: boolean;
  params: Record<string, unknown>;
  locale: string | undefined;
}

interface WriteCall extends WriteRequest {
  toolCallId: string | undefined;
  before: PayloadDoc | undefined;
  beforeReadError: string | null;
  /** The written locale before the write, for a discard. See `EditRecordRef.restore`. */
  restore?: PayloadDoc;
}

type Refusal = { error: string; writeStatus?: WriteStatus } | null;

// `live`: the target has no drafts, so the write has no draft state to ask for.
function guardedParams(rawParams: Record<string, unknown>, live: boolean): Record<string, unknown> {
  let params = rawParams;

  // These make Payload read a file from the server's own disk
  // and serve it as the upload: always stripped.
  if ("filePath" in params || "overwriteExistingFiles" in params) {
    const { filePath: _fp, overwriteExistingFiles: _oef, ...rest } = params;

    params = rest;
  }

  return live ? params : { ...params, draft: true, _status: "draft" };
}

async function readBefore(context: WriteGateContext, call: WriteCall): Promise<void> {
  const { isGlobalWrite, params, locale } = call;
  const { writeSlug, writeGlobalSlug } = call.target;
  const read = { locale, ...ownLocaleValues(context.schema, locale), callId: "rec-before" };

  try {
    const res = isGlobalWrite
      ? await context.documentIo().read({ global: writeGlobalSlug }, read)
      : await context
          .documentIo()
          .read({ collection: writeSlug }, { id: String(params.id), ...read });

    call.before = res.doc ?? undefined;
    call.beforeReadError = res.error ?? (call.before ? null : "document not found");
  } catch (err) {
    call.beforeReadError = err instanceof Error ? err.message : String(err);
  }
}

function localeStateBefore(context: WriteGateContext, call: WriteCall) {
  const { isGlobalWrite, params, locale } = call;
  const { writeSlug, writeGlobalSlug } = call.target;

  return localeStateBeforeWrite(
    context.documentIo(),
    context.schema,
    isGlobalWrite ? { global: writeGlobalSlug } : { collection: writeSlug },
    { id: isGlobalWrite ? undefined : String(params.id), locale }
  );
}

function updateRisks(
  { schema }: WriteGateContext,
  { target, isGlobalWrite, params }: WriteRequest,
  before: PayloadDoc
): RiskFinding[] {
  const { writeSlug, writeGlobalSlug } = target;
  const targetCollection = isGlobalWrite
    ? undefined
    : schema.collections.find((collection) => collection.slug === writeSlug);
  const targetFields = isGlobalWrite
    ? (schema.globals.find((global) => global.slug === writeGlobalSlug)?.fields ?? [])
    : (targetCollection?.fields ?? []);

  return assessUpdateRisk(targetFields, before, params, targetCollection?.hasAuth);
}

function riskRefusal(context: WriteGateContext, call: WriteCall, before: PayloadDoc): Refusal {
  const risks = updateRisks(context, call, before);
  const forbidden = risks.filter((risk) => risk.kind === "forbidden");

  if (forbidden.length) {
    return {
      error:
        `Refused: ${forbidden.map((risk) => risk.reason).join(" ")} ` +
        `Remove the field(s) from your update - they cannot be written, with or without review.`,
    };
  }

  const reviewable = risks.filter((risk) => risk.kind === "reviewable");

  if (reviewable.length && !personApproved(context.approvals, call.toolCallId)) {
    return {
      writeStatus: "needs-confirmation",
      error: (context.surface ?? CHAT_SURFACE).destructiveRefusal(
        reviewable.map((risk) => risk.reason).join(" "),
        call.target.name
      ),
    };
  }

  return null;
}

function unverifiedRefusal({ params, beforeReadError }: WriteCall): Refusal {
  // Fails closed without the current document, except for a patch of non-empty scalars only:
  // the checks that need no current document (read-only, custom type, account) ran before.
  const patchEntries = Object.entries(params).filter(([key]) => !UPDATE_CONTROL_KEYS.has(key));
  const allHarmlessScalars = patchEntries.every(
    ([, value]) =>
      (typeof value === "string" && value !== "") ||
      typeof value === "number" ||
      typeof value === "boolean"
  );

  if (!allHarmlessScalars) {
    return {
      error:
        `Cannot verify this update's safety - reading the current document failed (${beforeReadError}). ` +
        `Retry in a moment; if it persists, read the document yourself (readDocument) before updating.`,
    };
  }

  return null;
}

async function lockedRefusal(context: WriteGateContext, call: WriteCall): Promise<Refusal> {
  const { isGlobalWrite, params } = call;
  const { writeSlug, writeGlobalSlug } = call.target;
  const id = isDocId(params?.id) ? params.id : undefined;
  const locked = await context
    .documentIo()
    .lockRefusal(isGlobalWrite ? { global: writeGlobalSlug } : { collection: writeSlug }, id);

  return locked ? { error: locked } : null;
}

async function currentDocumentRefusal(
  context: WriteGateContext,
  call: WriteCall
): Promise<Refusal> {
  const { internal, verb, isGlobalWrite, params } = call;

  if (!internal && verb === "update" && (isGlobalWrite || isDocId(params?.id))) {
    const locked = await lockedRefusal(context, call);

    if (locked) return locked;
    await readBefore(context, call);
    const risky = riskRefusal(context, call, call.before ?? {});

    return risky || call.before ? risky : unverifiedRefusal(call);
  }

  return null;
}

function unchangedRefusal(
  { internal, verb, before, params }: WriteCall,
  nameSearch: string
): Refusal {
  if (!internal && verb === "update" && before) {
    const current = before;
    const fields = Object.keys(params).filter((key) => !UPDATE_CONTROL_KEYS.has(key));

    if (
      fields.length &&
      fields.every((key) => stableValue(params[key]) === stableValue(current[key]))
    ) {
      return {
        writeStatus: "nothing-changed",
        error:
          `Nothing was written: ${fields.map((key) => `"${key}"`).join(", ")} already ${fields.length === 1 ? "has" : "have"} exactly this value in the current draft. ` +
          `If the task asks for a different value, find it first (for a relationship: the id of the right document, with ${nameSearch} or listDocuments) and send that. ` +
          `If the document is already as the task wants it, tell the person that nothing had to change.`,
      };
    }
  }

  return null;
}

interface WriteOutcome {
  result: unknown;
  failed: boolean;
  after: () => PayloadDoc | null;
}

async function writeThroughIo(context: WriteGateContext, call: WriteCall): Promise<WriteOutcome> {
  const { isGlobalWrite, params, locale } = call;
  const { writeSlug, writeGlobalSlug } = call.target;
  const patch = Object.fromEntries(
    Object.entries(params).filter(([key]) => !UPDATE_CONTROL_KEYS.has(key))
  );
  const { doc, error } = await context
    .documentIo()
    .write(isGlobalWrite ? { global: writeGlobalSlug } : { collection: writeSlug }, {
      id: !isGlobalWrite && isDocId(params.id) ? params.id : undefined,
      patch,
      locale,
      callId: GATE_WRITE_ID,
    });

  if (error) return { result: { error }, failed: true, after: () => null };
  const saved = doc ?? null;

  return { result: mcpDocResult(saved ?? {}), failed: false, after: () => saved };
}

// The document layer writes when the gate has no tool, when the tool refuses a `null` of the
// document, and when the tool would drop the locale or the draft: it writes through the Local
// API or refuses with the reason.
async function writeThroughTool(
  context: WriteGateContext,
  call: WriteCall,
  options: McpCallOptions
): Promise<WriteOutcome> {
  const { target, params } = call;
  const { mcpTool } = target;

  if (!mcpTool || fitNulls(mcpTool, params).refused || dropsWriteParam(mcpTool, params))
    return writeThroughIo(context, call);
  const result = await executeMcpWrite(
    (input, callOptions) => runMcpTool(target.name, mcpTool, input, callOptions),
    params,
    options
  );

  return { result, failed: !!mcpWriteError(result), after: () => parseMcpDoc(result) };
}

function recordWrite(context: WriteGateContext, call: WriteCall, outcome: WriteOutcome): void {
  const { recordEdits } = context;
  const { verb, isGlobalWrite, params, locale, before, restore } = call;
  const { name, writeSlug, writeGlobalSlug } = call.target;

  try {
    const after = outcome.after();

    if (isGlobalWrite) {
      recordEdits([
        {
          collection: `global:${writeGlobalSlug}`,
          id: writeGlobalSlug!,
          op: verb,
          before,
          after,
          locale,
          restore,
          toolName: name,
          summary: mcpWriteSummary(name, verb, params),
        },
      ]);
    } else {
      const id = after?.id ?? params?.id;

      if (isDocId(id))
        recordEdits([
          {
            collection: writeSlug!,
            id,
            op: verb,
            before: before ?? (verb === "create" ? {} : undefined),
            after,
            locale,
            restore,
            toolName: name,
            summary: mcpWriteSummary(name, verb, params),
          },
        ]);
    }
  } catch (err) {
    console.error(
      `[Content Agent] ${name} wrote the document, but the change could not be recorded for the review panel:`,
      err
    );
  }
}

export async function gatedMcpWrite(
  context: WriteGateContext,
  target: WriteTarget,
  rawParams: Record<string, unknown>,
  options: McpCallOptions
) {
  const { lower, writeSlug, writeGlobalSlug } = target;
  const draftsTarget = writeGlobalSlug ? { global: writeGlobalSlug } : { collection: writeSlug };
  const verb = writeVerbOf(lower);
  const write = { target: draftsTarget, verb, id: rawParams.id, toolCallId: options?.toolCallId };
  const consentError = consentRefusal(context, write);

  if (consentError) return { error: consentError };
  const internal = INTERNAL_WRITE_IDS.has(options?.toolCallId);
  const isGlobalWrite = !!writeGlobalSlug;
  let params = rawParams;

  if (!internal) params = guardedParams(params, hasNoDrafts(context.schema, draftsTarget));
  const locale = typeof params?.locale === "string" ? params.locale : undefined;
  const request: WriteRequest = { target, internal, verb, isGlobalWrite, params, locale };
  const call: WriteCall = {
    ...request,
    toolCallId: options?.toolCallId,
    before: undefined,
    beforeReadError: null,
  };
  const currentRefusal = await currentDocumentRefusal(context, call);

  if (currentRefusal) return currentRefusal;
  healEmptyRichTextDeep(params);
  const sameRefusal = unchangedRefusal(call, (context.surface ?? CHAT_SURFACE).nameSearch);

  if (sameRefusal) return sameRefusal;
  if (!internal && verb === "update") call.restore = await localeStateBefore(context, call);
  const outcome = await writeThroughTool(context, call, options);

  const recordedByCaller = RECORDED_BY_CALLER_IDS.has(options?.toolCallId);

  if (!internal && !recordedByCaller && !outcome.failed) recordWrite(context, call, outcome);

  return outcome.result;
}

/** Asks the person before an update that removes or shrinks what the document holds. */
export function destructiveUpdateApproval(
  context: WriteGateContext,
  target: WriteTarget
): ApprovalPolicy {
  return async (input) => {
    const { lower, writeSlug, writeGlobalSlug } = target;
    const isGlobalWrite = !!writeGlobalSlug;

    if (writeVerbOf(lower) !== "update" || !isRecord(input)) return undefined;
    if (!isGlobalWrite && !isDocId(input.id)) return undefined;

    const live = hasNoDrafts(
      context.schema,
      isGlobalWrite ? { global: writeGlobalSlug } : { collection: writeSlug }
    );
    const params = guardedParams(input, live);
    const call: WriteCall = {
      target,
      internal: false,
      verb: "update",
      isGlobalWrite,
      params,
      locale: typeof params.locale === "string" ? params.locale : undefined,
      toolCallId: undefined,
      before: undefined,
      beforeReadError: null,
    };

    await readBefore(context, call);
    // Without the current document only an account change is found: it is still asked about.
    const before = call.before ?? {};
    const risks = updateRisks(context, call, before);

    if (risks.some((risk) => risk.kind === "forbidden")) return undefined;
    const reviewable = risks.filter((risk) => risk.kind === "reviewable");

    if (!reviewable.length) return undefined;

    const effects = reviewable.map((risk) => risk.effect ?? risk.reason);
    const asked = { collection: writeSlug, global: writeGlobalSlug, id: input.id };

    return askPerson(riskyUpdateReason(context.schema, { ...asked, before, effects }));
  };
}
