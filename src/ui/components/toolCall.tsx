"use client";

import React from "react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { Settings2 } from "lucide-react";
import { AgentGlyph } from "./agentGlyph.js";
import { toolPhase } from "../turnStatus.js";
import { cn } from "../lib/cn.js";
import { isRecord, isText, listOf, numberOf, stringOf, textOf } from "../lib/narrow.js";
import { adminDocHref, useAdminRoute } from "../routes.js";
import { CmsLink, FailedStep, InterruptedStep, RunningStep, StatusDot } from "./stepStatus.js";

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export const outputFieldsOf = (output: unknown): Record<string, unknown> | undefined =>
  isRecord(output) ? output : undefined;

export const hasFailed = (part: ToolPart): boolean =>
  Boolean(part.errorText || outputFieldsOf(part.output)?.error);

export function GroupedToolCalls({ toolName, calls }: { toolName: string; calls: ToolPart[] }) {
  const label = toolName
    .replace(/([A-Z])/gu, " $1")
    .replace(/^./u, (letter) => letter.toUpperCase())
    .trim();
  const errors = calls.filter(hasFailed);
  const hasErrors = errors.length > 0;

  return (
    <div
      className={cn(
        "my-2 flex items-center gap-2 rounded-[10px] px-3 py-2 text-xs",
        hasErrors ? "border-ca-warn/30 bg-ca-warn/10 border" : "bg-ca-surface"
      )}
    >
      <StatusDot status={hasErrors ? "error" : "approved"} />
      <span className="font-semibold">{label}</span>
      <span className="text-ca-muted">
        {calls.length}x completed
        {hasErrors ? `, ${errors.length} error${errors.length > 1 ? "s" : ""}` : ""}
      </span>
    </div>
  );
}

export function ServiceSteps({ count, pending }: { count: number; pending: boolean }) {
  return (
    <div className="text-2xs text-ca-faint my-1.5 flex min-h-6 items-center gap-2">
      {pending ? (
        <AgentGlyph active />
      ) : (
        <Settings2 className="size-3.5 shrink-0 opacity-70" aria-hidden />
      )}
      <span>{pending ? "Working…" : `${count} background step${count > 1 ? "s" : ""}`}</span>
    </div>
  );
}

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function isEditTool(toolName: string): boolean {
  return ["editContent", "findReplaceContent", "translateContent"].includes(toolName);
}

interface DocList {
  collection: string | undefined;
  titleField: string | undefined;
  adminRoute: string;
}

function docRow(entry: unknown, i: number, { collection, titleField, adminRoute }: DocList) {
  const doc = isRecord(entry) ? entry : {};
  const docCollection = stringOf(doc.collection);
  const docId = textOf(doc.id);
  const rowCollection = docCollection ?? collection;
  const row = (
    <>
      <span className="max-w-[70%] truncate font-medium">
        {asText((titleField ? doc[titleField] : undefined) || doc.title || doc.id)}
        {docCollection && <span className="text-ca-muted ml-1.5 font-normal">{docCollection}</span>}
      </span>
      <span className="text-2xs text-ca-faint font-mono">{docId}</span>
    </>
  );
  const rowClass =
    "flex items-center justify-between border-b border-ca-border px-3 py-1 text-xs last:border-0";

  return rowCollection && docId ? (
    <a
      key={`${rowCollection}-${docId || i}`}
      href={adminDocHref(rowCollection, docId, adminRoute)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(rowClass, "hover:bg-ca-surface cursor-pointer text-inherit no-underline")}
    >
      {row}
    </a>
  ) : (
    <div key={docId || i} className={rowClass}>
      {row}
    </div>
  );
}

function DocsResult({
  label,
  output,
  docs,
  adminRoute,
}: {
  label: string;
  output: Record<string, unknown>;
  docs: unknown[];
  adminRoute: string;
}) {
  const collection = stringOf(output.collection);
  const list = { collection, titleField: stringOf(output.titleField), adminRoute };
  const searchedCount = listOf(output.searched).length;
  const scope = collection || (searchedCount > 0 ? `${searchedCount} collections` : undefined);

  return (
    <div className="border-ca-border my-2 overflow-hidden rounded-[10px] border">
      <div className="border-ca-border bg-ca-surface text-2xs text-ca-muted flex justify-between border-b px-3 py-1.5 font-semibold">
        <span>
          {label}
          {scope && <span className="ml-1.5 font-normal">· {scope}</span>}
        </span>
        <span>{textOf(output.totalDocs)} found</span>
      </div>
      <div className="max-h-45 overflow-y-auto">
        {docs.map((entry, i) => docRow(entry, i, list))}
      </div>
    </div>
  );
}

function CountResult({ label, output }: { label: string; output: Record<string, unknown> }) {
  const errors = numberOf(output.errorCount) ?? 0;
  const ids = listOf(output.updatedIds || output.createdIds).filter(isText);
  const collection = stringOf(output.collection);

  return (
    <div
      className={cn(
        "my-2 rounded-[10px] border px-3 py-2 text-xs",
        errors > 0
          ? "border-ca-warn/30 bg-ca-warn/10 text-ca-warn"
          : "border-ca-ok/30 bg-ca-ok/10 text-ca-ok"
      )}
    >
      <div className="font-semibold">{stringOf(output.message) || label}</div>
      {errors > 0 && (
        <div className="text-ca-danger mt-1">
          {errors} error{errors > 1 ? "s" : ""}
        </div>
      )}
      {collection && ids.length > 0 && ids.length <= 5 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {ids.map((id) => (
            <CmsLink key={id} collection={collection} id={id} />
          ))}
        </div>
      )}
      {collection && ids.length > 5 && (
        <div className="mt-1.5">
          <CmsLink collection={collection} label={`View all in ${collection}`} />
        </div>
      )}
    </div>
  );
}

