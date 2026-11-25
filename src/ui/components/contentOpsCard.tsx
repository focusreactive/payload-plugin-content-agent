"use client";

import React from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "../lib/cn.js";
import { isRecord, isText, listOf, numberOf, recordsOf, stringOf, textOf } from "../lib/narrow.js";
import { adminDocHref, useAdminRoute } from "../routes.js";
import { CmsLink, ProgressIcon, StatusDot } from "./stepStatus.js";

interface BulkSection {
  data: Record<string, unknown>;
  collection: string | undefined;
  isDone: boolean;
  adminRoute: string;
}

function bulkLabel(isTranslate: boolean, isFindReplace: boolean, isDone: boolean): string {
  return isTranslate
    ? isDone
      ? "Translation Complete"
      : "Translating"
    : isFindReplace
      ? isDone
        ? "Replace Complete"
        : "Replacing"
      : isDone
        ? "Bulk Edit Complete"
        : "Bulk Editing";
}

function BulkProgress({
  data,
  collection,
}: {
  data: Record<string, unknown>;
  collection?: string;
}) {
  const total = numberOf(data.total);
  const completed = numberOf(data.completed) ?? 0;
  const currentId = textOf(data.currentId);
  const active = listOf(data.active);

  return (
    <>
      {total !== undefined && total > 0 && (
        <div className="bg-ca-border h-[3px]">
          <div
            className="bg-ca-fg h-full transition-[width] duration-300"
            style={{ width: `${Math.round((completed / total) * 100)}%` }}
          />
        </div>
      )}

      {(active.length > 0 || currentId !== undefined) && (
        <div className="text-2xs text-ca-muted animate-pulse px-3 py-1.5">
          {active.length > 1
            ? `Processing ${active.length} docs: ${active.map((activeId) => `#${activeId}`).join(", ")}`
            : `Processing ${collection}/${active[0] ?? currentId}…`}
        </div>
      )}
    </>
  );
}

function BulkResults({ data, collection, isDone, adminRoute }: BulkSection) {
  const results = recordsOf(data.results);

  if (results.length === 0) return null;

  return (
    <div className="max-h-40 overflow-y-auto">
      {results.map((result, i) => {
        const resultId = textOf(result.id);
        const resultStatus = stringOf(result.status);

        return (
          <a
            key={resultId === undefined ? `row-${i}` : `doc-${resultId}`}
            href={adminDocHref(collection ?? "", resultId, adminRoute)}
            target="_blank"
            rel="noopener noreferrer"
            className="border-ca-border text-2xs hover:bg-ca-surface flex cursor-pointer items-center gap-1.5 border-t px-3 py-1 text-inherit no-underline"
          >
            <StatusDot status={resultStatus} />
            <span className="text-ca-muted flex-1">
              {collection}/{resultId}
            </span>
            <span className="text-ca-faint">{resultStatus}</span>
            {isDone && <ExternalLink className="text-ca-faint size-2.5 shrink-0" />}
          </a>
        );
      })}
    </div>
  );
}

function BulkTotals({
  data,
  isFindReplace,
}: {
  data: Record<string, unknown>;
  isFindReplace: boolean;
}) {
  const completed = numberOf(data.completed) ?? 0;
  const rejected = numberOf(data.rejected) ?? 0;
  const errors = numberOf(data.errors) ?? 0;
  const skipped = numberOf(data.skipped) ?? 0;

  return (
    <div className="text-2xs text-ca-muted flex gap-3 px-3 py-1.5">
      {completed > 0 && (
        <span className="text-ca-ok">
          {completed} {isFindReplace ? "updated" : "approved"}
        </span>
      )}
      {rejected > 0 && <span className="text-ca-danger">{rejected} rejected</span>}
      {errors > 0 && <span className="text-ca-danger">{errors} errors</span>}
      {skipped > 0 && <span className="text-ca-muted">{skipped} unchanged</span>}
    </div>
  );
}

function bulkCount(isDone: boolean, completed: number, total: number | undefined): string {
  if (total === undefined) return isDone ? `${completed} docs` : `${completed}`;

  return isDone ? `${total} docs` : `${completed}/${total}`;
}

function BulkEditCard({ data, live }: { data: Record<string, unknown>; live: boolean }) {
  const adminRoute = useAdminRoute();
  const { op: operation, phase } = data;
  const collection = stringOf(data.collection);
  const total = numberOf(data.total);
  const completed = numberOf(data.completed) ?? 0;
  const rejected = numberOf(data.rejected) ?? 0;
  const errors = numberOf(data.errors) ?? 0;
  const isDone = phase === "done";
  const stopped = !isDone && !live;
  const isFindReplace = operation === "findReplace";
  const isTranslate = operation === "bulkTranslateContent";
  const hasErrors = errors > 0 || rejected > 0;
  const label = bulkLabel(isTranslate, isFindReplace, isDone);
  const title = stopped ? `${label} - stopped before it finished` : label;

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-[10px] border",
        isDone
          ? hasErrors
            ? "border-ca-warn/30 bg-ca-warn/10"
            : "border-ca-ok/30 bg-ca-ok/10"
          : "border-ca-border bg-ca-bg"
      )}
    >
      <div
        className={cn(
          "border-ca-border flex items-center justify-between border-b px-3 py-2",
          isDone ? "bg-transparent" : "bg-ca-surface"
        )}
      >
        <div className="flex items-center gap-2 text-xs font-semibold">
          {!isDone && <ProgressIcon live={live} />}
          <span>{title}</span>
          <span className="text-ca-muted font-normal">{collection}</span>
        </div>
        <span className="text-2xs text-ca-muted tabular-nums">
          {bulkCount(isDone, completed, total)}
        </span>
      </div>

      {!isDone && !stopped && <BulkProgress data={data} collection={collection} />}

      <BulkResults data={data} collection={collection} isDone={isDone} adminRoute={adminRoute} />

      {isDone && <BulkTotals data={data} isFindReplace={isFindReplace} />}
    </div>
  );
}

