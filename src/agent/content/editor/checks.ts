import { tool } from "ai";
import type { PayloadDoc } from "../../../borders.js";
import { z } from "zod";
import { findShrunkFields, findLostProtectedValues, findNewDuplicates } from "../guards.js";
import { describeLink, findLinkIssues, findUnresolvedNewLinks } from "../links.js";
import { describeTableIssue, findTableIssuesOfEdit } from "../tables.js";
import { describeLeftover, findIncompleteRename } from "../topicRename.js";
import { checkCriteria, describeDropped, describeFailures } from "../outcomeCriteria.js";
import type { ContentEditorDeps } from "../editorDeps.js";
import { docKeys, docLabel, keyFields } from "../../../schema/docLabel.js";
import { findRelabelledLinks, lostTargetWords } from "../linkLabels.js";
import type { LinkTarget, RelabelledLink } from "../linkLabels.js";
import { findEmptyNewSections } from "../structureChecks.js";
import { NAMED_TEXT_AS_READ } from "../../namedText.js";
import { docChanged } from "./state.js";
import type { SessionContext } from "./state.js";

interface ChecksRun {
  session: SessionContext;
  strict: boolean;
  blocking: string[];
  open: string[];
  current: PayloadDoc | null;
  put: (hard: boolean, text: string) => number;
}

function checkEmptySections({ session, blocking, current }: ChecksRun): void {
  const { fields, workspace } = session;
  const empty = findEmptyNewSections(fields, workspace.original, current);

  if (empty.length) {
    blocking.push(
      `${empty.length} newly added section(s) are empty shells - a heading with nothing in it: ` +
        empty
          .map(
            (section) =>
              `${section.blockType} at "${section.path}" (${section.empty.join(", ")} at 0 rows)`
          )
          .join("; ") +
        ". Fill every one of them (insertItem for the rows, lookupDocuments + setValues for reference and media fields) or remove the section. A section that renders as a bare heading is not a built page."
    );
  }
}

function checkDeclaredCriteria({ session, strict, open, current, put }: ChecksRun): void {
  const { workspace, outcome, state } = session;

  state.criteriaResults = outcome.criteria.length
    ? checkCriteria(outcome.criteria, workspace.original, current)
    : [];
  const { criteriaResults } = state;
  // A failed `unchanged` criterion is reported as a fact, never as work to redo: the editor
  // made every change itself.
  const selfContradicted = criteriaResults.filter(
    (result) => !result.ok && result.criterion.check.type === "unchanged"
  );
  const broken = criteriaResults.filter(
    (result) => !result.ok && result.criterion.check.type !== "unchanged"
  );

  if (broken.length) {
    put(
      strict,
      `${broken.length} of the ${outcome.criteria.length} success criteria you declared are not met:\n${describeFailures(broken)}\nThese are your own criteria, checked against the document. Fix the work, or say plainly in your summary why a criterion was wrong for the task.`
    );
  }

  const dropped = describeDropped(outcome.dropped ?? [], workspace.original, current);

  if (dropped.length) {
    open.push(
      `You declared ${dropped.length} success criterion(s) and later declared again without them; the document does not meet them: ${dropped.join("; ")}. This is reported with the saved draft. No action needed if the criterion was wrong for the task - say why in your summary.`
    );
  }

  if (selfContradicted.length) {
    open.push(
      `You declared ${selfContradicted.map((result) => result.criterion.path ?? "the document").join(", ")} unchanged and then edited it. The edit stands; the changes are listed with the saved draft. No action needed unless the list shows a change the task did not ask for - do not move or undo the change to satisfy the criterion.`
    );
  }
}

function checkRename({ session, strict, current, put }: ChecksRun): void {
  const { workspace, isTranslation } = session;
  const rename = findIncompleteRename(workspace.original, current, { isTranslation });

  if (rename) {
    put(
      strict,
      `This edit rewrote the document from "${rename.from}" to "${rename.to}", but ${rename.from} still appears ${rename.afterCount} time(s) (was ${rename.beforeCount}) in ${rename.leftovers.length} place(s):\n` +
        rename.leftovers
          .slice(0, 40)
          .map((leftover) => `- ${describeLeftover(leftover)}`)
          .join("\n") +
        `\nA path ending in .url or .link is a DESTINATION: rewriting the words above it does not move it - repoint it or drop the link. readDocumentText + applyDocumentText({ token, text, links }) rewrites every string AND every link destination in one call. Leave a mention only where the task asked for it (an explicit comparison).`
    );
  }
}

