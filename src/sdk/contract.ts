import type { ToolSet } from "ai";
import type { BasePayload, Config, PayloadHandler, TypedUser } from "payload";
import type { EditRecordRef, SchemaContext } from "../types.js";

/**
 * Major version of the module contract. The plugin refuses a module built for another version.
 * A new major of the `ai` package in the plugin is a new SDK version too.
 * @public
 */
export const SDK_VERSION = 1;

/**
 * The plugin's Postgres database, narrowed to what a module needs. Build every table name
 * with `table()`: `search_path` does not survive transaction-mode poolers.
 * @public
 */
export interface ModuleDb {
  query: (
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/**
 * One schema change owned by a module.
 * @public
 */
export interface ModuleMigration {
  /**
   * Unique within the module. Applied once, in array order, and recorded as `<module name>:<name>`.
   */
  name: string;
  /**
   * Runs in the plugin's migration transaction with `search_path` set to the plugin schema.
   * Make it safe to run twice (`IF NOT EXISTS`).
   * No `BEGIN`, `COMMIT` or `CREATE INDEX CONCURRENTLY`.
   * A failure rolls back this module's migrations of the run; the next start retries them.
   */
  sql: string;
}

/**
 * A REST endpoint on the Payload API route. The plugin puts its `access` check in front of it.
 * @public
 */
export interface ModuleEndpoint {
  path: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  handler: PayloadHandler;
}

/**
 * What a module sees at config time.
 * @public
 */
export interface ConfigContext {
  /**
   * The collections the agent may access (the plugin's `collections` option). Undefined means all.
   */
  collections?: string[];
  /** The globals the agent may access (the plugin's `globals` option). Undefined means all. */
  globals?: string[];
  /**
   * The plugin database, after all migrations have run. Resolves to null when memory is not
   * configured or unreachable. Rejects while the config is being built:
   * call it from a hook or a handler.
   */
  getDb: () => Promise<ModuleDb | null>;
}

/**
 * What a module sees on one chat turn.
 * @public
 */
export interface TurnContext {
  payload: BasePayload;
  /** The logged-in user who sent the message. */
  user: TypedUser;
  /** The user's stable id: the one stored with conversations and edits (see `principalOf`). */
  userId: string;
  schema: SchemaContext;
  conversationId?: string;
  /** The IANA time zone of the person's browser, when the chat sent a valid one. */
  timeZone?: string;
  /**
   * The plugin database, or null when this turn runs without memory: memory is not
   * configured, or the conversation could not be verified as this user's.
   */
  db: ModuleDb | null;
  /**
   * Report the documents a module tool wrote. They reach the review panel, the turn's write
   * count and every module's `onEdits`. A tool that writes and does not call this makes the
   * agent warn the user that nothing was saved.
   */
  recordEdits: (edits: EditRecordRef[]) => void;
  /**
   * Call from a tool that reports past work (a history, a log), so the check for a claimed
   * write that did not happen stays quiet.
   */
  onReport: () => void;
}

/**
 * What a module adds to one chat turn.
 * @public
 */
export interface TurnContribution {
  /**
   * Tools for the orchestrator. A name that is already taken (a core tool, or a tool of a
   * module listed earlier) is skipped with a warning. Wrap a tool that brings text from
   * outside the CMS in `markUntrusted`.
   */
  tools?: ToolSet;
  /**
   * Guidance for the cached part of the system prompt: when and how to use the tools. Return
   * the same text whenever you return the same tools: a change invalidates the prompt cache.
   */
  prompt?: string;
  /**
   * Text for the per-turn part of the system prompt,
   * for example which servers are reachable right now.
   */
  note?: string;
}

/**
 * What a module sees when the agent writes a document.
 * @public
 */
export interface EditsContext {
  schema: SchemaContext;
  conversationId?: string;
  userId?: string;
  /** Null when the write happened without memory (see `TurnContext.db`). */
  db: ModuleDb | null;
}

/**
 * An extension of the content agent: a plain object passed in the plugin's `modules` option.
 * A throw at config time (`validate`, `extendConfig`, `endpoints`) fails the build. A throw at
 * runtime (`turn`, `onEdits`) is logged and the module is skipped.
 * @public
 */
export interface ContentAgentModule {
  /**
   * Unique name: lowercase letters, digits and single dashes.
   * Used in logs and to record migrations.
   */
  name: string;
  /** The contract version the module was built for. Set it to `SDK_VERSION`. */
  sdkVersion: number;
  /**
   * Check the module's own options. Throw to fail the build with a message that says what to fix.
   */
  validate?: (ctx: ConfigContext) => void;
  /**
   * Change the Payload config and return the new one: hooks on collections, extra collections
   * or globals, jobs (`config.jobs.tasks`), admin views and components. Runs after the plugin
   * has made its own changes.
   */
  extendConfig?: (config: Config, ctx: ConfigContext) => Config;
  /** REST endpoints, each behind the plugin's `access` check. */
  endpoints?: (ctx: ConfigContext) => ModuleEndpoint[];
  /** Own database migrations. They run only when memory is configured. */
  migrations?: ModuleMigration[];
  /**
   * Called once per chat turn, before the agent starts, concurrently with the other modules.
   * A turn that throws, or takes longer than 20 seconds, is skipped for that turn, and the
   * agent is told the module is unavailable. Put your own, shorter timeouts on network calls.
   */
  turn?: (ctx: TurnContext) => TurnContribution | void | Promise<TurnContribution | void>;
  /**
   * Called after every agent write. Keep it fast and return a promise for slow work. A throw or
   * a rejection is logged and ignored. Treat `edits` as read-only:
   * other modules get the same objects.
   */
  onEdits?: (edits: EditRecordRef[], ctx: EditsContext) => void | Promise<void>;
}

/**
 * Returns the module unchanged. Gives a module object literal its type checks and editor hints.
 * @public
 */
export function defineModule<Module extends ContentAgentModule>(module: Module): Module {
  return module;
}
