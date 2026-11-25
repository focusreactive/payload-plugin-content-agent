import { isRecord } from "../../../borders.js";
import type { Where } from "../../../borders.js";
import { mcpWriteError, parseMcpFind } from "../../mcpParse.js";
import type { DocTarget, ListOptions, ListResult } from "../documentIo.js";
import {
  callMcp,
  declaredParams,
  mcpTool,
  noAccess,
  targetLabel,
  transports,
  undeclaredError,
} from "./context.js";
import type { IoContext, LocalApi } from "./context.js";

const isWhereClause = (where: Where | undefined) =>
  where && typeof where === "object" && Object.keys(where).length > 0;

/** The optional arguments of a call of the site's find tool. */
function findFilters(
  declared: Record<string, unknown>,
  { where, sort, locale, select }: ListOptions
): Record<string, unknown> {
  // The Payload MCP find tool takes `where` as a JSON string; a project tool that declares it
  // as an object gets the object.
  const declaredWhere = declared.where;
  const whereArg =
    isRecord(declaredWhere) && declaredWhere.type === "object" ? where : JSON.stringify(where);

  return {
    ...(isWhereClause(where) ? { where: whereArg } : {}),
    ...(sort ? { sort } : {}),
    ...(locale ? { locale } : {}),
    // A find tool without `select` returns whole documents: a wider answer, still a right one.
    ...(select && "select" in declared ? { select } : {}),
  };
}

async function listThroughMcp(
  io: IoContext,
  target: DocTarget,
  findTool: string,
  opts: ListOptions
): Promise<ListResult> {
  const { page = 1, limit = 100, locale, where, sort, callId, draft = true } = opts;
  const hasWhere = isWhereClause(where);
  const declared = declaredParams(io, findTool);
  const refusal =
    sort && !("sort" in declared)
      ? `the site's find tool for it takes no \`sort\`. Call again without \`sort\`.`
      : undeclaredError(
          io,
          findTool,
          [hasWhere ? "where" : "", locale ? "locale" : ""].filter(Boolean)
        );

  if (refusal)
    return {
      docs: [],
      totalPages: 0,
      totalDocs: 0,
      error: `Failed to list ${targetLabel(target)}: ${refusal}`,
    };
  const result = await callMcp(
    io,
    findTool,
    { limit, page, draft, depth: 0, ...findFilters(declared, opts) },
    callId
  );
  // The Payload MCP find tool reports a failed query as plain text, with no error flag.
  const listErr = mcpWriteError(result);

  if (listErr)
    return {
      docs: [],
      totalPages: 0,
      totalDocs: 0,
      error: `Failed to list ${targetLabel(target)}: ${listErr}`,
    };
  const parsed = parseMcpFind(result);

  if (parsed.counted)
    return { docs: parsed.docs, totalPages: parsed.totalPages || 1, totalDocs: parsed.totalDocs };
  // The server stated no page count: read it from the total, else a full page means one more.
  const seen = (page - 1) * limit + parsed.docs.length;
  const totalDocs = Math.max(parsed.totalDocs, seen);
  const isOpenEnded = totalDocs === seen && parsed.docs.length >= limit;

  return {
    docs: parsed.docs,
    totalPages: isOpenEnded ? page + 1 : Math.max(Math.ceil(totalDocs / limit), page),
    totalDocs,
    ...(isOpenEnded ? { moreMayExist: true } : {}),
  };
}

async function listLocal(
  local: LocalApi,
  collection: string,
  opts: ListOptions
): Promise<ListResult> {
  const { page = 1, limit = 100, locale, where, sort, draft = true, select } = opts;
  const hasWhere = isWhereClause(where);
  const res = await local.payload.find({
    collection,
    page,
    limit,
    depth: 0,
    draft,
    overrideAccess: false,
    user: local.user,
    ...(hasWhere ? { where } : {}),
    ...(sort ? { sort } : {}),
    ...(locale ? { locale } : {}),
    ...(select ? { select } : {}),
  });

  return {
    docs: res.docs,
    totalPages: res.totalPages || 1,
    totalDocs: res.totalDocs,
  };
}

export async function list(
  io: IoContext,
  collection: string,
  opts: ListOptions = {}
): Promise<ListResult> {
  const target: DocTarget = { collection };
  const { read: transport } = transports(io, target);

  if (!transport) return { docs: [], totalPages: 0, totalDocs: 0, ...noAccess(io, target, "read") };

  try {
    const findTool = mcpTool(io, "find", collection);

    if (transport === "mcp" && findTool) return await listThroughMcp(io, target, findTool, opts);
    if (!io.local)
      return { docs: [], totalPages: 0, totalDocs: 0, ...noAccess(io, target, "read") };

    return await listLocal(io.local, collection, opts);
  } catch (err) {
    return {
      docs: [],
      totalPages: 0,
      totalDocs: 0,
      error: `Failed to list ${targetLabel(target)}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