function recordRetargetedLinks({ session, current }: ChecksRun): void {
  const { fields, workspace, isTranslation, state } = session;

  state.retargeted = findLinkIssues(fields, workspace.original, current, {
    isTranslation,
  }).retargeted;
}

export async function keyExists(
  deps: Pick<ContentEditorDeps, "schema" | "io">,
  candidates: string[]
): Promise<boolean> {
  const cols = deps.schema.collections.filter((collection) => keyFields(collection).length);

  if (!cols.length) return true;
  const results = await Promise.all(
    cols.map(async (collection) => {
      const clauses = keyFields(collection).map((name) => ({ [name]: { in: candidates } }));

      try {
        const { docs, error } = await deps.io.list(collection.slug, {
          page: 1,
          limit: 1,
          where: clauses.length === 1 ? clauses[0] : { or: clauses },
          callId: "link-target-check",
        });

        if (error) return null;

        return docs.length > 0;
      } catch {
        return null;
      }
    })
  );

  if (results.some((result) => result === true)) return true;

  // A failed collection counts as unknown, not missing: only a "no" from every collection flags the
  // link.
  return results.some((result) => result === null);
}

async function checkNewLinks({ session, strict, open, current, put }: ChecksRun): Promise<void> {
  const { fields, workspace, state } = session;
  const { deps, instruction } = session.run;

  state.unresolvedLinks = await findUnresolvedNewLinks(fields, workspace.original, current, {
    lookup: (candidates) => keyExists(deps, candidates),
    instruction,
    probe: deps.probeLink,
  }).catch(() => []);
  const { unresolvedLinks } = state;
  const missingLinks = unresolvedLinks.filter((unresolved) => unresolved.verdict === "missing");
  const unverifiedLinks = unresolvedLinks.filter(
    (unresolved) => unresolved.verdict === "unverified"
  );

  if (missingLinks.length) {
    put(
      strict,
      `${missingLinks.length} link(s) added by this edit point at pages this site does not have: ${missingLinks.map((unresolved) => `${describeLink(unresolved.link)} - no document has the slug "${unresolved.slug}" and the site answers 404`).join("; ")}. Never compose a URL: lookupDocuments to find a real page, reuse a link already in this document, or keep the text without a link. Any that remain at the end are unlinked automatically.`
    );
  }

  if (unverifiedLinks.length) {
    // A route can exist without a document, so an unverified link never blocks and is never
    // unlinked.
    open.push(
      `${unverifiedLinks.length} link(s) added by this edit could not be verified: ${unverifiedLinks.map((unresolved) => `${describeLink(unresolved.link)} - no document has the slug "${unresolved.slug}"`).join("; ")}. Kept as written. If you composed any of them rather than taking it from the task, a document or an existing link, replace it with a real page (lookupDocuments) or drop the link.`
    );
  }
}

const urlPath = (url: string): string => url.replace(/^https?:\/\/[^/]+/u, "");

async function targetTexts(
  deps: Pick<ContentEditorDeps, "schema" | "io">,
  { url, collection, id }: LinkTarget
): Promise<string[]> {
  if (url) return [urlPath(url)];
  const schemaCollection = deps.schema.collections.find((entry) => entry.slug === collection);

  if (!schemaCollection || id == null) return [];
  const { doc } = await deps.io
    .read({ collection: schemaCollection.slug }, { id, callId: "link-label-check" })
    .catch(() => ({ doc: null }));

  return [docLabel(doc, schemaCollection), ...Object.values(docKeys(doc, schemaCollection))].filter(
    (text): text is string => !!text
  );
}

const describeTarget = (target: LinkTarget, texts: string[]): string =>
  target.url ?? `${target.collection} ${target.id}${texts[0] ? ` ("${texts[0]}")` : ""}`;

interface LinkFault {
  link: RelabelledLink;
  line: string;
}

async function linkFault(
  deps: Pick<ContentEditorDeps, "schema" | "io">,
  link: RelabelledLink
): Promise<LinkFault | null> {
  const texts = await Promise.all(link.targets.map((target) => targetTexts(deps, target)));
  const opened = describeTarget(link.targets[0], texts[0]);

  if (link.kind === "self")
    return { link, line: `${link.ref}: the link opened ${opened} and now opens this document` };
  if (!lostTargetWords(link, texts.flat())) return null;

  return {
    link,
    line: `${link.ref}: "${link.from}" -> "${link.to}", and the link still opens ${opened}`,
  };
}

