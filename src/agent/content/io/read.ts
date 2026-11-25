import { isDocId } from "../../../borders.js";
import type { PayloadDoc } from "../../../borders.js";
import { mcpWriteError, parseMcpDoc } from "../../mcpParse.js";
import type { DocResult, DocTarget, IoTransport, ReadOptions } from "../documentIo.js";
import {
  callMcp,
  collectionOf,
  declaredParams,
  mcpTool,
  noAccess,
  targetLabel,
  transports,
  undeclaredError,
} from "./context.js";
import type { IoContext } from "./context.js";

async function readGlobal(
  io: IoContext,
  target: DocTarget,
  slug: string,
  opts: ReadOptions
): Promise<DocResult> {
  const { locale, fallbackLocale, draft = true } = opts;
  const fallbackOpt = fallbackLocale === false ? { fallbackLocale: false as const } : {};

  if (!io.local) return noAccess(io, target, "read");
  const doc: PayloadDoc | null = await io.local.payload.findGlobal({
    slug,
    depth: 0,
    draft,
    overrideAccess: false,
    user: io.local.user,
    ...(locale ? { locale } : {}),
    ...fallbackOpt,
  });

  return { doc: doc ?? null };
}

/** A site tool that declares its parameters without `draft` answers with the published version. */
function readsNoDraft(io: IoContext, findTool: string, collection: string): boolean {
  const declared = declaredParams(io, findTool);

  return (
    !!collectionOf(io, collection)?.hasDrafts &&
    Object.keys(declared).length > 0 &&
    !("draft" in declared)
  );
}

/** The refusal of a read through the site's find tool, when it cannot answer what was asked. */
function mcpReadRefusal(
  io: IoContext,
  target: DocTarget,
  { findTool, locale, noDraft }: { findTool: string; locale?: string; noDraft: boolean }
): DocResult | null {
  const undeclared = undeclaredError(io, findTool, locale ? ["locale"] : []);

  if (undeclared) return { error: `Failed to read ${targetLabel(target)}: ${undeclared}` };

  return noDraft && !io.local
    ? {
        error: `Failed to read ${targetLabel(target)}: the site's tool "${findTool}" takes no \`draft\`, so it returns the published version and not the draft. Tell the person that this tool of the site does not read drafts.`,
      }
    : null;
}

async function readThroughMcp(
  io: IoContext,
  target: DocTarget,
  findTool: string,
  opts: ReadOptions
): Promise<DocResult> {
  const { id, locale, fallbackLocale, callId, draft = true } = opts;
  // The MCP find tool takes the fallback locale as text only.
  // Payload reads "none" as no fallback.
  const result = await callMcp(
    io,
    findTool,
    {
      id: String(id),
      draft,
      depth: 0,
      ...(locale ? { locale } : {}),
      ...(fallbackLocale === false ? { fallbackLocale: "none" } : {}),
    },
    callId
  );

  const doc = parseMcpDoc(result);
  // A failed read comes back as plain text. Only "not found" means that there is no document.
  const readErr = doc ? null : mcpWriteError(result);

  if (readErr && !/not found/iu.test(readErr))
    return { error: `Failed to read ${targetLabel(target)}: ${readErr}` };
  // A site tool that takes no `id` answers with a page of the list.
  if (doc && String(doc.id) !== String(id))
    return {
      error: `Failed to read ${targetLabel(target)}: the site's tool "${findTool}" answered with document ${JSON.stringify(String(doc.id))}, not ${JSON.stringify(String(id))}, so it does not read one document by its id. Tell the person that this tool of the site cannot read a document by id.`,
    };

  return { doc: doc ?? null };
}

async function readCollectionDoc(
  io: IoContext,
  target: DocTarget,
  transport: IoTransport,
  opts: ReadOptions
): Promise<DocResult> {
  const { id, locale, fallbackLocale, draft = true } = opts;
  const fallbackOpt = fallbackLocale === false ? { fallbackLocale: false as const } : {};
  const collection = target.collection ?? "";

  if (!isDocId(id)) return { error: `An id is required to read ${targetLabel(target)}.` };
  const findTool = transport === "mcp" ? mcpTool(io, "find", collection) : undefined;

  if (findTool) {
    const noDraft = draft && readsNoDraft(io, findTool, collection);
    const refused = mcpReadRefusal(io, target, { findTool, locale, noDraft });

    if (refused) return refused;
    // Without the `draft` parameter the tool cannot read the draft: the Local API reads it.
    if (!noDraft) return readThroughMcp(io, target, findTool, opts);
  }

  if (!io.local) return noAccess(io, target, "read");
  const doc: PayloadDoc | null = await io.local.payload.findByID({
    collection,
    id,
    depth: 0,
    draft,
    overrideAccess: false,
    user: io.local.user,
    disableErrors: true,
    ...(locale ? { locale } : {}),
    ...fallbackOpt,
  });

  return { doc: doc ?? null };
}

export async function read(
  io: IoContext,
  target: DocTarget,
  opts: ReadOptions = {}
): Promise<DocResult> {
  const { read: transport } = transports(io, target);

  if (!transport) return noAccess(io, target, "read");

  try {
    if (target.global) return await readGlobal(io, target, target.global, opts);

    return await readCollectionDoc(io, target, transport, opts);
  } catch (err) {
    return {
      error: `Failed to read ${targetLabel(target)}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
