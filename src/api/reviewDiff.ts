import type { PayloadHandler, PayloadRequest } from "payload";
import type { DocFields } from "../borders.js";
import type { SchemaContext, SchemaField } from "../types.js";
import type { MemoryService } from "../memory/index.js";
import { computeDocDiff } from "../agent/content/diff.js";
import type { DocDiffOptions } from "../agent/content/diff.js";
import { titleFieldOf } from "../schema/titleField.js";
import { principalOf } from "./principal.js";

type SchemaGetter = (req: PayloadRequest) => Promise<SchemaContext>;
type MemoryGetter = () => Promise<MemoryService | null>;

interface DiffTarget {
  collection: string;
  id: string;
  conversationId: string | null;
  locale: string | undefined;
  globalSlug: string | null;
  fields: SchemaField[];
  diffOpts: DocDiffOptions;
}

interface DiffRequest {
  req: PayloadRequest;
  target: DiffTarget;
  localeOpts: { locale?: string };
}

async function resolveDiffTarget(
  req: PayloadRequest,
  getSchema: SchemaGetter
): Promise<DiffTarget | Response> {
  const url = new URL(req.url || "", "http://localhost");
  const collection = url.searchParams.get("collection");
  const id = url.searchParams.get("id");
  const conversationId = url.searchParams.get("conversationId");
  const locale = url.searchParams.get("locale") || undefined;

  if (!collection || !id)
    return Response.json({ error: "collection and id are required" }, { status: 400 });

  const globalSlug = collection.startsWith("global:") ? collection.slice("global:".length) : null;
  const schema = await getSchema(req);
  const globalDef = globalSlug
    ? schema.globals.find((entry) => entry.slug === globalSlug)
    : undefined;
  const collectionDef = globalSlug
    ? undefined
    : schema.collections.find((entry) => entry.slug === collection);
  const fields = globalDef?.fields ?? collectionDef?.fields;

  if (!fields)
    return Response.json(
      { error: `Unknown ${globalSlug ? "global" : "collection"} "${collection}"` },
      { status: 400 }
    );
  const diffOpts = {
    titleField: collectionDef ? titleFieldOf(collectionDef) : undefined,
    upload: collectionDef?.upload,
  };

  return { collection, id, conversationId, locale, globalSlug, fields, diffOpts };
}

/** The stored state keeps the status the document was read with, so the row asks the CMS. */
async function statusNow(req: PayloadRequest, target: DiffTarget): Promise<unknown> {
  const { collection, id, globalSlug } = target;
  const asPerson = { draft: true, depth: 0, overrideAccess: false, user: req.user };

  try {
    const doc: DocFields = globalSlug
      ? await req.payload.findGlobal({ slug: globalSlug, ...asPerson })
      : await req.payload.findByID({ collection, id, ...asPerson });

    return doc._status;
  } catch {
    return undefined;
  }
}

async function sessionDiff(
  req: PayloadRequest,
  target: DiffTarget,
  getMemory: MemoryGetter
): Promise<Response | null> {
  const { collection, id, conversationId, locale, fields, diffOpts } = target;
  const memory = conversationId ? await getMemory() : null;

  if (memory && conversationId) {
    const conv = await memory.conversations.findById(conversationId);

    if (conv && String(conv.userId) === principalOf(req.user, req.payload)) {
      const snaps = await memory.changesets.getSnapshots(conversationId, collection, id, locale);

      if (snaps?.before && snaps?.after) {
        return Response.json({
          scope: "session",
          diff: {
            ...computeDocDiff({
              fields,
              collection,
              published: snaps.before,
              draft: snaps.after,
              opts: diffOpts,
            }),
            status: await statusNow(req, target),
          },
        });
      }
    }
  }

  return null;
}

async function globalDiff(globalSlug: string, request: DiffRequest): Promise<Response> {
  const { req, target, localeOpts } = request;
  const { collection, fields, diffOpts } = target;
  const draft = await req.payload.findGlobal({
    slug: globalSlug,
    draft: true,
    depth: 0,
    overrideAccess: false,
    user: req.user,
    ...localeOpts,
  });
  let published: DocFields | null = null;

  try {
    published = await req.payload.findGlobal({
      slug: globalSlug,
      draft: false,
      depth: 0,
      overrideAccess: false,
      user: req.user,
      ...localeOpts,
    });
  } catch {
    published = null;
  }

  return Response.json({
    scope: "published",
    diff: computeDocDiff({ fields, collection, published, draft, opts: diffOpts }),
  });
}

async function documentDiff(request: DiffRequest): Promise<Response> {
  const { req, target, localeOpts } = request;
  const { collection, id, fields, diffOpts } = target;
  const draft = await req.payload.findByID({
    collection,
    id,
    draft: true,
    depth: 0,
    overrideAccess: false,
    user: req.user,
    ...localeOpts,
  });
  let published: DocFields | null = null;

  try {
    published = await req.payload.findByID({
      collection,
      id,
      draft: false,
      depth: 0,
      overrideAccess: false,
      user: req.user,
      ...localeOpts,
    });
  } catch {
    published = null;
  }

  return Response.json({
    scope: "published",
    diff: computeDocDiff({ fields, collection, published, draft, opts: diffOpts }),
  });
}

export function createDiffHandler(
  getSchema: SchemaGetter,
  getMemory: MemoryGetter
): PayloadHandler {
  return async (req) => {
    if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const target = await resolveDiffTarget(req, getSchema);

    if (target instanceof Response) return target;

    try {
      const sessionResponse = await sessionDiff(req, target, getMemory);

      if (sessionResponse) return sessionResponse;

      const localeOpts = target.locale ? { locale: target.locale } : {};
      const request: DiffRequest = { req, target, localeOpts };

      if (target.globalSlug) {
        return await globalDiff(target.globalSlug, request);
      }

      return await documentDiff(request);
    } catch (err) {
      console.error("[Content Agent] Review diff endpoint error:", err);

      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
