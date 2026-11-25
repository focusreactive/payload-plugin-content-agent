import { isRecord } from "../../../borders.js";
import type { McpCallOptions, McpTool } from "../../../borders.js";
import { writeStatusOf } from "../../writeStatus.js";
import type { SchemaContext } from "../../../types.js";
import { normalizeSlug } from "../../mcpNames.js";
import { capMcpToolOutput } from "../outputCap.js";
import { advertisedParams, descriptionOf, isDocumentReader, runMcpTool } from "./shared.js";
import type { UpdateTarget } from "../documents/updateDocument.js";
import { gatedMcpWrite } from "./writeGate.js";
import type { WriteGateContext } from "./writeGate.js";

const globalSlugFor = (schema: SchemaContext, name: string): string | undefined => {
  const lower = name.toLowerCase();
  const rest = lower.startsWith("update")
    ? lower.slice(6)
    : lower.startsWith("find")
      ? lower.slice(4)
      : "";

  return rest
    ? schema.globals.find((global) => normalizeSlug(global.slug) === rest)?.slug
    : undefined;
};

const collectionSlugFor = (schema: SchemaContext, name: string): string | undefined => {
  const lower = name.toLowerCase();
  const rest = lower.startsWith("find")
    ? lower.slice(4)
    : lower.startsWith("create") || lower.startsWith("update")
      ? lower.slice(6)
      : "";

  return rest
    ? schema.collections.find((collection) => normalizeSlug(collection.slug) === rest)?.slug
    : undefined;
};

const PUBLISHED_ONLY_NOTE =
  "\n\nNOTE: this tool has no `draft` parameter, so it returns the PUBLISHED version only. It cannot see " +
  "unpublished drafts, including a draft you just saved. Never use it to check whether a save landed or as " +
  "the starting point for an edit - use readDocument for that.";

// A description can be a function of the server; only a text gets the note.
function withPublishedOnlyNote(mcpTool: McpTool): unknown {
  const description = descriptionOf(mcpTool);

  if (description === undefined) return PUBLISHED_ONLY_NOTE.trimStart();

  return typeof description === "string" ? `${description}${PUBLISHED_ONLY_NOTE}` : description;
}

export interface WrappedMcpTools<McpToolType extends McpTool> {
  safeMcpTools: Record<string, McpToolType>;
  passthroughTools: string[];
  publishedOnlyReaders: string[];
  refusedDeleteTools: string[];
  ungatedWriteTools: string[];
  /** The site's update tools of the schema: the model reaches them through `updateDocument`. */
  updateTargets: UpdateTarget[];
}

interface McpEntry<McpToolType extends McpTool> {
  name: string;
  mcpTool: McpToolType;
  lower: string;
  isFind: boolean;
  isWrite: boolean;
  collSlug: string | undefined;
  globSlug: string | undefined;
  advertised: Set<string> | null;
  draftAware: boolean;
}

// A `create*` or `update*` tool of a collection outside the agent's schema has no review gate.
// The agent still never publishes: `draft` is a default for a reader and fixed for a writer.
function passthroughParams<McpToolType extends McpTool>(
  { advertised, draftAware, isWrite }: McpEntry<McpToolType>,
  params: Record<string, unknown>
): Record<string, unknown> {
  if (!draftAware) return params;
  if (!isWrite) return { draft: true, ...params };

  return { ...params, draft: true, ...(advertised?.has("_status") ? { _status: "draft" } : {}) };
}

/** A write through a tool with no `draft` parameter is on the live site at once. */
const asLiveWrite = (result: unknown): unknown =>
  isRecord(result) && writeStatusOf(result) === "done"
    ? { ...result, writeStatus: "live-write" }
    : result;

// A tool of the site can fail on its own. The document tools of the agent do not depend on it.
async function failsWithNextStep(name: string, run: () => unknown): Promise<unknown> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    throw new Error(
      `${message} This failure is in ${name}, a tool of the site. The document tools of the agent do not depend on it: readDocument reads any field of a document, and updateDocument or editContent changes it. Use them instead of calling ${name} again.`,
      { cause: err }
    );
  }
}

