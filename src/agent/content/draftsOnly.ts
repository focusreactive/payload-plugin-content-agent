import type { LiveTarget } from "../../approvalRequest.js";
import { isRecord } from "../../borders.js";
import type { SchemaContext } from "../../types.js";
import { liveKey, personApproved } from "../approvals.js";
import type { TurnApprovals } from "../approvals.js";
import { CHAT_SURFACE } from "../toolSurface.js";
import type { ToolSurface } from "../toolSurface.js";

export interface DraftsTarget {
  collection?: string;
  global?: string;
}

/** The person's confirmation of a live write: the approvals of the request, and the tool call. */
export interface LiveConsent {
  approvals?: TurnApprovals;
  /** The tool call that the chat asked the person about. Without it only an earlier one counts. */
  toolCallId?: string;
  /** The documents of the write. The confirmation of a call opens these and no other. */
  ids?: (string | number)[];
}

const entryOf = (schema: SchemaContext, target: DraftsTarget) =>
  target.global
    ? schema.globals.find((global) => global.slug === target.global)
    : schema.collections.find((collection) => collection.slug === target.collection);

export const hasNoDrafts = (schema: SchemaContext, target: DraftsTarget): boolean =>
  entryOf(schema, target)?.hasDrafts === false;

const labelOf = (target: DraftsTarget): string =>
  target.global ? `Global "${target.global}"` : `Collection "${target.collection}"`;

/**
 * A write to a target without drafts is live at once, so it runs only after the person
 * confirmed it in the chat. Null when the target has drafts, or when the person confirmed a
 * tool call that named every document of this write.
 */
export function noDraftsRefusal(
  schema: SchemaContext,
  target: DraftsTarget,
  surface: ToolSurface = CHAT_SURFACE,
  consent: LiveConsent = {}
): string | null {
  if (!hasNoDrafts(schema, target)) return null;
  const { approvals, toolCallId, ids = [] } = consent;
  const keys = target.global ? [liveKey(target)] : ids.map((id) => liveKey(target, id));

  if (approvals && personApproved(approvals, toolCallId))
    for (const key of keys) approvals.live.add(key);
  if (approvals && keys.length > 0 && keys.every((key) => approvals.live.has(key))) return null;

  return surface.noDraftsRefusal(labelOf(target));
}

/** No confirmation opens this: a new document in a target without drafts is live at once. */
export const noDraftsCreateRefusal = (
  schema: SchemaContext,
  target: DraftsTarget,
  surface: ToolSurface = CHAT_SURFACE
): string | null =>
  hasNoDrafts(schema, target) ? surface.noDraftsCreateRefusal(labelOf(target)) : null;

/** The refusal for one write of a gate: a create is always refused, an update without a consent. */
export const writeRefusalWithoutDrafts = (
  schema: SchemaContext,
  target: DraftsTarget,
  { create, surface, consent }: { create: boolean; surface?: ToolSurface; consent: LiveConsent }
): string | null =>
  create
    ? noDraftsCreateRefusal(schema, target, surface)
    : noDraftsRefusal(schema, target, surface, consent);

const LIVE_WRITE_TOOLS = new Set([
  CHAT_SURFACE.update,
  CHAT_SURFACE.edit,
  "findReplaceContent",
  "translateContent",
]);

/** The target of a chat write tool call when it has no drafts, for the question to the person. */
export const liveTargetOf =
  (schema: SchemaContext) =>
  (toolName: string, input: unknown): LiveTarget | null => {
    if (!LIVE_WRITE_TOOLS.has(toolName) || !isRecord(input) || input.preview === true) return null;
    const { collection, global, id } = input;
    const target =
      typeof global === "string"
        ? { global }
        : typeof collection === "string"
          ? { collection }
          : null;

    if (!target || !hasNoDrafts(schema, target)) return null;

    return typeof id === "string" || typeof id === "number"
      ? { ...target, document: { id } }
      : target;
  };

export function withoutDraftsNotice(schema: SchemaContext): string | null {
  const collections = schema.collections.filter((collection) => !collection.hasDrafts);
  const globals = schema.globals.filter((global) => !global.hasDrafts);

  if (!collections.length && !globals.length) return null;
  const parts = [
    collections.length
      ? `collections ${collections.map((collection) => collection.slug).join(", ")}`
      : "",
    globals.length ? `globals ${globals.map((global) => global.slug).join(", ")}` : "",
  ].filter(Boolean);

  return `[Content Agent] These have no drafts, so a change of the agent there is live at once: ${parts.join("; ")}. The chat asks the person before each such change, and the agent creates no document there. Enable versions.drafts on one to get drafts for it.`;
}