/** The person asked for this very change: their message holds the old label and the new one. */
const namedByPerson = (said: string, { from, to }: RelabelledLink): boolean =>
  said.includes(from.trim().toLowerCase()) && said.includes(to.trim().toLowerCase());

async function findLinkFaults({ fields, workspace, isTranslation, docId, run }: SessionContext) {
  if (isTranslation) return [];
  const { deps, target } = run;
  const said = (deps.personMessage ?? "").toLowerCase();
  const self = target.collection ? { collection: target.collection, id: docId } : undefined;
  const links = findRelabelledLinks(fields, workspace.original, workspace.ref.current, self).filter(
    (link) => link.kind === "self" || !namedByPerson(said, link)
  );

  return (await Promise.all(links.map((link) => linkFault(deps, link)))).filter(
    (fault): fault is LinkFault => fault !== null
  );
}

async function checkLinkLabels({ session, strict, blocking }: ChecksRun): Promise<void> {
  if (!strict) return;
  const faults = await findLinkFaults(session);

  if (faults.length) {
    blocking.push(
      `${faults.length} link(s) and their label(s) no longer agree:\n${faults.map((fault) => `- ${fault.line}`).join("\n")}\nA label next to a link tells the reader what the link opens, so the two change together, and a link never opens the document it is in. For each one: point the link at a real page that the label names, other than this document (lookupDocuments finds one; never compose a URL or an id), or put the label and the target back exactly as they were. When no real page fits the new label, putting both back is the answer: it is not a question for the person. What is left at the end is put back automatically.`
    );
  }
}

/** Puts back every link and label that still do not agree, and says which. */
export async function restoreLinkFaults(session: SessionContext): Promise<string[]> {
  const faults = await findLinkFaults(session);

  for (const fault of faults) fault.link.restore();

  return faults.length
    ? [
        `${faults.length} link label(s) or target(s) were put back as they were, because the label and the page the link opens did not agree: ${faults.map((fault) => fault.line).join("; ")}`,
      ]
    : [];
}

function checkTables({ session, strict, current, put }: ChecksRun): void {
  const { fields, workspace } = session;
  const tableIssues = findTableIssuesOfEdit(fields, workspace.original, current);

  if (tableIssues.length) {
    put(
      strict,
      `${tableIssues.length} table row(s) are still malformed: ${tableIssues.map(describeTableIssue).join("; ")}. A table renders only when the header, the delimiter row (|---|---|) and every row have the SAME number of cells - fix the delimiter row too, and change no cell text.`
    );
  }
}

function checkLostContent({ session, strict, blocking, current, put }: ChecksRun): void {
  const { fields, workspace, shrinkRatio, isTranslation } = session;
  const { instruction } = session.run;
  const shrunk = findShrunkFields(fields, workspace.original, current, shrinkRatio());

  if (shrunk.length) {
    blocking.push(
      `${shrunk.length} field(s) lost most of their content: ${shrunk.map((shrunkField) => `${shrunkField.ref} ${shrunkField.from} → ${shrunkField.to} chars`).join("; ")}. ` +
        'This cannot be saved. Put the text back: readDocumentText shows the field paragraph by paragraph - every paragraph you did not mean to change must read exactly as it did. If you cannot restore it, say so in your summary; the draft will not be written. If the task asks for a shorter text, call declareOutcome with a "shorter" criterion for it and finish again.'
    );
  }

  const lost = findLostProtectedValues(workspace.original, current, instruction, {
    isTranslation,
  });

  if (lost.length) {
    put(
      strict,
      `These values were in the document before your edit and are gone now: ${lost.map((lostValue) => `"${lostValue}"`).join(", ")}. Times, URLs, emails, prices and measurements survive an edit untouched unless the task names them - put each one back exactly as it was.`
    );
  }
}

function checkDuplicates({ session, strict, current, put }: ChecksRun): void {
  const { workspace } = session;
  const dups = findNewDuplicates(workspace.original, current);

  if (dups.length) {
    put(
      strict,
      `This edit made the same passage appear more than once in the document: ${dups.map((duplicate) => `"${duplicate}…"`).join("; ")}. Keep one copy - in the body field - and remove the other (surgical remove in the rich text field, or rewrite the plain-text field without it).`
    );
  }
}