function wrapPassthroughTool<McpToolType extends McpTool>(
  entry: McpEntry<McpToolType>,
  schemaHasDrafts: boolean,
  wrapped: WrappedMcpTools<McpToolType>
): void {
  const { name, mcpTool, advertised, draftAware, isWrite } = entry;
  const publishedOnly =
    !!advertised && !draftAware && schemaHasDrafts && isDocumentReader(name, advertised);

  if (publishedOnly) wrapped.publishedOnlyReaders.push(name);
  wrapped.safeMcpTools[name] = {
    ...mcpTool,
    ...(publishedOnly && {
      description: withPublishedOnlyNote(mcpTool),
    }),
    execute: async (params: Record<string, unknown>, options: McpCallOptions) => {
      const result = capMcpToolOutput(
        await failsWithNextStep(name, () =>
          runMcpTool(name, mcpTool, passthroughParams(entry, params), options)
        )
      );

      return isWrite && !draftAware ? asLiveWrite(result) : result;
    },
  };
  wrapped.passthroughTools.push(name);
  if (isWrite) wrapped.ungatedWriteTools.push(name);
}

function wrapContentTool<McpToolType extends McpTool>(
  context: WriteGateContext,
  entry: McpEntry<McpToolType>,
  wrapped: WrappedMcpTools<McpToolType>
): void {
  const { schema } = context;
  const { name, mcpTool, lower, isFind, isWrite, collSlug, globSlug, advertised, draftAware } =
    entry;
  // plugin-mcp's find{Global} takes no `draft`:
  // on a global it always reads the published version.
  const findTargetHasDrafts =
    isFind &&
    (collSlug
      ? !!schema.collections.find((collection) => collection.slug === collSlug)?.hasDrafts
      : !!schema.globals.find((global) => global.slug === globSlug)?.hasDrafts);
  const findPublishedOnly = findTargetHasDrafts && !!advertised && !draftAware;

  if (findPublishedOnly) wrapped.publishedOnlyReaders.push(name);
  const writeSlug = isWrite ? collSlug : undefined;
  const writeGlobalSlug = isWrite && !writeSlug ? globSlug : undefined;

  if (lower.startsWith("update") && (writeSlug || writeGlobalSlug))
    wrapped.updateTargets.push({ mcpTool, collection: writeSlug, global: writeGlobalSlug });
  wrapped.safeMcpTools[name] = {
    ...mcpTool,
    ...(findPublishedOnly && {
      description: withPublishedOnlyNote(mcpTool),
    }),
    ...(isFind && {
      // A default, not forced:
      // the agent may pass draft:false when the user asks for the published version.
      execute: async (params: Record<string, unknown>, options: McpCallOptions) =>
        runMcpTool(name, mcpTool, { draft: true, ...params }, options),
    }),
    ...(isWrite &&
      (writeSlug || writeGlobalSlug) && {
        execute: async (rawParams: Record<string, unknown>, options: McpCallOptions) =>
          gatedMcpWrite(
            context,
            { name, mcpTool, lower, writeSlug, writeGlobalSlug },
            rawParams,
            options
          ),
      }),
  };
}

// The tools are wrapped on every chat request: each report reaches the server log once.
const reported = new Set<string>();

function reportOnce(log: (message: string) => void, message: string): void {
  if (reported.has(message)) return;
  reported.add(message);
  log(message);
}

