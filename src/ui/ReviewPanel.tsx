"use client";

import { Loader2, X } from "lucide-react";
import { Button } from "./components/primitives.js";
import { ReviewRow } from "./components/reviewRow.js";
import { ReviewSummary } from "./components/reviewSummary.js";
import type { ReviewSummaryData } from "./components/reviewSummary.js";
import type { EditedRef } from "./ReviewContext.js";
import { cn } from "./lib/cn.js";
import { isRecord } from "./lib/narrow.js";
import React from "react";
import { useReview } from "./ReviewContext.js";
import { useFloatingWindow, ResizeHandles } from "./useFloatingWindow.js";
import { useAdminRoute, useApiRoute } from "./routes.js";
import { chosenRefs, useReviewPanelState } from "./useReviewPanel.js";
import { keyOf } from "./reviewUtils.js";
import type { DiscardState } from "./useReviewPanel.js";

function placeBesideChat(width: number, height: number) {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  let chatX: number | null = null;

  try {
    const raw = localStorage.getItem("content-agent-panel");

    if (raw) {
      const chat: unknown = JSON.parse(raw);

      if (isRecord(chat) && typeof chat.x === "number") chatX = chat.x;
    }
  } catch {}

  const leftEdge = chatX ?? window.innerWidth - 440 - 24;

  return {
    x: Math.max(16, leftEdge - width - 16),
    y: window.innerHeight - height - 24,
  };
}

/**
 * The order of the summary: open issues first, then the documents that differ. A document the
 * summary leaves out, such as a discarded one, comes last.
 */
export function inSummaryOrder(refs: EditedRef[], summary: ReviewSummaryData | null) {
  const infoByKey = new Map(
    (summary?.documents ?? []).map((document, index) => [keyOf(document), { document, index }])
  );
  const place = (ref: EditedRef) => infoByKey.get(keyOf(ref))?.index ?? Number.MAX_SAFE_INTEGER;
  const ordered = refs
    .map((ref, index) => ({ ref, index }))
    .sort((a, b) => place(a.ref) - place(b.ref) || a.index - b.index)
    .map(({ ref }) => ref);

  return { ordered, infoOf: (ref: EditedRef) => infoByKey.get(keyOf(ref))?.document };
}

function ReviewHeader({
  count,
  onDragStart,
  setOpen,
}: {
  count: number;
  onDragStart: (event: React.MouseEvent) => void;
  setOpen: (value: boolean) => void;
}) {
  return (
    <div
      role="presentation"
      onMouseDown={onDragStart}
      className="border-ca-border flex shrink-0 cursor-grab items-center justify-between border-b px-3.5 py-2.5 select-none active:cursor-grabbing"
    >
      <div className="text-ca-fg text-sm font-semibold">
        Review changes <span className="text-ca-muted font-normal">({count})</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(false)}
        title="Close"
        aria-label="Close"
      >
        <X />
      </Button>
    </div>
  );
}

interface FooterProps {
  publish: () => void;
  publishing: boolean;
  publishMsg: string;
  counts: { selected: number; selectable: number };
  discard: DiscardState;
  askDiscard: (asking: boolean) => void;
  discardSelected: () => void;
  discardChangedSince: () => void;
}

function DiscardConfirm({ counts, askDiscard, discardSelected }: FooterProps) {
  return (
    <div className="border-ca-border flex items-center gap-2.5 border-t px-3.5 py-2.5">
      <span className="text-ca-fg flex-1 text-xs">
        Discard the agent&apos;s changes in {counts.selected}{" "}
        {counts.selected === 1 ? "document" : "documents"}? Each goes back to its state from before
        this conversation, as a draft.
      </span>
      <Button variant="danger" onClick={discardSelected}>
        Discard
      </Button>
      <Button variant="ghost" onClick={() => askDiscard(false)}>
        Cancel
      </Button>
    </div>
  );
}

