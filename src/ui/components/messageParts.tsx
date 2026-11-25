"use client";

import React from "react";
import Markdown from "react-markdown";
import { REMOTE_ELEMENTS } from "../lib/markdownSafety.js";
import remarkGfm from "remark-gfm";
import { getToolName, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { ChartCard, parseXyChart, renderViz } from "./viz.js";
import { visualKindOf } from "../../sdk/visual.js";
import { Reasoning } from "./reasoning.js";
import { isRecord } from "../lib/narrow.js";
import { ApprovalCard, awaitsApproval } from "./approvalCard.js";
import { ContentOpsCard } from "./contentOpsCard.js";
import { progressCardFollows } from "../turnStatus.js";
import {
  GroupedToolCalls,
  ServiceSteps,
  ToolCallDisplay,
  hasFailed,
  outputFieldsOf,
} from "./toolCall.js";
import type { ToolPart } from "./toolCall.js";

type MessagePart = UIMessage["parts"][number];

const MARKDOWN_CSS = `
.ca-md p { margin: 4px 0; }
.ca-md h1, .ca-md h2, .ca-md h3 { font-weight: 600; margin: 8px 0 4px; }
.ca-md ul, .ca-md ol { margin: 4px 0; padding-left: 20px; }
.ca-md ul { list-style: disc; }
.ca-md ol { list-style: decimal; }
.ca-md li { margin: 2px 0; }
.ca-md code { padding: 1px 5px; background: color-mix(in srgb, currentColor 10%, transparent); border-radius: 4px; font-size: 0.875rem; font-family: ui-monospace, monospace; }
.ca-md pre { margin: 6px 0; }
.ca-md pre code { display: block; padding: 8px 10px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; }
.ca-md a { color: var(--color-ca-accent); text-decoration: underline; }
.ca-md blockquote { margin: 4px 0; padding-left: 10px; border-left: 3px solid var(--color-ca-border-strong); color: var(--color-ca-muted); }
.ca-md hr { margin: 8px 0; border: none; border-top: 1px solid var(--color-ca-border); }
.ca-md .ca-table-wrap { margin: 6px 0; overflow-x: auto; }
/* max-content, NOT 100%: at 100% the table is forced into the panel width, so the wrapper's
   overflow-x can never engage - the browser instead steals width from whichever column holds
   the longest unbreakable text (a URL) and crushes it to a sliver while short numeric columns
   keep their nowrap width. Sizing to content lets the wrapper scroll instead; min-width keeps
   a small table spanning the panel rather than hugging the left edge. */
.ca-md table { border-collapse: collapse; font-size: 0.875rem; width: max-content; min-width: 100%; }
.ca-md th { padding: 4px 8px; border-bottom: 2px solid var(--color-ca-border-strong); text-align: left; font-weight: 600; white-space: nowrap; }
/* Cap + break so one very long cell widens the table to a readable column instead of an
   unscrollable one; anywhere (not break-word) is what lets a URL break at all, since it has
   no spaces to break at. */
.ca-md td { padding: 4px 8px; border-bottom: 1px solid var(--color-ca-border); max-width: 42ch; overflow-wrap: anywhere; }
`;

const CORE_VISUAL_TOOLS = new Set(["present_table", "present_metrics", "present_chart"]);

function isServiceTool(name: string): boolean {
  if (CORE_VISUAL_TOOLS.has(name)) return false;
  if (name.startsWith("present_")) return true;
  if (["getSchemaInfo", "searchContent", "reflect", "proposeGlossaryEntry"].includes(name))
    return true;
  if (/^find[A-Z]/u.test(name) && name !== "findReplaceContent") return true;

  return false;
}

function codeTextOf(node: unknown): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(codeTextOf).join("");

  return isRecord(node) && isRecord(node.props) ? codeTextOf(node.props.children) : "";
}

function isServicePart(part: ToolPart): boolean {
  return isServiceTool(getToolName(part)) && !visualKindOf(part.output);
}

function isSimpleResult(part: ToolPart): boolean {
  const output = outputFieldsOf(part.output);

  if (hasFailed(part)) return false;
  if (output?.docs && Array.isArray(output.docs)) return false;
  if (output?.id) return false;
  if (output?.updatedCount !== undefined) return false;
  if (output?.createdCount !== undefined) return false;

  return true;
}

interface PartsWalk {
  parts: MessagePart[];
  elements: React.ReactNode[];
  shouldRenderOps: (idx: number) => boolean;
  live: boolean;
}

