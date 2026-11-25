"use client";

import { cn } from "../lib/cn.js";
import { isRecord, listOf, recordsOf, textOf } from "../lib/narrow.js";
import React, { useMemo } from "react";
import { getHTMLDiffComponents, escapeDiffHTML, unescapeDiffHTML } from "@payloadcms/ui";

function short(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  return JSON.stringify(value);
}

function SideBySide({ from, to }: { from: React.ReactNode; to: React.ReactNode }) {
  const col = "min-w-0 flex-1 overflow-x-auto";
  const lbl = "mb-0.5 text-2xs font-bold uppercase tracking-wide";

  return (
    <div className="mt-1 flex gap-2">
      <div className={col}>
        <div className={cn(lbl, "text-ca-danger")}>before</div>
        <div className="html-diff text-xs leading-relaxed">{from}</div>
      </div>
      <div className={col}>
        <div className={cn(lbl, "text-ca-ok")}>after</div>
        <div className="html-diff text-xs leading-relaxed">{to}</div>
      </div>
    </div>
  );
}

const box = (text: string, tone: string): React.ReactNode =>
  text && text !== "∅" ? (
    <div className={cn("text-2xs rounded px-1.5 py-1 break-words whitespace-pre-wrap", tone)}>
      {text.length > 800 ? text.slice(0, 800) + "…" : text}
    </div>
  ) : (
    <span className="text-2xs text-ca-faint">-</span>
  );

function BeforeAfter({ before, after }: { before: unknown; after: unknown }) {
  const beforeText = short(before);
  const afterText = short(after);

  return (
    <SideBySide
      from={box(beforeText, "bg-ca-danger/10 text-ca-danger")}
      to={box(afterText, "bg-ca-ok/10 text-ca-ok")}
    />
  );
}

const chip = (text: string, tone: string) => (
  <span key={text} className={cn("text-2xs rounded px-1.5 py-px font-semibold", tone)}>
    {text}
  </span>
);

function BlockSummary({ blocks }: { blocks: Record<string, unknown> }) {
  const added = recordsOf(blocks.added);
  const removed = recordsOf(blocks.removed);
  const changed = recordsOf(blocks.changed);
  const chips: React.ReactNode[] = [];

  if (added.length) chips.push(chip(`+${added.length} added`, "bg-ca-ok/10 text-ca-ok"));
  if (removed.length)
    chips.push(chip(`−${removed.length} removed`, "bg-ca-danger/10 text-ca-danger"));
  if (changed.length) chips.push(chip(`~${changed.length} changed`, "bg-ca-warn/10 text-ca-warn"));
  if (blocks.reordered) chips.push(chip("⇅ reordered", "bg-ca-accent/10 text-ca-accent"));

  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-1">
        {chips.length ? chips : <span className="text-2xs text-ca-muted">changed</span>}
      </div>
      {removed.length > 0 && (
        <div className="text-2xs text-ca-danger mt-1">
          {removed.map((block) => (
            <div key={textOf(block.id)}>
              − {textOf(block.blockType) ?? "item"}
              {block.summary ? `: “${block.summary}”` : ""}
            </div>
          ))}
        </div>
      )}
      {added.length > 0 && (
        <div className="text-2xs text-ca-ok mt-1">
          {added.map((block) => (
            <div key={textOf(block.id)}>
              + {textOf(block.blockType) ?? "item"}
              {block.summary ? `: “${block.summary}”` : ""}
            </div>
          ))}
        </div>
      )}
      {changed.length > 0 && (
        <div className="text-2xs text-ca-muted mt-1">
          {changed.map((block) => (
            <div key={textOf(block.id)}>
              ~ {textOf(block.blockType) ?? "item"}
              {block.summary ? ` “${block.summary}”` : ""}: {listOf(block.fields).join(", ") || "-"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const HAS_NATIVE_DIFF = typeof getHTMLDiffComponents === "function";
const toText = (value: unknown): string =>
  value == null
    ? ""
    : typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);

function NativeFieldDiff({
  before,
  after,
  tokenizeByCharacter,
}: {
  before: unknown;
  after: unknown;
  tokenizeByCharacter: boolean;
}) {
  const rendered = useMemo(() => {
    if (!HAS_NATIVE_DIFF) return null;

    try {
      return getHTMLDiffComponents({
        fromHTML: `<p>${escapeDiffHTML(toText(before))}</p>`,
        toHTML: `<p>${escapeDiffHTML(toText(after))}</p>`,
        tokenizeByCharacter,
        postProcess: unescapeDiffHTML,
      });
    } catch {
      return null;
    }
  }, [before, after, tokenizeByCharacter]);

  if (!rendered) return <BeforeAfter before={before} after={after} />;

  return <SideBySide from={rendered.From} to={rendered.To} />;
}

export function FieldDiffRow({ field }: { field: Record<string, unknown> }) {
  return (
    <div className="border-ca-border border-t py-1.5">
      <div className="text-2xs text-ca-fg font-semibold">
        {textOf(field.label) || textOf(field.name)}
      </div>
      {isRecord(field.blocks) ? (
        <BlockSummary blocks={field.blocks} />
      ) : (
        <NativeFieldDiff
          before={field.before}
          after={field.after}
          tokenizeByCharacter={field.type !== "richText"}
        />
      )}
    </div>
  );
}
