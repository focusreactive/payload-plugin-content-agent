import { localeStateBeforeWrite } from "../localeState.js";
import { ToolLoopAgent, isStepCount } from "ai";
import type { ToolExecutionOptions } from "ai";
import { createWorkspaceTools, fieldsForTarget, refResolves } from "../workspaceTools.js";
import { createBlockTools } from "../blockTools.js";
import type { DocumentWorkspace } from "../blockTools.js";
import { createDocumentRewriteTools } from "../documentRewrite.js";
import type { EditorSession } from "../documentRewrite.js";
import { shrinkRatioFor } from "../guards.js";
import { createLookupTools } from "../lookupTools.js";
import { bodyHint } from "../bodyHint.js";
import { omitLocaleParam } from "../discovery.js";
import { withDocumentLock, documentLockKey } from "../documentLock.js";
import { unlinkByUrl } from "../links.js";
import { describeChanges } from "../changeFacts.js";
import {
  createOutcomeTools,
  declaresShorter,
  linkIntent,
  removalRefusal,
  reportCriteria,
} from "../outcomeCriteria.js";
import type { OutcomeState } from "../outcomeCriteria.js";
import { contentEditorInstructions } from "../editorPrompts.js";
import { editorSchemaText } from "./schemaText.js";
import { firstMessages } from "./firstRead.js";
import { LLM_MAX_RETRIES } from "../editorDeps.js";
import { outlineDoc, cloneRoutingRefusal } from "../structureChecks.js";
import { createRichTextTools } from "../richtextTools.js";
import { ASK_PERSON_TOOL, createAskPersonTool } from "./askPerson.js";
import { clipSummary, createFinishEditTool, restoreLinkFaults, runChecks } from "./checks.js";
import { personMessageNote } from "./personMessage.js";
import {
  REVIEW_UNAVAILABLE_REASON,
  needsReviewer,
  recordReviewSkipped,
  reviewEdit,
} from "./review.js";
import type { ReviewFacts } from "./review.js";
import { classifyChange } from "../changeClass.js";
import type { ChangeClass } from "../changeClass.js";
import { docChanged, savedNothing } from "./state.js";
import { editorCallbacks } from "./shared.js";
import type { EditorRunOptions, EditorRunResult, SessionContext } from "./state.js";
import { lowerNumbersToMaximum } from "../../repairToolCall.js";

const SINGLE_DOC_MAX_STEPS = 80;

interface EditorSetup extends SessionContext {
  wsTools: ReturnType<typeof createWorkspaceTools>;
  toolOptions: ToolExecutionOptions<Record<string, unknown>>;
  agentTools: ReturnType<typeof createAgentTools>;
  collectionSchema: string;
}

function createAgentTools(
  { deps, target }: EditorRunOptions,
  workspace: DocumentWorkspace,
  { outcome, shrinkRatio }: { outcome: OutcomeState; shrinkRatio: () => number | null }
) {
  const session: EditorSession = {
    textPassReads: 0,
    shrinkRatio,
    linkIntent: () => linkIntent(outcome, workspace.original),
  };

  return omitLocaleParam(
    {
      ...createOutcomeTools(
        outcome,
        () => workspace.ref.current,
        refResolves(deps.schema, target, workspace)
      ),
      ...createBlockTools(workspace, deps.schema, {
        remove: (item, path) => removalRefusal(outcome, item, path),
        shrinkRatio,
      }),
      ...createLookupTools(deps.io, deps.schema, () => workspace.readLocale ?? workspace.locale),
      ...createRichTextTools(workspace, deps.schema, {
        config: deps.config,
        guards: { shrinkRatio, linkIntent: session.linkIntent },
      }),
      ...createDocumentRewriteTools(workspace, deps.schema, session),
    },
    deps.schema
  );
}

function setUpSession(run: EditorRunOptions): EditorSetup {
  const { deps, target, id, locale, writeLocale } = run;
  const docId = target.global ?? id!;
  const workspace: DocumentWorkspace = { ref: { current: null }, collection: null };
  const wsTools = createWorkspaceTools(workspace, deps.io, deps.schema);
  const toolOptions: ToolExecutionOptions<Record<string, unknown>> = {
    toolCallId: "content-editor",
    messages: [],
    context: {},
  };

  const outcome: OutcomeState = { criteria: [] };
  const isTranslation = !!(writeLocale && writeLocale !== locale);
  const shrinkRatio = () => shrinkRatioFor(declaresShorter(outcome), isTranslation);
  const agentTools = createAgentTools(run, workspace, { outcome, shrinkRatio });
  const collectionSchema = editorSchemaText(deps.schema, target);

  return {
    run,
    docId,
    workspace,
    fields: fieldsForTarget(deps.schema, target),
    outcome,
    isTranslation,
    shrinkRatio,
    state: {
      finishCalls: 0,
      finished: false,
      unresolvedLinks: [],
      criteriaResults: [],
      retargeted: [],
      summary: "",
      reviewReason: REVIEW_UNAVAILABLE_REASON,
      question: "",
    },
    wsTools,
    toolOptions,
    agentTools,
    collectionSchema,
  };
}

