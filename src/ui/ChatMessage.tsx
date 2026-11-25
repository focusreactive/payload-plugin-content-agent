"use client";

import React from "react";
import type { UIMessage } from "ai";
import { FileText } from "lucide-react";
import { groupParts } from "./components/messageParts.js";
import { ThinkingLine } from "./components/stepStatus.js";
import { cn } from "./lib/cn.js";

function AttachmentChip({
  filename,
  mediaType,
  url,
}: {
  filename?: string;
  mediaType?: string;
  url?: string;
}) {
  const name = filename || "attachment";

  if (mediaType?.startsWith("image/") && url) {
    return (
      <img
        src={url}
        alt={name}
        className="border-ca-border mt-1.5 block max-h-45 max-w-full rounded-lg border object-contain"
      />
    );
  }

  return (
    <span className="border-ca-border bg-ca-bg text-2xs text-ca-fg mt-1.5 mr-1.5 inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5">
      <FileText className="size-3" aria-hidden />
      {name}
    </span>
  );
}

export function ChatMessage({
  message,
  live = false,
  thinking = false,
}: {
  message: UIMessage;
  live?: boolean;
  thinking?: boolean;
}) {
  // @ai-sdk/react mutates a streaming message's tool parts in place, so a host React Compiler would
  // memoize this render on the stable reference and freeze a tool card on its first state.
  "use no memo";
  const isUser = message.role === "user";

  const parts = message.parts ?? [];
  const lastOpsIndexById = new Map<string, number>();
  let lastIdlessOpsIndex = -1;

  parts.forEach((part, idx) => {
    if (part.type === "data-content-ops") {
      if (part.id) lastOpsIndexById.set(part.id, idx);
      else lastIdlessOpsIndex = idx;
    }
  });

  const shouldRenderOps = (idx: number): boolean => {
    const part = parts[idx];
    const opsId = part.type === "data-content-ops" ? part.id : undefined;

    return opsId ? lastOpsIndexById.get(opsId) === idx : idx === lastIdlessOpsIndex;
  };

  const agentParts = isUser ? null : groupParts(parts, shouldRenderOps, live);

  if (agentParts && agentParts.length === 0 && !thinking) return null;

  return (
    <div className={cn("mb-3 flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "rounded-2xl px-4 py-3 text-sm leading-relaxed break-words",
          isUser
            ? "bg-ca-fg text-ca-bg max-w-[85%] rounded-br-sm whitespace-pre-wrap"
            : "border-ca-border bg-ca-surface text-ca-fg w-full min-w-0 rounded-bl-sm border"
        )}
      >
        <div className="text-2xs mb-1 font-bold tracking-wider uppercase opacity-50">
          {isUser ? "You" : "Agent"}
        </div>
        {isUser
          ? message.parts?.map((part, i) =>
              part.type === "text" ? (
                <span key={i}>{part.text}</span>
              ) : part.type === "file" ? (
                <AttachmentChip
                  key={i}
                  filename={part.filename}
                  mediaType={part.mediaType}
                  url={part.url}
                />
              ) : null
            )
          : agentParts}
        {thinking && <ThinkingLine />}
      </div>
    </div>
  );
}
