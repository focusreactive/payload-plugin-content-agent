import type { PayloadDoc } from "../../../borders.js";
import { mcpWriteError, parseMcpDoc } from "../../mcpParse.js";
import type { CreateOptions, DocResult, DocTarget, IoTransport } from "../documentIo.js";
import { noDraftsCreateRefusal } from "../draftsOnly.js";
import {
  MCP_RESERVED_UPDATE_PARAMS,
  callMcp,
  mcpTool,
  noAccess,
  targetLabel,
  transports,
  undeclaredError,
} from "./context.js";
import type { IoContext } from "./context.js";

/** Returns null when the write falls through to the Local API. */
async function createThroughMcp(
  io: IoContext,
  createTool: string,
  opts: CreateOptions
): Promise<DocResult | null> {
  const { data, locale, callId } = opts;
  const reservedCollisions = Object.keys(data).filter((key) => MCP_RESERVED_UPDATE_PARAMS.has(key));

  if (reservedCollisions.length > 0 && io.local === null) {
    return {
      error:
        `Field(s) ${reservedCollisions.map((key) => `"${key}"`).join(", ")} collide with MCP control parameters ` +
        `and cannot ride the MCP transport. Rename the field or enable the Local API fallback.`,
    };
  }

  if (reservedCollisions.length !== 0) return null;
  const undeclared = undeclaredError(io, createTool, locale ? ["locale"] : []);

  if (undeclared) return { error: `Nothing was created: ${undeclared}` };
  const res = await callMcp(
    io,
    createTool,
    { ...data, _status: "draft", draft: true, ...(locale ? { locale } : {}) },
    callId
  );
  const writeErr = mcpWriteError(res);

  if (writeErr) return { error: writeErr };

  return { doc: parseMcpDoc(res) ?? undefined };
}

async function createInCollection(
  io: IoContext,
  target: DocTarget,
  transport: IoTransport,
  opts: CreateOptions
): Promise<DocResult> {
  const { data, locale } = opts;
  const collection = target.collection ?? "";
  const createTool = mcpTool(io, "create", collection);

  if (transport === "mcp" && createTool) {
    const viaMcp = await createThroughMcp(io, createTool, opts);

    if (viaMcp) return viaMcp;
  }

  if (!io.local) return noAccess(io, target, "create");
  const doc: PayloadDoc = await io.local.payload.create({
    collection,
    data: { ...data, _status: "draft" },
    draft: true,
    depth: 0,
    overrideAccess: false,
    user: io.local.user,
    ...(locale ? { locale } : {}),
  });

  return { doc };
}

export async function create(
  io: IoContext,
  target: DocTarget,
  opts: CreateOptions
): Promise<DocResult> {
  if (target.global) {
    return {
      error: `Globals are singletons - ${targetLabel(target)} cannot be created, only read/updated.`,
    };
  }

  const refusal = noDraftsCreateRefusal(io.schema, target);

  if (refusal) return { error: refusal };
  const { create: transport } = transports(io, target);

  if (!transport) return noAccess(io, target, "create");

  try {
    return await createInCollection(io, target, transport, opts);
  } catch (err) {
    return { error: `${err instanceof Error ? err.message : String(err)}` };
  }
}
