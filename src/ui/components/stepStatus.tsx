"use client";

import React from "react";
import { Ban, ChevronDown, CircleAlert, ExternalLink } from "lucide-react";
import { AgentGlyph } from "./agentGlyph.js";
import { activityLabel, activityTarget } from "../turnStatus.js";
import { cn } from "../lib/cn.js";
import type { Text } from "../lib/narrow.js";
import { adminDocHref, useAdminRoute } from "../routes.js";

export function ProgressIcon({ live }: { live: boolean }) {
  return live ? (
    <AgentGlyph active size={12} />
  ) : (
    <Ban className="text-ca-warn size-3 shrink-0" aria-label="Stopped" />
  );
}

function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = React.useState(0);

  React.useEffect(() => {
    if (!active) return;
    const start = Date.now();

    // oxlint-disable-next-line react/set-state-in-effect
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);

    return () => clearInterval(timer);
  }, [active]);

  return seconds;
}

function ActivityLine({ label, target }: { label: string; target?: string }) {
  const seconds = useElapsedSeconds(true);

  return (
    <div className="text-ca-muted my-1.5 flex min-h-6 items-center gap-2 text-xs">
      <AgentGlyph active />
      <span className="ca-shimmer-text animate-ca-shimmer font-medium">{label}…</span>
      {target && <span className="text-ca-faint">{target}</span>}
      {seconds > 0 && <span className="text-2xs text-ca-faint tabular-nums">{seconds}s</span>}
    </div>
  );
}

export function ThinkingLine() {
  return <ActivityLine label="Thinking" />;
}

export function RunningStep({ toolName, input }: { toolName: string; input?: unknown }) {
  return <ActivityLine label={activityLabel(toolName)} target={activityTarget(input)} />;
}

export function FailedStep({ label, error }: { label: string; error: string }) {
  return (
    <details className="group my-1.5">
      <summary className="text-ca-muted hover:text-ca-fg flex min-h-6 cursor-pointer list-none items-center gap-2 text-xs transition-colors [&::-webkit-details-marker]:hidden">
        <CircleAlert className="text-ca-warn size-3.5 shrink-0" aria-hidden />
        <span>{label}</span>
        <span className="bg-ca-warn/10 text-2xs text-ca-warn rounded-full px-1.5">failed</span>
        <ChevronDown
          className="size-3.5 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-ca-border text-2xs text-ca-muted mt-1.5 border-l-2 pl-3 leading-relaxed">
        {error}
      </div>
    </details>
  );
}

export function InterruptedStep({ toolName }: { toolName: string }) {
  return (
    <div className="border-ca-warn/30 bg-ca-warn/10 text-ca-fg my-2 flex items-center gap-2 rounded-[10px] border px-3 py-2 text-xs">
      <Ban className="text-ca-warn size-3 shrink-0" aria-hidden />
      <span>
        {activityLabel(toolName)}{" "}
        <span className="text-ca-muted">- stopped before it finished, nothing was done</span>
      </span>
    </div>
  );
}

export function StatusDot({ status }: { status?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        status === "approved" || status === "trimmed" || status === "done"
          ? "bg-ca-ok"
          : status === "rejected"
            ? "bg-ca-warn"
            : status === "error"
              ? "bg-ca-danger"
              : "bg-ca-faint"
      )}
    />
  );
}

export function CmsLink({
  collection,
  id,
  label,
}: {
  collection: string;
  id?: Text;
  label?: string;
}) {
  const adminRoute = useAdminRoute();

  return (
    <a
      href={adminDocHref(collection, id, adminRoute)}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-ca-fg text-2xs text-ca-bg inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-0.5 font-semibold no-underline transition-opacity hover:opacity-80"
    >
      <ExternalLink className="size-2.5" />
      {label || "Open in CMS"}
    </a>
  );
}
