import { isDocId } from "../../../borders.js";
import { writeRefusalWithoutDrafts } from "../../content/draftsOnly.js";
import type { DraftsTarget } from "../../content/draftsOnly.js";
import { manyDocumentsRefusal } from "../../content/manyDocuments.js";
import type { WriteGateContext } from "./writeGate.js";

interface GateWrite {
  target: DraftsTarget;
  /** "create" or "update": what the site tool of the call does. */
  verb: string;
  /** The `id` parameter of the call, as it came. */
  id: unknown;
  toolCallId?: string;
}

/** The writes that run only after the person's confirmation: a live one, and one too many. */
export function consentRefusal(
  { schema, surface, approvals }: Pick<WriteGateContext, "schema" | "surface" | "approvals">,
  { target, verb, id, toolCallId }: GateWrite
): string | null {
  const consent = { approvals, toolCallId, ids: isDocId(id) ? [id] : [] };
  const live = writeRefusalWithoutDrafts(schema, target, {
    create: verb === "create",
    surface,
    consent,
  });

  return live ?? (verb === "update" ? manyDocumentsRefusal(target, consent) : null);
}