function ReviewFooter(props: FooterProps) {
  const { publish, publishing, publishMsg, counts, discard, askDiscard } = props;
  const { discardChangedSince } = props;
  const busy = publishing || discard.phase === "running";
  const message = discard.message || publishMsg;
  const failed = discard.message ? discard.failed : publishMsg.includes("failed");

  if (discard.phase === "confirm") return <DiscardConfirm {...props} />;

  return (
    <div className="border-ca-border flex flex-wrap items-center gap-2.5 border-t px-3.5 py-2.5">
      <Button size="lg" onClick={publish} disabled={busy || counts.selected === 0}>
        {publishing ? <Loader2 className="animate-spin" /> : null}
        {publishing ? "Publishing…" : `Publish ${counts.selected || ""}`.trim()}
      </Button>
      <Button
        variant="ghost"
        size="lg"
        onClick={() => askDiscard(true)}
        disabled={busy || counts.selected === 0}
      >
        {discard.phase === "running" ? <Loader2 className="animate-spin" /> : null}
        {discard.phase === "running" ? "Discarding…" : "Discard"}
      </Button>
      <span className={cn("text-2xs", failed ? "text-ca-danger" : "text-ca-muted")}>
        {message || `${counts.selected}/${counts.selectable} selected`}
      </span>
      {discard.changedSince.length > 0 && (
        <Button variant="ghost" onClick={discardChangedSince} disabled={busy}>
          Discard those too
        </Button>
      )}
    </div>
  );
}

export function ReviewPanel() {
  const { refs, summary, open, setOpen, conversationId, editVersions } = useReview();
  const { refresh, discardedKeys } = useReview();
  const adminRoute = useAdminRoute();
  const apiRoute = useApiRoute();
  const { panel, z, bringToFront, onDragStart, onResizeStart } = useFloatingWindow({
    storageKey: "content-agent-review-panel",
    width: 460,
    height: 640,
    minWidth: 360,
    minHeight: 420,
    place: placeBesideChat,
  });
  const { view, toggleSelect, toggleExpand, publish, discardRefs, askDiscard } =
    useReviewPanelState({ refs, conversationId, editVersions, refresh }, apiRoute);
  const { diffs, selected, expanded, publishedKeys } = view;

  if (!open) return null;

  const { ordered, infoOf } = inSummaryOrder(refs, summary);
  const selectable = refs.filter(
    (ref) => !publishedKeys.has(keyOf(ref)) && !discardedKeys.has(keyOf(ref))
  );
  const chosen = chosenRefs(refs, { selected, publishedKeys, discardedKeys });

  return (
    <div
      role="presentation"
      onMouseDown={bringToFront}
      style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height, zIndex: z }}
      className="border-ca-border bg-ca-bg fixed flex flex-col overflow-hidden rounded-xl border shadow-2xl"
    >
      <ReviewHeader count={refs.length} onDragStart={onDragStart} setOpen={setOpen} />

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {refs.length === 0 && (
          <div className="text-ca-muted mt-10 text-center text-xs">
            No changes yet. Ask the agent to edit or translate documents, then review them here.
          </div>
        )}
        <ReviewSummary summary={summary} />
        {ordered.map((ref) => {
          const key = keyOf(ref);

          return (
            <ReviewRow
              key={key}
              editedRef={ref}
              info={infoOf(ref)}
              rowKey={key}
              state={diffs[key]}
              isSelected={selected.has(key)}
              isPublished={publishedKeys.has(key)}
              isDiscarded={discardedKeys.has(key)}
              isOpen={expanded.has(key)}
              adminRoute={adminRoute}
              toggleSelect={toggleSelect}
              toggleExpand={toggleExpand}
            />
          );
        })}
      </div>

      <ReviewFooter
        publish={() => publish(chosen)}
        publishing={view.publishing}
        publishMsg={view.publishMsg}
        counts={{ selected: chosen.length, selectable: selectable.length }}
        discard={view.discard}
        askDiscard={askDiscard}
        discardSelected={() => discardRefs(chosen, false)}
        discardChangedSince={() => discardRefs(view.discard.changedSince, true)}
      />

      <ResizeHandles onResizeStart={onResizeStart} />
    </div>
  );
}
