import { approvalReason } from "../../approvalRequest.js";
import type { LiveTarget } from "../../approvalRequest.js";
import { getToolName, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { isDocId, isRecord } from "../../borders.js";
import { askPerson, createTurnApprovals, liveKey } from "../approvals.js";
import type { PersonApproval, TurnApprovals } from "../approvals.js";
import { CHAT_SURFACE } from "../toolSurface.js";
import { shownDocuments } from "./approvalDocuments.js";
import { BULK_CONFIRM_THRESHOLD } from "./bulk.js";
import type { DocumentIO } from "./documentIo.js";
import { liveTargetOf } from "./draftsOnly.js";
import type { DraftsTarget } from "./draftsOnly.js";
import type { SchemaContext } from "../../types.js";

type Ids = (string | number)[];

/** The person's confirmation of a tool call, and the documents the call writes. */
export interface DocumentsConsent {
  approvals?: TurnApprovals;
  /** The tool call that the chat asked the person about. */
  toolCallId?: string;
  ids?: Ids;
}

const keysOf = (target: DraftsTarget, ids: Ids): string[] =>
  target.global ? [liveKey(target)] : ids.map((id) => liveKey(target, id));

const isNew = (approvals: TurnApprovals, key: string): boolean =>
  !approvals.written.has(key) && !approvals.confirmed.has(key);

/**
 * How many documents the request has changed without the person once these are changed too.
 * Zero when the request already changed each of them, or the person confirmed each of them.
 */
export function documentsAfter(
  approvals: TurnApprovals | undefined,
  target: DraftsTarget,
  ids: Ids
): number {
  if (!approvals) return 0;
  const fresh = keysOf(target, ids).filter((key) => isNew(approvals, key));

  return fresh.length ? approvals.written.size + fresh.length : 0;
}

/** The count that decides whether a run on many documents asks the person. */
export const bulkCount = (
  approvals: TurnApprovals | undefined,
  collection: string,
  ids: Ids
): number => Math.max(ids.length, documentsAfter(approvals, { collection }, ids));

const refusal = (changed: number): string =>
  `Nothing was written: this request already wrote or tried to write ${changed} documents, and it writes one more only after the person confirms it in the chat. This call has no confirmation. Change this one document with ${CHAT_SURFACE.update}, ${CHAT_SURFACE.edit} or translateContent: the chat then asks the person, and the tool writes after the confirmation.`;

/** The person confirmed a run on these documents: they do not count against the limit. */
export function confirmDocuments(
  approvals: TurnApprovals | undefined,
  target: DraftsTarget,
  ids: Ids
): void {
  for (const key of keysOf(target, ids)) approvals?.confirmed.add(key);
}

/**
 * Takes a place for each of these documents among the ones the request changes without the
 * person. False when the limit has no place left. The check and the count are one step with
 * no wait between them: the tool calls of one model step run at the same time.
 */
function takePlaces(approvals: TurnApprovals, target: DraftsTarget, ids: Ids): boolean {
  if (documentsAfter(approvals, target, ids) > BULK_CONFIRM_THRESHOLD) return false;
  for (const key of keysOf(target, ids)) if (isNew(approvals, key)) approvals.written.add(key);

  return true;
}

/**
 * A request changes at most `BULK_CONFIRM_THRESHOLD` documents without the person, whatever
 * tool writes them. Null when this write stays within that, or when the person confirmed the
 * tool call that names these documents. A write that passes counts, also when it fails later.
 */
export function manyDocumentsRefusal(
  target: DraftsTarget,
  { approvals, toolCallId, ids = [] }: DocumentsConsent
): string | null {
  if (!approvals) return null;
  if (toolCallId && approvals.asked.has(toolCallId)) confirmDocuments(approvals, target, ids);

  return takePlaces(approvals, target, ids) ? null : refusal(approvals.written.size);
}

const ONE_DOCUMENT_TOOLS = new Set<string>([
  CHAT_SURFACE.update,
  CHAT_SURFACE.edit,
  "translateContent",
]);

const oneDocumentOf = (toolName: string, input: unknown): LiveTarget | null => {
  if (!ONE_DOCUMENT_TOOLS.has(toolName) || !isRecord(input) || input.preview === true) return null;
  const { collection, global, id, ids, where } = input;

  if (ids !== undefined || where !== undefined) return null;
  if (typeof global === "string") return { global };

  return typeof collection === "string" && (typeof id === "string" || typeof id === "number")
    ? { collection, document: { id } }
    : null;
};

interface AskDeps {
  approvals: TurnApprovals;
  schema: SchemaContext;
  io: DocumentIO;
}

/** The question to the person before a tool call changes one more document than the limit. */
const nextDocumentQuestion =
  ({ approvals, schema, io }: AskDeps) =>
  async (toolName: string, input: unknown): Promise<PersonApproval | undefined> => {
    const target = oneDocumentOf(toolName, input);

    if (!target) return undefined;
    const ids = target.document ? [target.document.id] : [];

    // No wait before this line: see `takePlaces`.
    if (takePlaces(approvals, target, ids)) return undefined;
    const changed = approvals.written.size;
    const { collection } = target;
    const [document] = collection ? await shownDocuments({ io, schema, collection, ids }) : [];

    return askPerson(approvalReason({ kind: "more-documents", changed, ...target, document }));
  };

/** The questions the chat asks before a write tool call, whatever policy the tool has. */
export function askBeforeWrites(deps: AskDeps): void {
  deps.approvals.liveTarget = liveTargetOf(deps.schema);
  deps.approvals.nextDocument = nextDocumentQuestion(deps);
}

const WRITE_TOOLS = new Set<string>([...ONE_DOCUMENT_TOOLS, "findReplaceContent"]);

function documentKeysOf(input: unknown): string[] {
  if (!isRecord(input) || input.preview === true) return [];
  const { collection, global, id, ids } = input;

  if (typeof global === "string") return [liveKey({ global })];
  if (typeof collection !== "string") return [];
  const named: unknown[] = Array.isArray(ids) ? ids : [id];

  return named.filter(isDocId).map((docId) => liveKey({ collection }, docId));
}

/** A run that selected its documents with `where` or went on with `continue` names them only in
 *  its output: the documents it saved. */
function writtenKeysOf(input: unknown, output: unknown): string[] {
  const named = documentKeysOf(input);

  if (named.length || !isRecord(input) || typeof input.collection !== "string") return named;
  if (!isRecord(output) || !Array.isArray(output.results)) return [];
  const { collection } = input;

  return output.results.flatMap((result: unknown) =>
    isRecord(result) && result.status === "done" && isDocId(result.id)
      ? [liveKey({ collection }, result.id)]
      : []
  );
}

/**
 * The approvals of a request. A request that goes on after the person's click is the same
 * request for the limit: the documents its write tool calls named before the click count,
 * so a click opens one tool call and not five more documents.
 */
export function requestApprovals(messages: UIMessage[]): TurnApprovals {
  const approvals = createTurnApprovals();
  const last = messages.at(-1);

  if (last?.role !== "assistant") return approvals;

  for (const part of last.parts) {
    if (!isToolUIPart(part) || part.state !== "output-available") continue;
    if (!WRITE_TOOLS.has(getToolName(part)) || part.approval?.approved === true) continue;
    for (const key of writtenKeysOf(part.input, part.output)) approvals.written.add(key);
  }

  return approvals;
}
