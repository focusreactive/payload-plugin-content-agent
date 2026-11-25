import { isDocId } from "../../../borders.js";
import type { DocId, PayloadDoc } from "../../../borders.js";
import type { DocTarget } from "../documentIo.js";
import { collectionOf, globalOf, targetLabel } from "./context.js";
import type { IoContext } from "./context.js";
import { unknownTargetError } from "../../toolErrors.js";

const HISTORY_LIMIT = 200;

export interface HistoryOptions {
  id?: DocId;
  locale?: string;
}

export interface HistoryResult {
  /** The saved versions, the oldest first. */
  versions?: PayloadDoc[];
  total?: number;
  error?: string;
}

/** The saved versions of one document or global. Payload keeps them; no MCP tool reads them. */
export async function history(
  io: IoContext,
  target: DocTarget,
  { id, locale }: HistoryOptions
): Promise<HistoryResult> {
  const entry = target.global ? globalOf(io, target.global) : collectionOf(io, target.collection);

  if (!entry) return { error: unknownTargetError(io.schema, target) };
  if (!entry.hasVersions)
    return {
      error: `${targetLabel(target)} keeps no versions, so it has no history to read. A developer turns versions on in the config of the site.`,
    };
  if (!io.local)
    return {
      error: `The history of ${targetLabel(target)} cannot be read in this run: versions are read through the Local API, and the agent has none here.`,
    };
  if (!target.global && !isDocId(id))
    return { error: `An id is required to read the history of ${targetLabel(target)}.` };
  const shared = {
    sort: "createdAt",
    limit: HISTORY_LIMIT,
    depth: 0,
    overrideAccess: false,
    user: io.local.user,
    ...(locale ? { locale } : {}),
  };

  try {
    const found = target.global
      ? await io.local.payload.findGlobalVersions({ slug: target.global, ...shared })
      : await io.local.payload.findVersions({
          collection: target.collection ?? "",
          where: { parent: { equals: id } },
          ...shared,
        });

    return { versions: found.docs as PayloadDoc[], total: found.totalDocs };
  } catch (err) {
    return { error: `${err instanceof Error ? err.message : String(err)}` };
  }
}
