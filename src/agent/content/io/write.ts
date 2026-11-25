import { isDocId } from "../../../borders.js";
import type { DocId, PayloadDoc } from "../../../borders.js";
import { executeMcpWrite, mcpWriteError, parseMcpDoc } from "../../mcpParse.js";
import type { DocResult, DocTarget, IoTransport, WriteOptions } from "../documentIo.js";
import { hasNoDrafts, noDraftsRefusal } from "../draftsOnly.js";
import { manyDocumentsRefusal } from "../manyDocuments.js";
import { fitNulls } from "../../mcpNulls.js";
import { CHAT_SURFACE } from "../../toolSurface.js";
import {
  MCP_RESERVED_UPDATE_PARAMS,
  callMcp,
  callOptions,
  declaredParams,
  mcpTool,
  noAccess,
  targetLabel,
  transports,
  undeclaredError,
} from "./context.js";
import type { IoContext } from "./context.js";
import { lockRefusal } from "./editLock.js";

// A target without drafts has no draft to save: the write is the live document.
const draftSave = (io: IoContext, target: DocTarget, patch: Record<string, unknown>) =>
  hasNoDrafts(io.schema, target)
    ? { data: patch, draft: false }
    : { data: { ...patch, _status: "draft" }, draft: true };

async function writeGlobal(
  io: IoContext,
  target: DocTarget,
  slug: string,
  opts: WriteOptions
): Promise<DocResult> {
  const { patch, locale } = opts;

  if (!io.local) return noAccess(io, target, "write");
  const doc: PayloadDoc = await io.local.payload.updateGlobal({
    slug,
    ...draftSave(io, target, patch),
    depth: 0,
    overrideAccess: false,
    // The Local API skips document locks by default; `false` protects a document that a
    // person has open in the admin.
    overrideLock: false,
    user: io.local.user,
    ...(locale ? { locale } : {}),
  });

  return { doc };
}

/** A site tool that declares its parameters without `draft` saves the live document. */
function writesNoDraft(io: IoContext, target: DocTarget, updateTool: string): boolean {
  const declared = declaredParams(io, updateTool);

  return (
    !hasNoDrafts(io.schema, target) && Object.keys(declared).length > 0 && !("draft" in declared)
  );
}

async function writeThroughMcp(
  io: IoContext,
  target: DocTarget,
  updateTool: string,
  opts: WriteOptions & { id: DocId }
): Promise<DocResult> {
  const { id, patch, locale, callId } = opts;
  const undeclared = undeclaredError(io, updateTool, locale ? ["locale"] : []);

  if (undeclared) return { error: `Nothing was written to ${targetLabel(target)}: ${undeclared}` };
  const { data, draft } = draftSave(io, target, patch);
  const res = await executeMcpWrite(
    (input, options) => callMcp(io, updateTool, input, options.toolCallId),
    {
      id: String(id),
      ...data,
      ...(draft ? { draft } : {}),
      ...(locale ? { locale } : {}),
    },
    callOptions(callId)
  );
  const writeErr = mcpWriteError(res);

  if (writeErr) return { error: writeErr };

  return { doc: parseMcpDoc(res) ?? undefined };
}

async function writeCollectionDoc(
  io: IoContext,
  target: DocTarget,
  transport: IoTransport,
  opts: WriteOptions
): Promise<DocResult> {
  const { id, patch, locale } = opts;
  const collection = target.collection ?? "";

  if (!isDocId(id)) return { error: `An id is required to write ${targetLabel(target)}.` };
  const reservedCollisions = Object.keys(patch).filter((key) =>
    MCP_RESERVED_UPDATE_PARAMS.has(key)
  );

  if (transport === "mcp" && reservedCollisions.length > 0 && io.local === null) {
    return {
      error:
        `Field(s) ${reservedCollisions.map((key) => `"${key}"`).join(", ")} collide with MCP update control parameters ` +
        `and cannot be written through the MCP transport. Rename the field or enable the Local API fallback.`,
    };
  }

  const updateTool = mcpTool(io, "update", collection);

  if (transport === "mcp" && updateTool && reservedCollisions.length === 0) {
    const noDraft = writesNoDraft(io, target, updateTool);

    // Without the `draft` parameter the tool cannot save a draft: the Local API saves it.
    if (noDraft && !io.local)
      return {
        error: `Nothing was written to ${targetLabel(target)}: the site's tool "${updateTool}" takes no \`draft\`, so the write would change the live document and not the draft. Tell the person that this tool of the site does not write drafts.`,
      };
    // The Local API takes every `null`. Without it the tool gets the rows without the ones
    // it refuses.
    const fit = fitNulls(io.mcpTools[updateTool], patch);

    if (!noDraft && (!fit.refused || !io.local))
      return writeThroughMcp(io, target, updateTool, { ...opts, id, patch: fit.input });
  }

  if (!io.local) return noAccess(io, target, "write");
  const doc: PayloadDoc = await io.local.payload.update({
    collection,
    id,
    ...draftSave(io, target, patch),
    depth: 0,
    overrideAccess: false,
    overrideLock: false,
    user: io.local.user,
    ...(locale ? { locale } : {}),
  });

  return { doc };
}

export async function write(
  io: IoContext,
  target: DocTarget,
  opts: WriteOptions
): Promise<DocResult> {
  const refusal = noDraftsRefusal(io.schema, target, CHAT_SURFACE, {
    approvals: io.approvals,
    ids: opts.id === undefined ? [] : [opts.id],
  });

  if (refusal) return { error: refusal };
  const tooMany = manyDocumentsRefusal(target, {
    approvals: io.approvals,
    ids: opts.id === undefined ? [] : [opts.id],
  });

  if (tooMany) return { error: tooMany };
  const { write: transport } = transports(io, target);

  if (!transport) return noAccess(io, target, "write");
  const locked = await lockRefusal(io, target, opts.id);

  if (locked) return { error: locked };

  try {
    if (target.global) return await writeGlobal(io, target, target.global, opts);

    return await writeCollectionDoc(io, target, transport, opts);
  } catch (err) {
    return { error: `${err instanceof Error ? err.message : String(err)}` };
  }
}