const WRITE_LABELS: Record<string, string> = {
  done: "saved as a draft",
  "needs-input": "question, nothing saved",
  "needs-confirmation": "waits for your confirmation",
  "nothing-changed": "nothing changed",
  "live-write": "written to the live site",
  failed: "nothing saved",
};

const writeLabel = (writeStatus: string | undefined, status: string | undefined): string =>
  status === "rejected"
    ? "rejected, nothing saved"
    : ((writeStatus && WRITE_LABELS[writeStatus]) ?? status ?? "");

function FactList({ title, items, more }: { title: string; items: string[]; more?: number }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-1.5">
      <div className="text-2xs text-ca-muted font-semibold">{title}</div>
      <ul className="text-2xs mt-0.5 list-disc space-y-0.5 pl-4 leading-relaxed">
        {items.map((item, i) => (
          <li key={i} className="break-words">
            {item}
          </li>
        ))}
      </ul>
      {more !== undefined && more > 0 && (
        <div className="text-2xs text-ca-muted mt-0.5">and {more} more</div>
      )}
    </div>
  );
}

function EditFacts({ data }: { data: Record<string, unknown> }) {
  const changes = listOf(data.changes).filter(isText).map(String);
  const issues = listOf(data.issues).filter(isText).map(String);
  const question = stringOf(data.question);
  const error = stringOf(data.error);
  const total = numberOf(data.changesTotal) ?? changes.length;

  if (!changes.length && !issues.length && !question && !error) return null;

  return (
    <div className="border-ca-border mt-2 border-t pt-1.5">
      <FactList title="Changed in the document" items={changes} more={total - changes.length} />
      <FactList title="Open issues for you to check" items={issues} />
      {question && <p className="text-2xs mt-1.5 leading-relaxed break-words">{question}</p>}
      {error && (
        <p className="text-2xs text-ca-muted mt-1.5 leading-relaxed break-words">{error}</p>
      )}
    </div>
  );
}

function EditProgress({ data, stopped }: { data: Record<string, unknown>; stopped: boolean }) {
  const task = stringOf(data.task);
  const step = textOf(data.step);
  const { lastTool } = data;

  return (
    <>
      {task && <div className="text-2xs text-ca-muted truncate">{task}</div>}
      {!stopped && step && (
        <div className="text-2xs text-ca-muted truncate tabular-nums">
          step {step}
          {lastTool ? ` · ${lastTool}` : ""}
        </div>
      )}
    </>
  );
}

function SingleEditCard({ data, live }: { data: Record<string, unknown>; live: boolean }) {
  const { phase } = data;
  const collection = stringOf(data.collection);
  const id = textOf(data.id);
  const status = stringOf(data.status);
  const writeStatus = stringOf(data.writeStatus) ?? (status === "done" ? "done" : undefined);
  const isDone = phase === "done";
  const stopped = !isDone && !live;
  const succeeded = writeStatus === "done";
  const clean = succeeded && listOf(data.issues).length === 0;

  return (
    <div
      className={cn(
        "my-2 rounded-[10px] border px-3 py-2 text-xs",
        isDone
          ? clean
            ? "border-ca-ok/30 bg-ca-ok/10"
            : "border-ca-warn/30 bg-ca-warn/10"
          : "border-ca-border bg-ca-surface"
      )}
    >
      <div className="flex items-center gap-2">
        {isDone ? <StatusDot status={status} /> : <ProgressIcon live={live} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 font-semibold">
            <span>{isDone ? "Edit" : stopped ? "Edit stopped before it finished" : "Editing"}</span>
            <span className="text-ca-muted font-normal">
              {collection}/{id}
            </span>
            {isDone && (
              <span className={cn("text-2xs", succeeded ? "text-ca-ok" : "text-ca-warn")}>
                {writeLabel(writeStatus, status)}
              </span>
            )}
          </div>
          {!isDone && <EditProgress data={data} stopped={stopped} />}
        </div>
        {isDone && collection && id && <CmsLink collection={collection} id={String(id)} />}
      </div>
      {isDone && <EditFacts data={data} />}
    </div>
  );
}

export function ContentOpsCard({ data, live }: { data: unknown; live: boolean }) {
  if (!isRecord(data)) return null;
  const { op: operation } = data;

  if (
    operation === "bulkEditContent" ||
    operation === "findReplace" ||
    operation === "bulkTranslateContent"
  ) {
    return <BulkEditCard data={data} live={live} />;
  }

  if (operation === "editContent" || operation === "translateContent") {
    return <SingleEditCard data={data} live={live} />;
  }

  return null;
}
