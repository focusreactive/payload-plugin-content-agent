import type { PayloadHandler, PayloadRequest } from "payload";
import { isDocId, isRecord } from "../borders.js";
import type { DocFields } from "../borders.js";
import type { SchemaContext, SchemaField } from "../types.js";
import type { MemoryService } from "../memory/index.js";
import { DISCARDED_OP } from "../memory/storage/changesets.js";
import type { StoredChange } from "../memory/storage/changesets.js";
import { planRestore } from "../agent/content/restorePlan.js";
import { principalOf } from "./principal.js";
import { readJsonBody } from "./requestBody.js";

type SchemaGetter = (req: PayloadRequest) => Promise<SchemaContext>;
type MemoryGetter = () => Promise<MemoryService | null>;

export type DiscardStatus =
  | "restored"
  | "unchanged"
  | "changed-since"
  | "created"
  | "no-snapshot"
  | "failed";

export interface DiscardResult {
  collection: string;
  id: string;
  locale?: string;
  status: DiscardStatus;
  /** Fields that went back to their value from before the conversation. */
  restored?: string[];
  /** Fields someone changed after the agent. They are kept until the request has `force`. */
  changedSince?: string[];
  error?: string;
}

interface DiscardTarget {
  global: string | null;
  fields: SchemaField[];
  hasDrafts: boolean;
}

const MAX_DOCUMENTS = 100;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function targetOf(schema: SchemaContext, collection: string): DiscardTarget | null {
  const global = collection.startsWith("global:") ? collection.slice("global:".length) : null;
  const entry = global
    ? schema.globals.find((candidate) => candidate.slug === global)
    : schema.collections.find((candidate) => candidate.slug === collection);

  return entry ? { global, fields: entry.fields, hasDrafts: entry.hasDrafts } : null;
}

// Runs as the person, like a save in the admin: their access, and another person's lock holds.
function readCurrent(
  req: PayloadRequest,
  target: DiscardTarget,
  change: StoredChange
): Promise<DocFields | null> {
  const options = {
    depth: 0,
    draft: true,
    overrideAccess: false,
    user: req.user,
    ...(change.locale ? { locale: change.locale, fallbackLocale: false as const } : {}),
  };

  return target.global
    ? req.payload.findGlobal({ slug: target.global, ...options })
    : req.payload.findByID({
        collection: change.collection,
        id: change.id,
        disableErrors: true,
        ...options,
      });
}

function writeRestored(
  req: PayloadRequest,
  target: DiscardTarget,
  change: StoredChange,
  patch: DocFields
): Promise<DocFields> {
  const options = {
    data: target.hasDrafts ? { ...patch, _status: "draft" } : patch,
    draft: target.hasDrafts,
    depth: 0,
    overrideAccess: false,
    overrideLock: false,
    user: req.user,
    ...(change.locale ? { locale: change.locale } : {}),
  };

  return target.global
    ? req.payload.updateGlobal({ slug: target.global, ...options })
    : req.payload.update({ collection: change.collection, id: change.id, ...options });
}

interface DiscardRun {
  req: PayloadRequest;
  schema: SchemaContext;
  memory: MemoryService;
  conversationId: string;
  force: boolean;
}

async function discardChange(run: DiscardRun, change: StoredChange): Promise<DiscardResult> {
  const { req, schema, memory, conversationId, force } = run;
  const { collection, id, locale } = change;
  const result = { collection, id, ...(locale ? { locale } : {}) };
  const target = targetOf(schema, collection);

  if (change.op === DISCARDED_OP) return { ...result, status: "unchanged" };
  if (!target) return { ...result, status: "failed", error: `Unknown target "${collection}"` };
  if (!change.restore) return { ...result, status: "no-snapshot" };
  if (Object.keys(change.restore).length === 0) return { ...result, status: "created" };

  try {
    const current = await readCurrent(req, target, change);

    if (!current) return { ...result, status: "failed", error: "The document was not found" };
    const plan = planRestore(
      target.fields,
      { restore: change.restore, after: change.after, current },
      force
    );
    const written = plan.restored.length
      ? await writeRestored(req, target, change, plan.patch)
      : current;
    const discarded = plan.changedSince.length === 0;
    // A field someone changed keeps the agent's value as its "after": the next discard then
    // still sees that it was changed.
    const after = discarded ? written : { ...change.after, ...plan.patch };

    await memory.changesets.settle(conversationId, change, { after, discarded });

    return {
      ...result,
      status: !discarded ? "changed-since" : plan.restored.length ? "restored" : "unchanged",
      ...(plan.restored.length ? { restored: plan.restored } : {}),
      ...(discarded ? {} : { changedSince: plan.changedSince }),
    };
  } catch (err) {
    return { ...result, status: "failed", error: errorText(err) };
  }
}

interface DocumentRef {
  collection: string;
  id: string;
}

function documentsOf(value: unknown): DocumentRef[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DOCUMENTS) return null;
  const documents: DocumentRef[] = [];

  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.collection !== "string" || !entry.collection) return null;
    if (!isDocId(entry.id)) return null;
    documents.push({ collection: entry.collection, id: String(entry.id) });
  }

  return documents;
}

/**
 * Brings the documents back to their state from before the conversation changed them.
 * A document the conversation created stays: the agent removes nothing.
 */
export function createDiscardHandler(
  getSchema: SchemaGetter,
  getMemory: MemoryGetter
): PayloadHandler {
  return async (req) => {
    if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = await readJsonBody(req);
    const documents = documentsOf(body.documents);

    if (typeof body.conversationId !== "string" || !body.conversationId || !documents) {
      return Response.json(
        { error: `conversationId and documents[] (1 to ${MAX_DOCUMENTS}) are required` },
        { status: 400 }
      );
    }

    const memory = await getMemory();
    const conversation = memory ? await memory.conversations.findById(body.conversationId) : null;

    if (
      !memory ||
      !conversation ||
      String(conversation.userId) !== principalOf(req.user, req.payload)
    ) {
      return Response.json({ error: "No stored changes for this conversation" }, { status: 404 });
    }

    const run: DiscardRun = {
      req,
      schema: await getSchema(req),
      memory,
      conversationId: body.conversationId,
      force: body.force === true,
    };
    const results: DiscardResult[] = [];

    for (const { collection, id } of documents) {
      const changes = await memory.changesets.listForDocument(run.conversationId, collection, id);

      if (!changes.length) results.push({ collection, id, status: "no-snapshot" });
      for (const change of changes) results.push(await discardChange(run, change));
    }

    return Response.json({ results });
  };
}
