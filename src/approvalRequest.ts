// What the chat asks the person. The server writes it into the reason of an approval request
// and the browser reads it back: this file stays free of server imports.

export interface ApprovalDocument {
  id: string | number;
  title?: string;
}

interface ManyDocuments {
  collection: string;
  count: number;
  /** The first documents of the run, for the person to recognise it. */
  documents: ApprovalDocument[];
}

/** A collection or global without drafts, and the one document of the call when it names one. */
export interface LiveTarget {
  collection?: string;
  global?: string;
  document?: ApprovalDocument;
}

/** The target has no drafts: the change is live at once. */
interface LiveNotice {
  live?: boolean;
}

export type ApprovalRequest = LiveNotice &
  (
    | ({ kind: "edit"; instruction: string } & ManyDocuments)
    | ({ kind: "replace"; find: string; replace: string } & ManyDocuments)
    | ({ kind: "translate"; from?: string; to: string } & ManyDocuments)
    | {
        kind: "risky-update";
        collection?: string;
        global?: string;
        document?: ApprovalDocument;
        /** One sentence for each thing the update removes. */
        effects: string[];
      }
    | ({ kind: "live-write" } & LiveTarget)
    /** The request already wrote or tried to write `changed` documents: one more needs a yes. */
    | ({ kind: "more-documents"; changed: number } & LiveTarget)
  );

export const APPROVAL_DOCUMENTS_SHOWN = 5;

const KINDS = new Set([
  "edit",
  "replace",
  "translate",
  "risky-update",
  "live-write",
  "more-documents",
]);

const namesTarget = (value: Record<string, unknown>): boolean =>
  typeof value.collection === "string" || typeof value.global === "string";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asRequest = (value: Record<string, unknown>) => value as unknown as ApprovalRequest;

export const approvalReason = (request: ApprovalRequest): string => JSON.stringify(request);

/** Null for a reason that is plain text: the chat then shows the text as it is. */
export function parseApprovalRequest(reason: string | undefined): ApprovalRequest | null {
  if (!reason?.startsWith("{")) return null;

  try {
    const parsed: unknown = JSON.parse(reason);

    if (!isRecord(parsed) || typeof parsed.kind !== "string" || !KINDS.has(parsed.kind))
      return null;
    if (parsed.kind === "risky-update")
      return Array.isArray(parsed.effects) ? asRequest(parsed) : null;
    if (parsed.kind === "live-write") return namesTarget(parsed) ? asRequest(parsed) : null;
    if (parsed.kind === "more-documents")
      return namesTarget(parsed) && typeof parsed.changed === "number" ? asRequest(parsed) : null;

    return typeof parsed.count === "number" && Array.isArray(parsed.documents)
      ? asRequest(parsed)
      : null;
  } catch {
    return null;
  }
}

/** The same request with the notice that its target has no drafts. */
export function withLiveNotice(reason: string): string {
  const request = parseApprovalRequest(reason);

  return request ? approvalReason({ ...request, live: true }) : reason;
}
