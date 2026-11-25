"use client";

import { ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "../lib/cn.js";
import { isRecord, recordsOf, stringOf, textOf } from "../lib/narrow.js";
import React from "react";
import type { EditedRef } from "../ReviewContext.js";
import { adminDocHref } from "../routes.js";
import type { DiffState } from "../useReviewPanel.js";
import { FieldDiffRow } from "./reviewDiff.js";
import { RowBadges, RowIssues } from "./reviewSummary.js";
import type { DocumentSummary } from "./reviewSummary.js";

// Spelled out, never computed: Tailwind finds classes by scanning the source.
const STATUS_CLASS: Record<string, string> = {
  draft: "text-ca-warn",
  changed: "text-ca-accent",
  published: "text-ca-ok",
};

function Spinner() {
  return <Loader2 className="text-ca-muted size-3 shrink-0 animate-spin" aria-hidden />;
}

interface RowStatusProps {
  isPublished: boolean;
  isDiscarded: boolean;
  diffStatus?: string;
}

function RowStatus({ isPublished, isDiscarded, diffStatus }: RowStatusProps) {
  return isDiscarded ? (
    <span className="text-2xs text-ca-muted font-semibold">discarded</span>
  ) : isPublished ? (
    <span className="text-2xs text-ca-ok font-semibold">✓ published</span>
  ) : diffStatus ? (
    <span className={cn("text-2xs font-semibold", STATUS_CLASS[diffStatus] ?? "text-ca-muted")}>
      {diffStatus}
    </span>
  ) : null;
}

function RowDiff({ state }: { state: DiffState | undefined }) {
  const diff = isRecord(state?.diff) ? state.diff : undefined;
  const diffFields = recordsOf(diff?.fields);
  const hasChanges = diffFields.length > 0;

  return (
    <div className="border-ca-border border-t px-2.5 pb-2">
      {(!state || state.status === "loading") && (
        <div className="text-2xs text-ca-muted flex items-center gap-1.5 py-1.5">
          <Spinner /> Loading diff…
        </div>
      )}
      {state?.status === "error" && (
        <div className="text-2xs text-ca-danger py-1.5">{state.error}</div>
      )}
      {state?.status === "loaded" && !hasChanges && (
        <div className="text-2xs text-ca-muted py-1.5">No content changes.</div>
      )}
      {state?.status === "loaded" && hasChanges && state.scope === "published" && (
        <div className="border-ca-warn/30 bg-ca-warn/10 text-2xs text-ca-warn my-1.5 rounded border px-1.5 py-1">
          ⚠ No session snapshot for this edit - showing ALL unpublished changes vs published (not
          just this session).
        </div>
      )}
      {state?.status === "loaded" &&
        hasChanges &&
        diffFields.map((field) => <FieldDiffRow key={textOf(field.name)} field={field} />)}
    </div>
  );
}

interface ReviewRowProps {
  editedRef: EditedRef;
  /** What the server knows about the change: issues, declared outcome, the pattern. */
  info?: DocumentSummary;
  rowKey: string;
  state: DiffState | undefined;
  isSelected: boolean;
  isPublished: boolean;
  /** The changes of this conversation were discarded: nothing is left to publish or discard. */
  isDiscarded: boolean;
  isOpen: boolean;
  adminRoute: string;
  toggleSelect: (key: string) => void;
  toggleExpand: (ref: EditedRef) => void;
}

export function ReviewRow(props: ReviewRowProps) {
  const { editedRef: ref, rowKey: key, state, isSelected, isPublished, isOpen } = props;
  const { adminRoute, toggleSelect, toggleExpand, info, isDiscarded } = props;
  const isSettled = isPublished || isDiscarded;
  const diff = isRecord(state?.diff) ? state.diff : undefined;
  const diffStatus = stringOf(diff?.status);

  return (
    <div className={cn("border-ca-border mb-2 rounded-lg border", isSettled && "opacity-55")}>
      <div className="flex items-center gap-2 px-2.5 py-2 select-none">
        <input
          type="checkbox"
          checked={isSelected && !isSettled}
          disabled={isSettled}
          onChange={() => toggleSelect(key)}
        />
        <button
          type="button"
          onClick={() => toggleExpand(ref)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left"
        >
          <ChevronRight
            className={cn(
              "text-ca-faint size-3 shrink-0 transition-transform",
              isOpen && "rotate-90"
            )}
          />
          <span
            className="text-ca-fg flex-1 truncate text-xs font-semibold"
            title={`${ref.collection} / ${ref.id}`}
          >
            {textOf(diff?.title) || `${ref.collection} / ${ref.id}`}
          </span>
          <RowBadges info={info} />
          <RowStatus isPublished={isPublished} isDiscarded={isDiscarded} diffStatus={diffStatus} />
        </button>
        <a
          href={adminDocHref(ref.collection, ref.id, adminRoute)}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in admin"
          className="text-ca-faint hover:text-ca-fg shrink-0 no-underline"
        >
          <ExternalLink className="size-3" />
        </a>
      </div>
      {isOpen && <RowIssues info={info} />}
      {isOpen && <RowDiff state={state} />}
    </div>
  );
}
