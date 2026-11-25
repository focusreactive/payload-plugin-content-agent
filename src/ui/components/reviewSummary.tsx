"use client";

import React from "react";
import { isRecord, isText, listOf, numberOf, recordsOf, stringOf } from "../lib/narrow.js";

export interface DocumentSummary {
  collection: string;
  id: string;
  kind: string;
  fields: string[];
  differs: boolean;
  issues: string[];
}

export interface ReviewSummaryData {
  total: number;
  counts: Record<string, number>;
  withIssues: number;
  patterns: { collection: string; fields: string[]; documents: number; differ: number }[];
  documents: DocumentSummary[];
}

const texts = (value: unknown): string[] => listOf(value).filter(isText).map(String);

/** Reads the summary of the changes endpoint; an answer without one gives `null`. */
export function summaryOf(data: unknown): ReviewSummaryData | null {
  const summary = isRecord(data) && isRecord(data.summary) ? data.summary : null;

  if (!summary) return null;
  const counts = isRecord(summary.counts) ? summary.counts : {};

  return {
    total: numberOf(summary.total) ?? 0,
    counts: Object.fromEntries(
      Object.entries(counts).map(([kind, count]) => [kind, numberOf(count) ?? 0])
    ),
    withIssues: numberOf(summary.withIssues) ?? 0,
    patterns: recordsOf(summary.patterns).map((pattern) => ({
      collection: stringOf(pattern.collection) ?? "",
      fields: texts(pattern.fields),
      documents: numberOf(pattern.documents) ?? 0,
      differ: numberOf(pattern.differ) ?? 0,
    })),
    documents: recordsOf(summary.documents).map((document) => ({
      collection: stringOf(document.collection) ?? "",
      id: String(document.id ?? ""),
      kind: stringOf(document.kind) ?? "",
      fields: texts(document.fields),
      differs: document.differs === true,
      issues: texts(document.issues),
    })),
  };
}

const KIND_LABELS: [string, string][] = [
  ["text", "text only"],
  ["structure", "structure, links or references"],
  ["created", "new"],
];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function ReviewSummary({ summary }: { summary: ReviewSummaryData | null }) {
  if (!summary || summary.total < 2) return null;
  const kinds = KIND_LABELS.filter(([kind]) => (summary.counts[kind] ?? 0) > 0).map(
    ([kind, label]) => `${summary.counts[kind]} ${label}`
  );

  return (
    <div className="border-ca-border bg-ca-surface text-2xs text-ca-muted mb-2 rounded-lg border px-2.5 py-2 leading-relaxed">
      <div className="text-ca-fg font-semibold">
        {plural(summary.total, "document")} changed: {kinds.join(", ")}
      </div>
      {summary.patterns.map((pattern) => (
        <div key={pattern.collection}>
          {pattern.collection}: {pattern.documents - pattern.differ} of {pattern.documents} changed{" "}
          {pattern.fields.length ? pattern.fields.join(", ") : "the same fields"}
          {pattern.differ > 0 && (
            <span className="text-ca-warn"> · {plural(pattern.differ, "document")} differ</span>
          )}
        </div>
      ))}
      {summary.withIssues > 0 && (
        <div className="text-ca-warn">
          {plural(summary.withIssues, "document")} with open issues, listed first
        </div>
      )}
    </div>
  );
}

export function RowBadges({ info }: { info: DocumentSummary | undefined }) {
  if (!info) return null;

  return (
    <>
      {info.issues.length > 0 && (
        <span
          className="bg-ca-warn/10 text-2xs text-ca-warn shrink-0 rounded-full px-1.5"
          title={info.issues.join("\n\n")}
        >
          {plural(info.issues.length, "issue")}
        </span>
      )}
      {info.differs && (
        <span className="bg-ca-accent/10 text-2xs text-ca-accent shrink-0 rounded-full px-1.5">
          differs
        </span>
      )}
    </>
  );
}

export function RowIssues({ info }: { info: DocumentSummary | undefined }) {
  if (!info || info.issues.length === 0) return null;

  return (
    <div className="border-ca-border border-t px-2.5 py-1.5">
      <div className="text-2xs text-ca-warn font-semibold">Open issues for you to check</div>
      <ul className="text-2xs text-ca-fg mt-0.5 list-disc space-y-0.5 pl-4 leading-relaxed">
        {info.issues.map((issue, index) => (
          <li key={index} className="break-words whitespace-pre-line">
            {issue}
          </li>
        ))}
      </ul>
    </div>
  );
}