function CreatedResult({ label, output }: { label: string; output: Record<string, unknown> }) {
  const collection = stringOf(output.collection);

  return (
    <div className="border-ca-ok/30 bg-ca-ok/10 text-ca-ok my-2 rounded-[10px] border px-3 py-2 text-xs">
      <div>{stringOf(output.message) || `${label}: ${output.id}`}</div>
      {collection && (
        <div className="mt-1.5">
          <CmsLink collection={collection} id={textOf(output.id)} />
        </div>
      )}
    </div>
  );
}

/** One document that a tool read or looked at: a quiet line with its name and a link. */
function DocumentStep({
  label,
  output,
  adminRoute,
}: {
  label: string;
  output: Record<string, unknown>;
  adminRoute: string;
}) {
  const collection = stringOf(output.collection);
  const id = textOf(output.id);
  const name = stringOf(output.title) ?? stringOf(output.filename) ?? stringOf(output.name);
  const target = collection ? `${collection}/${id}` : id;

  return (
    <div className="text-ca-muted my-1.5 flex min-h-6 items-center gap-2 text-xs">
      <AgentGlyph active={false} />
      <span>{label}</span>
      {collection ? (
        <a
          href={adminDocHref(collection, id, adminRoute)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ca-muted truncate hover:underline"
        >
          {name ? `${name} · ${target}` : target}
        </a>
      ) : (
        <span className="truncate">{name ?? target}</span>
      )}
    </div>
  );
}

function toolResult(
  label: string,
  output: Record<string, unknown> | undefined,
  adminRoute: string
) {
  if (output?.docs && Array.isArray(output.docs))
    return <DocsResult label={label} output={output} docs={output.docs} adminRoute={adminRoute} />;

  if (output && (output.updatedCount !== undefined || output.createdCount !== undefined))
    return <CountResult label={label} output={output} />;

  // Only a write says `ok`: a read of one document also carries its id.
  if (output?.id && output.ok === true) return <CreatedResult label={label} output={output} />;
  if (output?.id) return <DocumentStep label={label} output={output} adminRoute={adminRoute} />;

  return (
    <div className="text-ca-muted my-1.5 flex min-h-6 items-center gap-2 text-xs">
      <AgentGlyph active={false} />
      <span>{label}</span>
    </div>
  );
}

function QuietStep({ label, note, warn }: { label: string; note: string; warn?: boolean }) {
  return (
    <div
      className={cn(
        "my-2 rounded-[10px] px-3 py-2 text-xs",
        warn ? "border-ca-warn/30 bg-ca-warn/10 border" : "bg-ca-surface"
      )}
    >
      <span className="font-semibold">{label}</span>
      <span className="text-ca-muted"> - {note}</span>
    </div>
  );
}

function EditStep({
  toolName,
  label,
  state,
  output,
  errorText,
  live,
  progressShown,
}: {
  toolName: string;
  label: string;
  state: string;
  output: ReturnType<typeof outputFieldsOf>;
  errorText?: string;
  live: boolean;
  progressShown: boolean;
}) {
  const phase = toolPhase({ state }, live);
  // A refusal before any progress card has nothing else that shows it. A call that waits for
  // the person or changed nothing is no failure.
  const waits =
    output?.writeStatus === "needs-confirmation" || output?.writeStatus === "nothing-changed";
  const failure = errorText || (progressShown || waits ? undefined : output?.error);

  if (failure) return <FailedStep label={label} error={asText(failure)} />;
  if (state === "output-available" || phase === "error") return null;
  if (phase === "interrupted") return <InterruptedStep toolName={toolName} />;

  return progressShown ? null : <RunningStep toolName={toolName} />;
}

export function ToolCallDisplay({
  toolName,
  state,
  input,
  result,
  errorText,
  live,
  progressShown = false,
}: {
  toolName: string;
  state: string;
  input?: unknown;
  result?: unknown;
  errorText?: string;
  live: boolean;
  progressShown?: boolean;
}) {
  const adminRoute = useAdminRoute();
  const output = outputFieldsOf(result);
  const label = toolName
    .replace(/([A-Z])/gu, " $1")
    .replace(/^./u, (letter) => letter.toUpperCase())
    .trim();

  if (isEditTool(toolName))
    return (
      <EditStep
        toolName={toolName}
        label={label}
        state={state}
        output={output}
        errorText={errorText}
        live={live}
        progressShown={progressShown}
      />
    );

  const isComplete = state === "output-available";

  if (!isComplete) {
    const phase = toolPhase({ state }, live);

    if (phase === "interrupted") return <InterruptedStep toolName={toolName} />;
    if (phase === "pending" || phase === "running")
      return <RunningStep toolName={toolName} input={input} />;
  }

  if (output?.writeStatus === "nothing-changed")
    return <QuietStep label={label} note="nothing changed" />;

  if (errorText || output?.error)
    return <FailedStep label={label} error={asText(errorText || output?.error)} />;

  if (output?.writeStatus === "live-write")
    return <QuietStep label={label} note="written to the live site, not a draft" warn />;

  return toolResult(label, output, adminRoute);
}
