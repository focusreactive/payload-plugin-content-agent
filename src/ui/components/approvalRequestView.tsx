"use client";

import React from "react";
import { useConfig } from "@payloadcms/ui";
import { ArrowRight, Check, ExternalLink } from "lucide-react";
import type { ApprovalDocument, ApprovalRequest } from "../../approvalRequest.js";
import { adminDocHref, useAdminRoute } from "../routes.js";

export interface ApprovalCopy {
  question: string;
  confirm: string;
  cancel: string;
  /** What stays safe after a click on the confirm button. */
  promises: string[];
}

const DRAFTS_ONLY = "Every change is saved as a draft. Nothing is published.";
const RISKY_DRAFT = "The update is saved as a draft. Nothing is published.";
const LIVE_NOTE = "This content has no drafts. The change is live on the site at once.";

export const isLive = (request: ApprovalRequest): boolean =>
  request.kind === "live-write" || request.live === true;
const REVIEW_AFTER = "You see each change on the review screen when the run ends.";

const ONE_DRAFT = "The change is saved as a draft. Nothing is published.";

const isSingle = (
  request: ApprovalRequest
): request is Extract<
  ApprovalRequest,
  { kind: "risky-update" | "live-write" | "more-documents" }
> =>
  request.kind === "risky-update" ||
  request.kind === "live-write" ||
  request.kind === "more-documents";

const documentsOf = (count: number): string => `${count} ${count === 1 ? "document" : "documents"}`;

function useCollectionLabel(slug: string | undefined): string {
  const { config } = useConfig();
  const plural = config?.collections?.find((collection) => collection.slug === slug)?.labels
    ?.plural;

  return typeof plural === "string" && plural ? plural : (slug ?? "");
}

function useGlobalLabel(slug: string | undefined): string {
  const { config } = useConfig();
  const label = config?.globals?.find((global) => global.slug === slug)?.label;

  return typeof label === "string" && label ? label : (slug ?? "");
}

function useDraftCopy(request: ApprovalRequest): ApprovalCopy {
  const collection = useCollectionLabel(request.collection);
  const global = useGlobalLabel(isSingle(request) ? request.global : undefined);

  if (isSingle(request)) {
    const title = request.document?.title;
    const target = request.global ? global : title ? `"${title}"` : collection;

    if (request.kind === "more-documents")
      return {
        question: `The agent already worked on ${documentsOf(request.changed)} for this request. Change one more, in ${target}?`,
        confirm: "Change it",
        cancel: "Stop here",
        promises: [ONE_DRAFT],
      };

    return request.kind === "live-write"
      ? {
          question: `Change ${target} on the live site?`,
          confirm: "Save it live",
          cancel: "Cancel",
          promises: [],
        }
      : {
          question: `This update removes content from ${target}. Save it?`,
          confirm: "Save the update",
          cancel: "Keep the content",
          promises: [RISKY_DRAFT],
        };
  }

  const many = documentsOf(request.count);
  const place = `${many} in ${collection}`;

  if (request.kind === "replace")
    return {
      question: `Replace this text in ${place}?`,
      confirm: `Replace in ${many}`,
      cancel: "Cancel",
      promises: [DRAFTS_ONLY, "Only this exact text changes. The rest stays as it is."],
    };

  if (request.kind === "translate")
    return {
      question: `Translate ${place}?`,
      confirm: `Translate ${many}`,
      cancel: "Cancel",
      promises: [DRAFTS_ONLY, "The source language stays as it is."],
    };

  return {
    question: `Edit ${place}?`,
    confirm: `Edit ${many}`,
    cancel: "Cancel",
    promises: [DRAFTS_ONLY, REVIEW_AFTER],
  };
}

export function useApprovalCopy(request: ApprovalRequest): ApprovalCopy {
  const copy = useDraftCopy(request);

  return isLive(request)
    ? {
        ...copy,
        promises: copy.promises.filter(
          (line) => line !== DRAFTS_ONLY && line !== RISKY_DRAFT && line !== ONE_DRAFT
        ),
      }
    : copy;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="text-ca-faint mb-1 text-[10px] font-semibold tracking-wide uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

function Quoted({ text, empty }: { text: string; empty: string }) {
  return text ? (
    <code className="border-ca-border bg-ca-surface text-ca-fg rounded-md border px-1.5 py-0.5 font-mono text-[11px] break-words whitespace-pre-wrap">
      {text}
    </code>
  ) : (
    <span className="text-ca-muted italic">{empty}</span>
  );
}

function DocumentList({
  collection,
  documents,
  count,
}: {
  collection: string;
  documents: ApprovalDocument[];
  count: number;
}) {
  const adminRoute = useAdminRoute();
  const rest = count - documents.length;

  if (!documents.length) return null;

  return (
    <Section label="Documents">
      <ul className="m-0 list-none space-y-0.5 p-0">
        {documents.map(({ id, title }) => (
          <li key={String(id)} className="flex min-w-0 items-center gap-1.5">
            <a
              href={adminDocHref(collection, id, adminRoute)}
              target="_blank"
              rel="noreferrer"
              className="text-ca-fg hover:text-ca-accent flex min-w-0 items-center gap-1 no-underline"
            >
              <span className="truncate">{title ?? `Document ${id}`}</span>
              <ExternalLink className="text-ca-faint size-3 shrink-0" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      {rest > 0 && <div className="text-ca-muted mt-0.5">and {rest} more</div>}
    </Section>
  );
}

function Change({ request }: { request: ApprovalRequest }) {
  if (request.kind === "live-write" || request.kind === "more-documents") return null;

  if (request.kind === "edit")
    return (
      <Section label="What the agent does in each document">
        <p className="m-0 leading-relaxed break-words whitespace-pre-wrap">{request.instruction}</p>
      </Section>
    );

  if (request.kind === "replace")
    return (
      <Section label="The change">
        <div className="flex flex-wrap items-center gap-1.5">
          <Quoted text={request.find} empty="" />
          <ArrowRight className="text-ca-faint size-3 shrink-0" aria-label="becomes" />
          <Quoted text={request.replace} empty="nothing: the text is removed" />
        </div>
      </Section>
    );

  if (request.kind === "translate")
    return (
      <Section label="Languages">
        <div className="flex flex-wrap items-center gap-1.5">
          <Quoted text={request.from ?? ""} empty="default language" />
          <ArrowRight className="text-ca-faint size-3 shrink-0" aria-label="into" />
          <Quoted text={request.to} empty="" />
        </div>
      </Section>
    );

  return (
    <Section label="What the update removes">
      <ul className="m-0 list-disc space-y-0.5 pl-4">
        {request.effects.map((effect) => (
          <li key={effect} className="leading-relaxed break-words">
            {effect}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Promises({ lines }: { lines: string[] }) {
  return (
    <ul className="text-ca-muted m-0 mt-3 list-none space-y-0.5 p-0">
      {lines.map((line) => (
        <li key={line} className="flex items-start gap-1.5">
          <Check className="text-ca-ok mt-0.5 size-3 shrink-0" aria-hidden />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

export function ApprovalRequestBody({ request }: { request: ApprovalRequest }) {
  return (
    <>
      {isLive(request) && (
        <Section label="No drafts">
          <p className="m-0 leading-relaxed">{LIVE_NOTE}</p>
        </Section>
      )}
      <Change request={request} />
      {isSingle(request) ? (
        request.collection &&
        request.document && (
          <DocumentList collection={request.collection} documents={[request.document]} count={1} />
        )
      ) : (
        <DocumentList
          collection={request.collection}
          documents={request.documents}
          count={request.count}
        />
      )}
    </>
  );
}
