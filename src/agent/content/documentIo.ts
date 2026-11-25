import type {
  DocFields,
  DocId,
  McpTools,
  Payload,
  PayloadDoc,
  PayloadUser,
  Where,
} from "../../borders.js";
import type { SchemaContext } from "../../types.js";
import type { TurnApprovals } from "../approvals.js";
import { create } from "./io/create.js";
import { transports } from "./io/context.js";
import { lockRefusal } from "./io/editLock.js";
import type { IoContext } from "./io/context.js";
import { history } from "./io/history.js";
import type { HistoryOptions, HistoryResult } from "./io/history.js";
import { list } from "./io/list.js";
import { read } from "./io/read.js";
import { write } from "./io/write.js";

export interface DocTarget {
  collection?: string;
  global?: string;
}

export type IoTransport = "mcp" | "local" | null;

export interface IoTransports {
  read: IoTransport;
  write: IoTransport;
  create: IoTransport;
}

export interface ReadOptions {
  id?: DocId;
  locale?: string;
  fallbackLocale?: false;
  callId?: string;
  /** false reads the published version. The default is the draft. */
  draft?: boolean;
}

export interface WriteOptions {
  id?: DocId;
  patch: DocFields;
  locale?: string;
  callId?: string;
}

export interface CreateOptions {
  data: DocFields;
  locale?: string;
  callId?: string;
}

export interface ListOptions {
  page?: number;
  limit?: number;
  locale?: string;
  where?: Where;
  /** A field name, with `-` in front for descending order. */
  sort?: string;
  callId?: string;
  draft?: boolean;
  /**
   * The top-level fields each document comes back with; the id always comes back. A caller that
   * needs only ids or titles passes it: a whole document can be megabytes.
   */
  select?: Record<string, true>;
}

/**
 * `doc` is null when the document does not exist and undefined when a write returned no document.
 */
export interface DocResult {
  doc?: PayloadDoc | null;
  error?: string;
}

export interface ListResult {
  docs: PayloadDoc[];
  totalPages: number;
  totalDocs: number;
  /** The server stated no totals and the page is full: both numbers are a lower bound. */
  moreMayExist?: boolean;
  error?: string;
}

export interface DocumentIO {
  transports: (target: DocTarget) => IoTransports;
  read: (target: DocTarget, opts?: ReadOptions) => Promise<DocResult>;
  write: (target: DocTarget, opts: WriteOptions) => Promise<DocResult>;
  create: (target: DocTarget, opts: CreateOptions) => Promise<DocResult>;
  list: (collection: string, opts?: ListOptions) => Promise<ListResult>;
  /** The saved versions of one document or global, the oldest first. */
  history: (target: DocTarget, opts?: HistoryOptions) => Promise<HistoryResult>;
  /** A refusal text when another person has the document open in the admin, else null. */
  lockRefusal: (target: DocTarget, id?: DocId) => Promise<string | null>;
}

export interface DocumentIODeps {
  mcpTools: McpTools;
  schema: SchemaContext;
  payload?: Payload;
  user?: PayloadUser;
  approvals?: TurnApprovals;
}

export function createDocumentIO(deps: DocumentIODeps): DocumentIO {
  const io: IoContext = {
    mcpTools: deps.mcpTools,
    schema: deps.schema,
    local: deps.payload && deps.user ? { payload: deps.payload, user: deps.user } : null,
    approvals: deps.approvals,
  };

  return {
    transports: (target) => transports(io, target),
    read: (target, opts) => read(io, target, opts),
    write: (target, opts) => write(io, target, opts),
    create: (target, opts) => create(io, target, opts),
    list: (collection, opts) => list(io, collection, opts),
    history: (target, opts) => history(io, target, opts ?? {}),
    lockRefusal: (target, id) => lockRefusal(io, target, id),
  };
}