function markdownBlock(text: string, i: number): React.ReactNode {
  return (
    <div key={i} className="ca-md">
      <style>{MARKDOWN_CSS}</style>
      <Markdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={REMOTE_ELEMENTS}
        components={{
          table: ({ children }) => (
            <div className="ca-table-wrap">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children, ...rest }) => {
            const chart = parseXyChart(codeTextOf(children));

            if (chart) return <ChartCard spec={chart} />;

            return <pre {...rest}>{children}</pre>;
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

function serviceRun(parts: MessagePart[], start: number): ToolPart[] {
  const run: ToolPart[] = [];
  let j = start;

  while (j < parts.length) {
    const next = parts[j];

    if (!isToolUIPart(next) || !isServicePart(next)) break;
    run.push(next);
    j++;
  }

  return run;
}

function appendServiceRun(walk: PartsWalk, i: number): number {
  const { elements, live } = walk;
  const run = serviceRun(walk.parts, i);
  const errored = run.filter(hasFailed);

  for (const failedPart of errored) {
    elements.push(
      <ToolCallDisplay
        key={`svc-err-${i}-${failedPart.toolCallId ?? ""}`}
        toolName={getToolName(failedPart)}
        state={failedPart.state}
        result={failedPart.output}
        errorText={failedPart.errorText}
        live={live}
      />
    );
  }

  const okCount = run.length - errored.length;

  if (okCount > 0) {
    elements.push(
      <ServiceSteps
        key={`svc-${i}`}
        count={okCount}
        pending={
          live &&
          run.some(
            (toolPart) =>
              toolPart.state === "input-streaming" || toolPart.state === "input-available"
          )
        }
      />
    );
  }

  return i + run.length;
}

function simpleRun(parts: MessagePart[], part: ToolPart, start: number): ToolPart[] {
  const name = getToolName(part);
  const group: ToolPart[] = [part];
  let j = start + 1;

  while (j < parts.length) {
    const next = parts[j];

    if (
      !isToolUIPart(next) ||
      next.state !== "output-available" ||
      getToolName(next) !== name ||
      !isSimpleResult(next)
    )
      break;
    group.push(next);
    j++;
  }

  return group;
}

function appendToolPart(walk: PartsWalk, part: ToolPart, i: number): number {
  const { elements, live } = walk;
  const name = getToolName(part);

  const progressShown = progressCardFollows(walk.parts, i);

  if (awaitsApproval(part)) {
    elements.push(
      <ApprovalCard key={`approval-${part.toolCallId}`} part={part} progressShown={progressShown} />
    );

    return i + 1;
  }

  const kind = part.state === "output-available" ? visualKindOf(part.output) : null;

  if (kind) {
    const card = renderViz(kind, part.output);

    if (card) {
      elements.push(<React.Fragment key={`viz-${i}`}>{card}</React.Fragment>);

      return i + 1;
    }
  }

  if (isServicePart(part)) return appendServiceRun(walk, i);

  const isComplete = part.state === "output-available";

  if (isComplete && isSimpleResult(part)) {
    const group = simpleRun(walk.parts, part, i);

    if (group.length > 1) {
      elements.push(<GroupedToolCalls key={i} toolName={name} calls={group} />);

      return i + group.length;
    }
  }

  elements.push(
    <ToolCallDisplay
      key={i}
      toolName={name}
      state={part.state}
      input={part.input}
      result={part.output}
      errorText={part.errorText}
      live={live}
      progressShown={progressShown}
    />
  );

  return i + 1;
}

function appendPart(walk: PartsWalk, i: number): number {
  const { elements, live } = walk;
  const part = walk.parts[i];

  if (part.type === "text") {
    elements.push(markdownBlock(part.text, i));

    return i + 1;
  }

  if (part.type === "reasoning") {
    const thoughts = walk.parts.filter((entry) => entry.type === "reasoning");

    // One line for the reasoning of every step, where the first of them is.
    if (thoughts[0] === part)
      elements.push(
        <Reasoning
          key="reasoning"
          text={thoughts
            .map((thought) => thought.text ?? "")
            .filter((text) => text.trim())
            .join("\n\n")}
          isStreaming={live && thoughts.some((thought) => thought.state === "streaming")}
        />
      );

    return i + 1;
  }

  if (part.type === "data-content-ops") {
    if (walk.shouldRenderOps(i)) {
      elements.push(<ContentOpsCard key={part.id ?? i} data={part.data} live={live} />);
    }

    return i + 1;
  }

  if (isToolUIPart(part)) return appendToolPart(walk, part, i);

  return i + 1;
}

export function groupParts(
  parts: MessagePart[],
  shouldRenderOps: (idx: number) => boolean,
  live: boolean
): React.ReactNode[] {
  const walk: PartsWalk = { parts, elements: [], shouldRenderOps, live };
  let i = 0;

  while (i < parts.length) i = appendPart(walk, i);

  return walk.elements;
}
