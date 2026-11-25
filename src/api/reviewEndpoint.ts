import type { PayloadHandler, PayloadRequest } from "payload";
import type { SchemaContext } from "../types.js";
import type { MemoryService } from "../memory/index.js";
import { isDocId } from "../borders.js";
import type { DocId } from "../borders.js";
import { principalOf } from "./principal.js";
import { readJsonBody } from "./requestBody.js";
import { createDiffHandler } from "./reviewDiff.js";
import { createDiscardHandler } from "./reviewDiscard.js";
import { DISCARDED_OP } from "../memory/storage/changesets.js";
import type { StoredChange } from "../memory/storage/changesets.js";
import { summarizeChanges } from "../agent/content/changeSummary.js";

interface PublishResult {
  id: DocId;
  ok: boolean;
  error?: string;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// A global is one document: it is published once, and every id sent for it gets that result.
async function publishGlobal(
  req: PayloadRequest,
  slug: string,
  ids: DocId[]
): Promise<PublishResult[]> {
  try {
    await req.payload.updateGlobal({
      slug,
      data: { _status: "published" },
      overrideAccess: false,
      overrideLock: false,
      user: req.user,
    });

    return ids.map((id) => ({ id, ok: true }));
  } catch (err) {
    const error = errorText(err);

    return ids.map((id) => ({ id, ok: false, error }));
  }
}

async function publishDocuments(
  req: PayloadRequest,
  collection: string,
  ids: DocId[]
): Promise<PublishResult[]> {
  const results: PublishResult[] = [];

  for (const id of ids) {
    try {
      await req.payload.update({
        collection,
        id,
        data: { _status: "published" },
        overrideAccess: false,
        // Without it Payload skips the lock check and deletes the lock of the person editing.
        overrideLock: false,
        user: req.user,
      });
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: errorText(err) });
    }
  }

  return results;
}

const publish: PayloadHandler = async (req) => {
  if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { collection, ids } = await readJsonBody(req);

  if (
    typeof collection !== "string" ||
    !collection ||
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every(isDocId)
  ) {
    return Response.json(
      { error: "collection and a non-empty ids[] are required" },
      { status: 400 }
    );
  }

  if (ids.length > 100) {
    return Response.json(
      { error: "Too many ids - publish at most 100 documents per request" },
      { status: 400 }
    );
  }

  const results = collection.startsWith("global:")
    ? await publishGlobal(req, collection.slice("global:".length), ids)
    : await publishDocuments(req, collection, ids);

  return Response.json({
    collection,
    published: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  });
};

/** The latest change of each locale of a document, without the locales whose change was
 * discarded: a discard of one locale leaves the change of another standing. */
export function standingChanges(stored: StoredChange[]): StoredChange[] {
  const latest = new Map<string, StoredChange>();

  for (const change of stored) {
    const key = `${change.collection}:${change.id}:${change.locale ?? ""}`;

    if (!latest.has(key)) latest.set(key, change);
  }

  return [...latest.values()].filter((change) => change.op !== DISCARDED_OP);
}

function createChangesHandler(
  getSchema: (req: PayloadRequest) => Promise<SchemaContext>,
  getMemory: () => Promise<MemoryService | null>
): PayloadHandler {
  return async (req) => {
    if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(req.url || "", "http://localhost");
    const conversationId = url.searchParams.get("conversationId");

    if (!conversationId)
      return Response.json({ error: "conversationId is required" }, { status: 400 });

    try {
      const memory = await getMemory();

      if (!memory) return Response.json({ refs: [] });

      const conv = await memory.conversations.findById(conversationId);

      if (!conv || String(conv.userId) !== principalOf(req.user, req.payload)) {
        return Response.json({ refs: [] });
      }

      const [refs, stored, schema] = await Promise.all([
        memory.changesets.list(conversationId),
        memory.changesets.listStored(conversationId),
        getSchema(req),
      ]);

      return Response.json({ refs, summary: summarizeChanges(schema, standingChanges(stored)) });
    } catch (err) {
      console.error("[Content Agent] Review changes endpoint error:", err);

      return Response.json({ refs: [] });
    }
  };
}

export function createReviewHandlers(
  getSchema: (req: PayloadRequest) => Promise<SchemaContext>,
  getMemory: () => Promise<MemoryService | null>
) {
  const diff = createDiffHandler(getSchema, getMemory);
  const changes = createChangesHandler(getSchema, getMemory);
  const discard = createDiscardHandler(getSchema, getMemory);

  return { diff, publish, changes, discard };
}
