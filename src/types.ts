import type { LanguageModel, EmbeddingModel } from "ai";
import type { GlobalConfig, Payload, PayloadRequest } from "payload";
import type { PayloadDoc } from "./borders.js";
import type { ContentAgentModule } from "./sdk/contract.js";

export type AIProvider = "anthropic" | "openai";

/** Where an instruction block applies. `writing` reaches only the sub-agents that produce prose. */
export type InstructionScope = "always" | "writing" | "review" | "translation";

/** One admin-authored instruction block. */
export interface AgentInstruction {
  /** Human-facing name. Sent to the model only as a heading. */
  label: string;
  scope: InstructionScope;
  instruction: string;
}

export type InstructionsOption =
  | boolean
  | {
      /** Slug of the registered global. @default 'content-agent-instructions' */
      slug?: string;
      /** Payload admin nav group. @default 'Content Agent' */
      adminGroup?: string;
      /** Access control for the global. Strongly recommended: narrow `access.update`. */
      access?: GlobalConfig["access"];
      /** Set false to skip Payload version history on the global. @default true */
      versions?: boolean;
      /**
       * Read the blocks from a structure you already model. When set, no global is registered.
       * Blocks that are blank or have an unknown scope are dropped.
       */
      source?: (ctx: { payload: Payload }) => Promise<AgentInstruction[]> | AgentInstruction[];
    };

/**
 * The shape every agent write reports: to the review panel and to every module's `onEdits`.
 * @public
 */
export interface EditRecordRef {
  collection: string;
  id: string | number;
  op?: string;
  /** Document state before the agent's edit. */
  before?: PayloadDoc | null;
  /** Document state after the agent's edit (the draft it produced). */
  after?: PayloadDoc | null;
  /** Locale the edit targeted. */
  locale?: string;
  /**
   * The targeted locale before the edit, with no value borrowed from another locale. Set when
   * `before` is not that state: a write to a locale other than the default one.
   */
  restore?: PayloadDoc | null;
  /** The editor sub-agent's own account of the change, when there is one. */
  summary?: string;
  /** The tool that performed the write. */
  toolName?: string;
  /** What the editor reported with the change, for the review panel. */
  report?: EditReport;
}

/**
 * One check of the outcome the editor declared, with its result.
 * @public
 */
export interface CriterionReport {
  text: string;
  result: "met" | "not-met" | "not-checked";
}

/**
 * What the editor reported with a change.
 * @public
 */
export interface EditReport {
  /** Open issues the checks and the reviewer left for a person. */
  issues: string[];
  /** The outcome the editor declared before the work, with the result of each check. */
  criteria: CriterionReport[];
}

/** Configuration options for the Content Agent plugin. */
export interface ContentAgentPluginOptions {
  /** Disable the plugin without removing it from config. */
  disabled?: boolean;

  /**
   * AI provider. Set it and put the API key in `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
   * The plugin then picks default models, which the model options override.
   */
  provider?: AIProvider;

  /**
   * Main model for the agent: a model ID string (resolved via `provider`)
   * or a LanguageModel instance.
   * Default: chosen from `provider`.
   */
  model?: string | LanguageModel;

  /**
   * API key for the AI provider, for the language and embedding models. Overrides the
   * `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars. Ignored for models passed as instances.
   */
  apiKey?: string;

  /**
   * API key for the Payload MCP plugin (`@payloadcms/plugin-mcp`),
   * created in the admin under "MCP API Keys".
   * Its scope is the agent's permission boundary for every chat user: every tool the key exposes
   * reaches the model. Grant only what the agent should be able to do.
   * The agent refuses `delete*` tools.
   */
  mcpApiKey: string;

  /**
   * Path or full URL of the Payload MCP endpoint. Change it only with a custom MCP `basePath`.
   * @default `<routes.api>/mcp` of the Payload config
   */
  mcpUrl?: string;

  /** Restrict which collections the agent can access. Default: all. */
  collections?: string[];

  /** Restrict which globals the agent can access. Default: all. */
  globals?: string[];

  /**
   * Show a 1-5 star rating widget, with an optional comment, under the chat.
   * Adds GET and POST `/content-agent/rating`.
   * @default false
   */
  chatRating?: boolean;

  /** Custom instructions appended to the agent's system prompt. */
  customInstructions?: string;