function reportWrapping({
  passthroughTools,
  publishedOnlyReaders,
  refusedDeleteTools,
  ungatedWriteTools,
}: Omit<WrappedMcpTools<McpTool>, "safeMcpTools" | "updateTargets">): void {
  if (ungatedWriteTools.length) {
    reportOnce(
      console.warn,
      `[Content Agent] ${ungatedWriteTools.length} MCP write tool(s) belong to no collection or global of the agent's schema: ${ungatedWriteTools.join(", ")}. The agent can call them, saves as a draft where the tool takes \`draft\`, and runs no review, no drafts-only rule and no change record for them. Remove them from the MCP key, or add the collection to the plugin's \`collections\`.`
    );
  }

  if (refusedDeleteTools.length) {
    reportOnce(
      console.warn,
      `[Content Agent] The agent never deletes documents. The MCP key gives ${refusedDeleteTools.length} delete tool(s) and the agent gets none of them: ${refusedDeleteTools.join(", ")}.`
    );
  }

  if (passthroughTools.length) {
    reportOnce(
      console.log,
      `[Content Agent] ${passthroughTools.length} MCP tool(s) outside the recognized content CRUD convention passed through as-is (no write-gate/changeset-recording; draft:true by default when the tool declares \`draft\`; output size is still capped): ${passthroughTools.join(", ")}.`
    );
  }

  if (publishedOnlyReaders.length) {
    reportOnce(
      console.warn,
      `[Content Agent] ${publishedOnlyReaders.length} MCP reader tool(s) declare no \`draft\` parameter and can only return PUBLISHED versions, while this schema has drafts: ${publishedOnlyReaders.join(", ")}. ` +
        "The model is told that they read the published version only, and the content agent reads drafts through the Local API instead, or refuses the read with mcpOnly. Add a `draft` parameter to these tools to make them draft-aware."
    );
  }
}

export function wrapMcpTools<McpToolType extends McpTool>(
  mcpTools: Record<string, McpToolType>,
  context: WriteGateContext
): WrappedMcpTools<McpToolType> {
  const { schema } = context;
  // Every tool of the MCP server reaches the agent: there is no name filter, by design.
  // Content CRUD tools get the safety wrapping; every other tool only gets its output capped.
  const wrapped: WrappedMcpTools<McpToolType> = {
    safeMcpTools: {},
    passthroughTools: [],
    publishedOnlyReaders: [],
    refusedDeleteTools: [],
    ungatedWriteTools: [],
    updateTargets: [],
  };
  const schemaHasDrafts =
    schema.collections.some((collection) => collection.hasDrafts) ||
    schema.globals.some((global) => global.hasDrafts);

  for (const [name, mcpTool] of Object.entries(mcpTools)) {
    const lower = name.toLowerCase();

    if (typeof mcpTool.execute !== "function") {
      reportOnce(
        console.warn,
        `[Content Agent] MCP tool "${name}" has no execute function - not offered.`
      );
      continue;
    }

    if (lower.startsWith("delete")) {
      wrapped.refusedDeleteTools.push(name);
      continue;
    }

    const isFind = lower.startsWith("find");
    const isWrite = lower.startsWith("create") || lower.startsWith("update");
    const collSlug = isFind || isWrite ? collectionSlugFor(schema, name) : undefined;
    const globSlug = (isFind || isWrite) && !collSlug ? globalSlugFor(schema, name) : undefined;
    const advertised = advertisedParams(mcpTool);
    // A reader that declares no `draft` parameter can only return the published version.
    const draftAware = !!advertised?.has("draft");
    const entry: McpEntry<McpToolType> = {
      name,
      mcpTool,
      lower,
      isFind,
      isWrite,
      collSlug,
      globSlug,
      advertised,
      draftAware,
    };

    if (!collSlug && !globSlug) {
      wrapPassthroughTool(entry, schemaHasDrafts, wrapped);
      continue;
    }

    wrapContentTool(context, entry, wrapped);
  }

  reportWrapping(wrapped);

  return wrapped;
}

/**
 * The site's tools the model calls by name: the ones outside the content CRUD of the schema.
 * The CRUD tools of a collection or global stay the transport of the document tools
 * (`readDocument`, `listDocuments`, `createDocument`, `updateDocument`), so the model's tool
 * list does not grow with the schema.
 */
export function modelFacingMcpTools<McpToolType extends McpTool>({
  safeMcpTools,
  passthroughTools,
}: WrappedMcpTools<McpToolType>): Record<string, McpToolType> {
  return Object.fromEntries(
    passthroughTools.flatMap((name) => {
      const mcpTool = safeMcpTools[name];

      return mcpTool ? [[name, mcpTool] as const] : [];
    })
  );
}