export async function runChecks(session: SessionContext, strict: boolean) {
  const blocking: string[] = [];
  const open: string[] = [];
  const current = session.workspace.ref.current;
  const put = (hard: boolean, text: string) => (hard ? blocking : open).push(text);
  const checks: ChecksRun = { session, strict, blocking, open, current, put };

  checkEmptySections(checks);
  checkDeclaredCriteria(checks);
  checkRename(checks);
  recordRetargetedLinks(checks);
  await checkNewLinks(checks);
  await checkLinkLabels(checks);
  checkTables(checks);
  checkLostContent(checks);
  checkDuplicates(checks);

  return { blocking, open };
}

const MUST_GO = new Set(["absent", "countAtMost", "itemRemoved"]);
const UNCHANGED_SENT_BACK = 2;

/** Declared criteria that fail because the document still holds what the task removes. */
function stillHeld({ workspace, outcome }: SessionContext) {
  return checkCriteria(outcome.criteria, workspace.original, workspace.ref.current).filter(
    (result) => !result.ok && MUST_GO.has(result.criterion.check.type)
  );
}

const SUMMARY_MAX_CHARS = 500;

export const clipSummary = (text: string): string =>
  text.length > SUMMARY_MAX_CHARS
    ? `${text.slice(0, SUMMARY_MAX_CHARS)}... [truncated, ${text.length} chars total]`
    : text;

async function checkForFinish(session: SessionContext) {
  const { state } = session;

  state.finishCalls += 1;
  const held = docChanged(session) ? [] : stillHeld(session);

  if (held.length && state.finishCalls <= UNCHANGED_SENT_BACK)
    return {
      ok: false,
      unchanged: true,
      blocking: [
        `The document reads exactly as it did when you opened it, and it still holds what ${held.length} of your declared criteria say must go:\n${describeFailures(held)}\nThe task is not done. Make the change, then call finishEdit again. When a tool refused the change, its error names the call to make instead. If no tool of yours can make it, say in your summary which call refused it and why.`,
      ],
    };
  if (!docChanged(session))
    return {
      ok: true,
      unchanged: true,
      note: `The document reads exactly as it did when you opened it, so nothing will be saved. That is the right end when the document does not hold what the task names, or already reads the way the task asks: say in your summary what you looked for and what you found. ${NAMED_TEXT_AS_READ} When the document holds the named text in another letter case, the task is not done yet. If you meant to make a change and it did not apply, make it and call finishEdit again. Do not make a change the task does not ask for only to have one.`,
    };
  const { blocking, open } = await runChecks(session, state.finishCalls <= 3);

  if (blocking.length)
    return {
      ok: false,
      blocking,
      note:
        state.finishCalls >= 3
          ? "Third round. Fix these; anything still open after the next round is reported with the saved draft rather than blocking it - except empty sections and lost content, which always block."
          : "Fix exactly these, then call finishEdit again. Everything you have done so far is kept.",
    };

  return {
    ok: true,
    ...(open.length
      ? {
          open,
          note: "Saved with these noted for a person to check.",
        }
      : {}),
  };
}

async function finishEdit(session: SessionContext, summary: string) {
  const { state } = session;
  const result = await checkForFinish(session);

  state.summary = clipSummary(summary ?? "");
  state.finished = result.ok && !("unchanged" in result);

  return result;
}

export function createFinishEditTool(session: SessionContext) {
  return tool({
    description:
      "Call this when you believe the task is complete. It checks the document the way a reader would - no empty sections, your declared criteria met, the rename finished, links pointing at real pages, tables well-formed - and returns what still does not hold. Fix what it names and call it again. When it returns ok: true for a changed document, the session ends there: write no text after it, your `summary` goes to the orchestrator and the document is saved after this tool, not by it.",
    inputSchema: z.object({
      summary: z
        .string()
        .describe(
          `Your account of the work for the orchestrator, not a message to the user: what you changed and any uncertainty. When you changed nothing: what you looked for and what you found. At most ${SUMMARY_MAX_CHARS} characters: a longer summary is cut there.`
        ),
    }),
    execute: ({ summary }) => finishEdit(session, summary),
  });
}