async function openForEditing(setup: EditorSetup): Promise<EditorRunResult | null> {
  const { docId, workspace, fields, wsTools, toolOptions } = setup;
  const { deps, target, id, modelDocument, locale, writeLocale } = setup.run;
  const locked = await deps.io.lockRefusal(target, id);

  if (locked) return { id: docId, status: "error", error: locked };
  const opened = await wsTools.openDocument.execute!(
    {
      ...(target.global
        ? { global: target.global }
        : { collection: target.collection, id: String(id) }),
      ...(locale ? { locale } : {}),
      ...(writeLocale ? { writeLocale } : {}),
    },
    toolOptions
  );

  if ("error" in opened && opened.error) return { id: docId, status: "error", error: opened.error };

  if (!target.global) {
    const misrouted = cloneRoutingRefusal(fields, workspace.ref.current, modelDocument);

    if (misrouted) return { id: docId, status: "error", error: misrouted };
  }

  return null;
}

function editorPrompt(setup: EditorSetup): string {
  const { workspace, fields, isTranslation } = setup;
  const { deps, target, id, instruction, locale, writeLocale } = setup.run;
  const docLabel = target.global
    ? `global "${target.global}"`
    : `collection "${target.collection}", id "${id}"`;
  const localeNote = isTranslation
    ? `\nTRANSLATION: the field values you see are in the "${locale ?? deps.schema.defaultLocale ?? "default"}" (source) locale. Rewrite each LOCALIZED text field into "${writeLocale}" - your edits are saved to the "${writeLocale}" locale; the source is untouched. Use applyRichText in transform mode for rich text so structure/links/blocks are preserved exactly. Leave non-localized and non-text fields (select/relationship/number/date/url) unchanged.`
    : locale
      ? `\nThe document is open in the "${locale}" locale - your edits to localized fields are saved to that locale. Edit the field values as they should read in "${locale}".`
      : "";
  const body = bodyHint(fields, workspace.ref.current);

  return `Document: ${docLabel}.${localeNote}${body ? `\n${body.note}` : ""}\nTask: ${instruction}${personMessageNote(deps.personMessage)}`;
}

async function runEditorAgent(setup: EditorSetup): Promise<EditorRunResult | null> {
  const { docId, state, agentTools, collectionSchema } = setup;
  const { deps, signal, maxSteps = SINGLE_DOC_MAX_STEPS, onStep, canAsk } = setup.run;
  const finishEdit = createFinishEditTool(setup);
  const tools = canAsk
    ? { ...agentTools, finishEdit, [ASK_PERSON_TOOL]: createAskPersonTool(state) }
    : { ...agentTools, finishEdit };

  const callbacks = editorCallbacks(setup.run);

  state.runId = callbacks.runId;
  let stepNo = 0;
  const agent = new ToolLoopAgent({
    id: "content-editor",
    model: deps.model,
    maxRetries: LLM_MAX_RETRIES,
    repairToolCall: lowerNumbersToMaximum,
    instructions: contentEditorInstructions(deps.agentInstructions, collectionSchema),
    tools,
    toolCallConcurrency: 1,
    stopWhen: [isStepCount(maxSteps), () => !!state.question, () => state.finished],
    onStepEnd: (event) => {
      try {
        onStep?.({ step: (stepNo += 1), lastTool: event?.toolCalls?.at?.(-1)?.toolName });
      } catch {}

      return callbacks.onStepFinish(event);
    },
    onToolExecutionEnd: callbacks.onToolExecutionEnd,
  });

  try {
    const messages = await firstMessages(agentTools, editorPrompt(setup));
    const res = await agent.generate({ messages, abortSignal: signal });

    callbacks.runFinished({
      ok: !signal?.aborted,
      finishReason: res.finishReason,
      ...(signal?.aborted ? { error: "aborted" } : {}),
    });
    state.summary = (state.finished && state.summary) || clipSummary(res.text) || state.summary;
  } catch (err) {
    callbacks.runFinished({ ok: false, error: err instanceof Error ? err.message : String(err) });

    return {
      id: docId,
      status: "error",
      error: `Editor failed: ${err instanceof Error ? err.message : String(err)}`,
      summary: state.summary,
    };
  }

  if (signal?.aborted)
    return { id: docId, status: "error", error: "timed out", summary: state.summary };
  if (state.question) return { id: docId, status: "needsInput", question: state.question };

  return null;
}

async function checkFinishedEdit(
  setup: EditorSetup
): Promise<{ rejected: EditorRunResult | null; issues: string[] }> {
  const { docId, workspace, fields, state } = setup;
  const final = await runChecks(setup, false);

  if (final.blocking.length)
    return {
      rejected: {
        id: docId,
        status: "rejected",
        summary: state.summary,
        reviewReason: final.blocking.join("\n"),
      },
      issues: [],
    };
  const issues = [...final.open, ...(await restoreLinkFaults(setup))];
  const deadLinks = state.unresolvedLinks.filter((unresolved) => unresolved.verdict === "missing");

  if (deadLinks.length) {
    const removed = unlinkByUrl(
      fields,
      workspace.ref.current,
      new Set(deadLinks.map((unresolved) => unresolved.link.url!))
    );

    issues.push(
      `${removed} link(s) pointed at pages this site does not have (404) and were unlinked, text kept: ${deadLinks.map((unresolved) => `"${unresolved.link.text}" -> ${unresolved.link.url}`).join("; ")}`
    );
  }

  if (state.finishCalls === 0 && docChanged(setup))
    issues.push(
      "the editor did not run finishEdit before finishing; the checks above ran afterwards instead"
    );

  return { rejected: null, issues };
}