  /**
   * CMS-editable instructions for every user of the agent (brand voice, editorial rules, glossary).
   * `true` registers a `content-agent-instructions` global, which needs a migration: narrow its
   * `access.update`. Pass `{ source }` to read from your own structure; then nothing is registered.
   */
  instructions?: InstructionsOption;

  /**
   * Extensions built on the module SDK (`@focus-reactive/payload-plugin-content-agent/sdk`),
   * applied in array order. On a tool name clash the core tool or the earlier module keeps
   * the name. An entry may be an array of modules.
   */
  modules?: Array<ContentAgentModule | ContentAgentModule[]>;

  /**
   * How the schema is rendered into the system prompt: 'full' lists every field, 'compact' lists
   * blocks by slug, 'auto' switches to compact above about 24k characters.
   * @default 'auto'
   */
  schemaPromptMode?: "full" | "compact" | "auto";

  /** API route path for the chat endpoint. @default '/content-agent/chat' */
  apiRoute?: string;

  /**
   * Who may use the agent endpoints. Return true to allow. Default: users of the admin auth
   * collection only, because MCP calls run under the plugin API key, not the caller's permissions.
   * @example access: ({ req }) => ['users', 'editors'].includes(req.user?.collection)
   */
  access?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>;

  /**
   * Postgres connection string for the memory system. It may be the Payload database.
   * Without it, memory is off and the agent is stateless.
   */
  memoryDatabaseUrl?: string;

  /**
   * How much the main model reasons before it answers. More reasoning makes each turn slower.
   * A model that cannot turn reasoning off gets its lowest level for `none`.
   * @default 'none'
   */
  reasoningEffort?: "none" | "low" | "medium" | "high";

  /**
   * After a turn, let a background model read the conversation and save the user's preferences
   * and patterns to long-term memory by itself. Off: nothing is saved after a turn.
   * @default false
   */
  ltmCurator?: boolean;

  /**
   * What a telemetry row keeps. `'usage'`: steps, tool names, timings, tokens and errors.
   * `'full'` also keeps the input of every tool call and the start of its result, which hold
   * content of the site. Turn it on to look into a problem.
   * @default 'usage'
   */
  telemetry?: "usage" | "full";

  /**
   * Cheaper model for background tasks (distillation, LTM curation, reflection).
   * Default: the cheaper model of `provider`; without `provider`, the main model.
   */
  backgroundModel?: string | LanguageModel;

  /**
   * Model for the in-turn sub-agents (Content Editor, Reviewer).
   * Default: the cheaper model of `provider`; without `provider`, the main model.
   */
  subagentModel?: string | LanguageModel;

  /**
   * The agent reads and writes content through the MCP tools only, with no Local API behind
   * them. A collection without an MCP tool and every global are then out of its reach.
   * @default false
   */
  mcpOnly?: boolean;

  /**
   * The agent may look at the file of an upload document (the tool `viewImage`), for example to
   * write an alt text. Set it to `false` when the model takes no picture as input.
   * @default true
   */
  imageInput?: boolean;

  /** Max documents edited in parallel by editContent / translateContent. @default 5 */
  bulkConcurrency?: number;

  /**
   * Max documents processed in parallel by findReplaceContent, which runs no LLM.
   * Default: max(bulkConcurrency * 2, 10), capped at 25.
   */
  findReplaceConcurrency?: number;

  /**
   * Time in ms from the start of the chat request after which a bulk tool starts no new documents
   * and returns the rest as `remaining`. Keep it under the host's request limit. 0 disables.
   * @default 180000
   */
  bulkTimeBudgetMs?: number;

  /**
   * The most tokens one chat request may use, input and output of every agent together, cached
   * input counted in full. When it is reached the agent stops after its current step and a
   * bulk run starts no new documents. 0 disables.
   * @default 3000000
   */
  turnTokenBudget?: number;

  /**
   * Embedding model for semantic memory search. The embedding columns take the size of its vectors.
   * @example openai.embedding('text-embedding-3-small')
   */
  embeddingModel?: EmbeddingModel;

  /** Token budget for context management. Omitted fields use the defaults. */
  contextBudget?: {
    compactionThreshold?: number;
    compactionTarget?: number;
    compactionHardLimit?: number;
    recencyBufferMessages?: number;
  };
}

