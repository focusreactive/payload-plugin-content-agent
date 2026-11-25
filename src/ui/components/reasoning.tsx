"use client";

/**
 * The model's reasoning: one line per reply that says "Thinking…" with the step the model is on
 * while it thinks, and "Thought for N seconds" after, counted over every step of the reply.
 * A click opens the full summary.
 *
 * Adapted from the Reasoning component of AI Elements (https://github.com/vercel/ai-elements),
 * Copyright 2023 Vercel, Inc., licensed under the Apache License, Version 2.0
 * (https://www.apache.org/licenses/LICENSE-2.0). Changes from the original: the native
 * <details> element replaces the Radix Collapsible, the plugin's CSS shimmer replaces the
 * motion-based Shimmer, react-markdown replaces Streamdown, the plugin's theme tokens replace
 * the shadcn ones, the agent loader replaces the brain icon, and the block stays closed while it
 * streams, showing the latest heading of the summary on its one line instead. AI Elements opens
 * the block while it streams and closes it after; with a block per step, that made the reply
 * grow and shrink with every step.
 *
 * Behaviour kept from AI Elements: the duration is measured on the client (the AI SDK does not
 * report it).
 */

import React, { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { ChevronDown } from "lucide-react";
import { REMOTE_ELEMENTS } from "../lib/markdownSafety.js";
import { AgentGlyph } from "./agentGlyph.js";

function reasoningLabel(isStreaming: boolean, duration: number | undefined): string {
  if (isStreaming || duration === 0) return "Thinking…";
  if (duration === undefined) return "Thought for a few seconds";

  return `Thought for ${duration} second${duration === 1 ? "" : "s"}`;
}

function latestHeading(text: string): string {
  const headings = [...text.matchAll(/\*\*([^*\n]+)\*\*/gu)];

  if (headings.length) return headings[headings.length - 1][1].trim();
  const lines = text
    .split("\n")
    .map((line) => line.replace(/[*_#`>]/gu, "").trim())
    .filter(Boolean);

  return lines[lines.length - 1] ?? "";
}

export function Reasoning({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const startedAt = useRef<number | null>(null);
  const thoughtMs = useRef(0);

  useEffect(() => {
    if (isStreaming) {
      if (startedAt.current === null) startedAt.current = Date.now();
    } else if (startedAt.current !== null) {
      thoughtMs.current += Date.now() - startedAt.current;
      setDuration(Math.ceil(thoughtMs.current / 1000));
      startedAt.current = null;
    }
  }, [isStreaming]);

  const hasText = text.trim().length > 0;

  if (!hasText && !isStreaming && duration === undefined) return null;

  const preview = isStreaming && hasText ? latestHeading(text) : "";
  const header = (
    <>
      {isStreaming && <AgentGlyph active />}
      <span
        className={
          isStreaming ? "ca-shimmer-text animate-ca-shimmer shrink-0 font-medium" : "shrink-0"
        }
      >
        {reasoningLabel(isStreaming, duration)}
      </span>
      {preview && <span className="text-ca-faint min-w-0 truncate">{preview}</span>}
    </>
  );

  if (!hasText)
    return (
      <div className="text-ca-muted my-1.5 flex min-h-6 items-center gap-2 text-xs">{header}</div>
    );

  return (
    <details className="group my-1.5">
      <summary className="text-ca-muted hover:text-ca-fg flex min-h-6 min-w-0 cursor-pointer list-none items-center gap-2 text-xs transition-colors [&::-webkit-details-marker]:hidden">
        {header}
        <ChevronDown
          className="size-3.5 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-ca-border text-ca-muted mt-1.5 border-l-2 pl-3 text-xs leading-relaxed [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1">
        <Markdown disallowedElements={REMOTE_ELEMENTS}>{text}</Markdown>
      </div>
    </details>
  );
}