async function writeDraft(setup: EditorSetup) {
  const { docId, wsTools, toolOptions } = setup;
  const { deps, target, locale, writeLocale } = setup.run;
  const restore = await localeStateBeforeWrite(deps.io, deps.schema, target, {
    id: target.global ? undefined : docId,
    locale: writeLocale ?? locale,
  });
  const saved = await wsTools.saveDocument.execute!({}, toolOptions);

  return { restore, saved };
}

const SAVE_ERROR_CHARS = 1500;

/** The final checks put the document back as it was opened: no save, the reason goes on. */
function takenBack({ docId, state }: EditorSetup, issues: string[]): EditorRunResult {
  if (!issues.length) return { id: docId, status: "unchanged", summary: state.summary };

  return {
    id: docId,
    status: "unchanged",
    summary: `The final checks took back every change, so the document is as it was:\n${issues.map((issue) => `- ${issue}`).join("\n")}\n\n${state.summary}`,
    issues,
  };
}

function reportSave(
  setup: EditorSetup,
  { restore, saved }: Awaited<ReturnType<typeof writeDraft>>,
  { issues, changes }: { issues: string[]; changes: string[] }
): EditorRunResult {
  const { docId, workspace, isTranslation } = setup;
  const { deps, target, locale, writeLocale } = setup.run;
  const { summary, reviewReason } = setup.state;

  if (savedNothing(saved)) return takenBack(setup, issues);

  if ("error" in saved && saved.error)
    return {
      id: docId,
      status: "error",
      error: String(saved.error).slice(0, SAVE_ERROR_CHARS),
      summary,
      reviewReason,
    };
  deps.recordEdits?.([
    {
      collection: target.global ? `global:${target.global}` : target.collection!,
      id: docId,
      op: isTranslation ? "translate" : "edit",
      before: workspace.original,
      after: structuredClone(workspace.ref.current),
      locale: writeLocale ?? locale,
      restore,
      summary,
      toolName: isTranslation ? "translateContent" : "editContent",
      report: { issues, criteria: reportCriteria(setup.state.criteriaResults) },
    },
  ]);

  if (issues.length) {
    return {
      id: docId,
      status: "done",
      summary: `Saved with ${issues.length} open issue(s) for a person to check:\n${issues.map((issue) => `- ${issue}`).join("\n")}\n\n${summary}`,
      reviewReason,
      issues,
      changes,
    };
  }

  return { id: docId, status: "done", summary, reviewReason, changes };
}

async function reviewWhenNeeded(
  setup: EditorSetup,
  changeClass: ChangeClass,
  facts: ReviewFacts
): Promise<boolean> {
  if (needsReviewer(setup, changeClass)) return reviewEdit(setup, facts);
  setup.state.reviewReason = "";
  recordReviewSkipped(setup, changeClass);

  return true;
}

async function runContentEditorSession(run: EditorRunOptions): Promise<EditorRunResult> {
  const setup = setUpSession(run);
  const { deps, target, signal } = run;
  const { docId, workspace, fields, state } = setup;

  const refusal = await openForEditing(setup);

  if (refusal) return refusal;
  const before = outlineDoc(deps.schema, target, workspace.ref.current);

  const failure = await runEditorAgent(setup);

  if (failure) return failure;
  if (!docChanged(setup)) return { id: docId, status: "unchanged", summary: state.summary };

  const { rejected, issues } = await checkFinishedEdit(setup);

  if (rejected) return rejected;
  if (!docChanged(setup)) return takenBack(setup, issues);

  if (signal?.aborted)
    return { id: docId, status: "error", error: "timed out", summary: state.summary };

  // The reviewer does not veto the save, so the two run at the same time: its objection is
  // reported with the draft.
  const after = outlineDoc(deps.schema, target, workspace.ref.current);
  const changes = describeChanges(fields, workspace.original, workspace.ref.current);
  const changeClass = classifyChange(fields, workspace.original, workspace.ref.current);

  run.onSaveStart?.();
  const [approved, written] = await Promise.all([
    reviewWhenNeeded(setup, changeClass, { before, after, changes, issues }),
    writeDraft(setup),
  ]);

  if (!approved) issues.unshift(`review: ${state.reviewReason}`);

  return { ...reportSave(setup, written, { issues, changes }), changeClass };
}

export function runContentEditor(run: EditorRunOptions): Promise<EditorRunResult> {
  return withDocumentLock(documentLockKey(run.target, run.id), () => runContentEditorSession(run));
}