export interface ResolvedPluginOptions extends Required<
  Omit<
    ContentAgentPluginOptions,
    | "disabled"
    | "provider"
    | "apiKey"
    | "access"
    | "collections"
    | "globals"
    | "chatRating"
    | "customInstructions"
    | "instructions"
    | "modules"
    | "schemaPromptMode"
    | "memoryDatabaseUrl"
    | "backgroundModel"
    | "subagentModel"
    | "bulkConcurrency"
    | "findReplaceConcurrency"
    | "bulkTimeBudgetMs"
    | "turnTokenBudget"
    | "embeddingModel"
    | "contextBudget"
    | "mcpUrl"
  >
> {
  model: LanguageModel;
  subagentModel: LanguageModel;
  /** Not set: the path is read from the Payload config at request time. */
  mcpUrl?: string;
  bulkConcurrency: number;
  findReplaceConcurrency: number;
  bulkTimeBudgetMs: number;
  turnTokenBudget: number;
  collections?: string[];
  globals?: string[];
  customInstructions?: string;
  instructions?: InstructionsOption;
  modules: ContentAgentModule[];
  schemaPromptMode: "full" | "compact" | "auto";
  memoryDatabaseUrl?: string;
  backgroundModel?: LanguageModel;
  embeddingModel?: EmbeddingModel;
  contextBudget?: {
    compactionThreshold?: number;
    compactionTarget?: number;
    compactionHardLimit?: number;
    recencyBufferMessages?: number;
  };
}

/**
 * One field of a collection, a global or a block, as the agent reads it from the Payload config.
 * @public
 */
export interface SchemaField {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  hasMany?: boolean;
  /** For relationship, upload and join fields. */
  relationTo?: string | string[];
  /** For select and radio fields. */
  options?: Array<{ label: string; value: string } | string>;
  /** Nested fields of a group or array. */
  fields?: SchemaField[];
  /**
   * Block types: those a `blocks` field may hold, or those a `richText` field can embed
   * (addressed by block id, e.g. `content[blockId].heading`).
   */
  blocks?: Array<{
    slug: string;
    /** From `block.labels.singular`. */
    label?: string;
    /** From `block.admin.custom.description`. */
    description?: string;
    /** From `block.admin.group`. */
    group?: string;
    fields: SchemaField[];
  }>;
  /** Inline block types a `richText` field can embed. Same shape and addressing as `blocks`. */
  inlineBlocks?: SchemaField["blocks"];
  /** The rich text adapter. Only 'lexical' is editable; the others are marked `unsupported`. */
  editor?: "lexical" | "slate" | "unknown";
  /** The field stores a separate value per locale. */
  localized?: boolean;
  /** The agent never writes the field: `admin.readOnly`, `admin.hidden` or `virtual`. */
  readOnly?: boolean;
  /** The database refuses a value another document already has. */
  unique?: boolean;
  /** Feature keys the Lexical editor of a `richText` field has enabled. */
  features?: string[];
  /** Node types the Lexical editor of a `richText` field registers, next to the core ones. */
  nodeTypes?: string[];
  /** The field has an `admin.condition` and may be hidden depending on other values. */
  conditional?: boolean;
  /** A field type the agent cannot edit: a custom type or non-Lexical rich text. */
  unsupported?: boolean;
  /** Admin description. */
  description?: string;
  /** Default value, primitives only. */
  defaultValue?: string | number | boolean;
  /** Row limits of an array or blocks field. */
  minRows?: number;
  maxRows?: number;
}

/**
 * One collection the agent may access.
 * @public
 */
export interface SchemaCollection {
  slug: string;
  labels?: { singular?: string; plural?: string };
  description?: string;
  fields: SchemaField[];
  hasVersions: boolean;
  hasDrafts: boolean;
  hasAuth: boolean;
  timestamps: boolean;
  /** The collection is upload-enabled: its documents are file-backed. */
  upload?: boolean;
  /** The field Payload shows as a document's title (`admin.useAsTitle`). */
  useAsTitle?: string;
}

/**
 * One global the agent may access.
 * @public
 */
export interface SchemaGlobal {
  slug: string;
  label?: string;
  description?: string;
  fields: SchemaField[];
  hasVersions: boolean;
  hasDrafts: boolean;
}

/**
 * The schema of the site as the agent sees it: read from the Payload config at run time.
 * @public
 */
export interface SchemaContext {
  collections: SchemaCollection[];
  globals: SchemaGlobal[];
  /** Configured locale codes. Absent means the project is not localized. */
  locales?: string[];
  /** The default locale code. */
  defaultLocale?: string;
}
