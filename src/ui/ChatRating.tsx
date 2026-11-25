"use client";

import { Star, X } from "lucide-react";
import { Button, Textarea } from "./components/primitives.js";
import { cn } from "./lib/cn.js";
import React, { useState, useEffect, useCallback } from "react";
import { useApiRoute } from "./routes.js";

const MAX_COMMENT_LENGTH = 2000;

interface SavedRating {
  rating: number;
  comment: string | null;
}

function useRating(conversationId: string) {
  const apiRoute = useApiRoute();
  const [phase, setPhase] = useState<"loading" | "open" | "submitting" | "rated" | "hidden">(
    "loading"
  );
  const [hoverStar, setHoverStar] = useState(0);
  const [picked, setPicked] = useState(0);
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState<SavedRating | null>(null);

  useEffect(() => {
    let cancelled = false;

    // oxlint-disable-next-line react/set-state-in-effect
    setPhase("loading");
    setPicked(0);
    setComment("");

    const load = async () => {
      try {
        const response = await fetch(
          `${apiRoute}/content-agent/rating?conversationId=${encodeURIComponent(conversationId)}`
        );
        const data = response.ok ? await response.json() : { rating: null };

        if (cancelled) return;

        if (data?.rating) {
          setSaved(data.rating);
          setPhase("rated");
        } else {
          setPhase("open");
        }
      } catch {
        if (!cancelled) setPhase("open");
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [conversationId, apiRoute]);

  const submit = useCallback(async () => {
    if (!picked) return;
    setPhase("submitting");

    try {
      const res = await fetch(`${apiRoute}/content-agent/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          rating: picked,
          comment: comment.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data) {
        setSaved({
          rating: data.rating ?? picked,
          comment: data.comment ?? (comment.trim() || null),
        });
        setPhase("rated");
      } else {
        setPhase("open");
      }
    } catch {
      setPhase("open");
    }
  }, [apiRoute, conversationId, picked, comment]);

  return {
    phase,
    setPhase,
    hoverStar,
    setHoverStar,
    picked,
    setPicked,
    comment,
    setComment,
    saved,
    submit,
  };
}

const STAR_VALUES = [1, 2, 3, 4, 5];

export function Stars({
  value,
  onHover,
  onPick,
  readOnly,
}: {
  value: number;
  onHover?: (stars: number) => void;
  onPick?: (stars: number) => void;
  readOnly?: boolean;
}) {
  const starClass = (stars: number) =>
    cn("size-3.5", stars <= value ? "fill-ca-warn text-ca-warn" : "text-ca-border-strong");

  if (readOnly)
    return (
      <span className="flex gap-0.5">
        <span className="sr-only">{`${value} of 5 stars`}</span>
        {STAR_VALUES.map((stars) => (
          <Star key={stars} aria-hidden className={starClass(stars)} />
        ))}
      </span>
    );

  return (
    <div className="flex gap-0.5">
      {STAR_VALUES.map((stars) => (
        <button
          key={stars}
          type="button"
          aria-label={`${stars} of 5 stars`}
          onMouseEnter={() => onHover?.(stars)}
          onMouseLeave={() => onHover?.(0)}
          onFocus={() => onHover?.(stars)}
          onBlur={() => onHover?.(0)}
          onClick={() => onPick?.(stars)}
          className="flex cursor-pointer border-0 bg-transparent p-0"
        >
          <Star aria-hidden className={starClass(stars)} />
        </button>
      ))}
    </div>
  );
}

export function ChatRating({
  conversationId,
  hasReply,
}: {
  conversationId: string;
  hasReply: boolean;
}) {
  const rating = useRating(conversationId);
  const { phase, setPhase, hoverStar, setHoverStar, picked, setPicked } = rating;
  const { comment, setComment, saved, submit } = rating;

  if (phase === "loading" || phase === "hidden" || !hasReply) return null;

  if (phase === "rated" && saved) {
    return (
      <div className="border-ca-border text-2xs text-ca-faint flex shrink-0 items-center gap-1.5 border-t px-3 py-1">
        <span>Thanks for the rating:</span>
        <Stars value={saved.rating} readOnly />
      </div>
    );
  }

  return (
    <div className="border-ca-border text-2xs text-ca-muted flex shrink-0 flex-col gap-1.5 border-t px-3 py-1.5">
      <div className="flex items-center gap-2">
        <span>Rate the agent&apos;s responses:</span>
        <Stars value={hoverStar || picked} onHover={setHoverStar} onPick={setPicked} />
        <button
          type="button"
          onClick={() => setPhase("hidden")}
          title="Hide"
          className="text-ca-faint hover:text-ca-fg ml-auto cursor-pointer border-0 bg-transparent p-0.5"
        >
          <X className="size-3" />
        </button>
      </div>
      {picked > 0 && (
        <div className="flex items-start gap-1.5">
          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, MAX_COMMENT_LENGTH))}
            placeholder="What didn't work? (optional)"
            rows={2}
            className="text-2xs flex-1 px-1.5 py-1"
          />
          <Button size="sm" onClick={submit} disabled={phase === "submitting"} className="shrink-0">
            {phase === "submitting" ? "…" : "Submit"}
          </Button>
        </div>
      )}
    </div>
  );
}
