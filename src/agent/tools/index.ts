import type { SharpDependency } from "payload";
import { siteAddress } from "../mcpUrl.js";
import type { ToolSet } from "ai";
import type { McpTool, Payload, PayloadUser } from "../../borders.js";
import type {
  AgentInstruction,
  EditRecordRef,
  SchemaContext,
  ResolvedPluginOptions,
} from "../../types.js";
import type { MemoryService } from "../../memory/index.js";
import type { TelemetryStorage } from "../../memory/storage/telemetry.js";
import { createSchemaInfoTool } from "./schemaInfo.js";
import { createMemoryTools } from "./memoryTools.js";
import { createGlossaryProposalTool, glossaryTargetOf } from "./glossaryProposal.js";
import { createWebTool } from "./web.js";
import { createImportArticleTool } from "./importArticle.js";
import { createSearchContentTool } from "./searchContent.js";
import { createCheckLinksTool } from "./checkLinks.js";
import {
  createImageConverter,
  createImageLoader,
  createViewImageTool,
  hasUploads,
} from "./viewImage.js";
import { createPresentVizTools } from "./presentViz.js";
import { createCloneDocumentTool } from "./cloneDocument.js";
import { createBlockLibraryTool, createCopyBlockTool } from "./blockLibrary.js";
import { createFindDocumentsTool } from "./findDocuments.js";
import { createContentEditorTools } from "../content/contentEditor.js";
import { createLinkProbe } from "./linkProbe.js";
import { createFindReplaceTool } from "../content/findReplace.js";
import { createDocumentIO } from "../content/documentIo.js";
import type { DocumentIO } from "../content/documentIo.js";
import { guardBlockWrites } from "./blockWriteGuard.js";
import { omitLocaleParam } from "../content/discovery.js";
import type { ContentAgentModule } from "../../sdk/contract.js";
import { mergeModuleTools, notifyEdits } from "../../moduleHost.js";
import type { ModuleTools } from "../../moduleHost.js";
import { createReadDocumentTool } from "./documents/readDocument.js";
import { createListDocumentsTool } from "./documents/listDocuments.js";
import { createCreateDocumentTool, creatableCollections } from "./documents/createDocument.js";
import { modelFacingMcpTools, wrapMcpTools } from "./mcp/wrapTools.js";
import { createUpdateDocumentTool } from "./documents/updateDocument.js";
import type { UpdateTarget } from "./documents/updateDocument.js";
import type { WriteGateContext } from "./mcp/writeGate.js";
import { createUntrustedMarker } from "./untrusted.js";
import type { FoundUrls } from "./foundUrls.js";
import type { TurnApprovals } from "../approvals.js";
import { askBeforeWrites } from "../content/manyDocuments.js";
import type { TurnBudget } from "../turnBudget.js";
import { caught } from "../../promises.js";

export function createIoReadTools(
  io: DocumentIO,
  schema: SchemaContext,
  siteUrl?: string,
  images?: { sessionHeaders?: Record<string, string>; sharp?: SharpDependency }
) {
  return {
    readDocument: createReadDocumentTool(io, schema),
    listDocuments: createListDocumentsTool(io, schema),
    checkLinks: createCheckLinksTool({ io, schema, siteUrl, probe: createLinkProbe(siteUrl) }),
    ...(images && hasUploads(schema)
      ? {
          viewImage: createViewImageTool({
            io,
            schema,
            load: createImageLoader(siteUrl, images.sessionHeaders),
            ...(images.sharp ? { convert: createImageConverter(images.sharp) } : {}),
          }),
        }
      : {}),
  };
}

function createDocumentWriteTools(
  io: DocumentIO,
  writeGate: WriteGateContext,
  updateTargets: UpdateTarget[]
) {
  return {
    ...(creatableCollections(io, writeGate.schema).length
      ? { createDocument: createCreateDocumentTool(io, writeGate.schema, writeGate.recordEdits) }
      : {}),
    updateDocument: createUpdateDocumentTool(writeGate, updateTargets),
  };
}

/** What a turn keeps of the chat request. */
export interface ChatRequestFacts {
  /** The login headers of the request: a file of the site opens with the person's rights. */
  sessionHeaders?: Record<string, string>;
}

export interface CreateToolsContext {
  memory?: MemoryService;
  conversationId?: string;
  userId?: string;
  telemetry?: TelemetryStorage | null;
  payload?: Payload;
  user?: PayloadUser;
  moduleTools?: ModuleTools[];
  recordEdits?: (refs: EditRecordRef[]) => void;
  agentInstructions?: AgentInstruction[];
  writeTracker?: { count: number; reports?: number };
  personMessage?: string;
  foundUrls?: FoundUrls;
  approvals?: TurnApprovals;
  budget?: TurnBudget;
  request?: ChatRequestFacts;
}

export interface EditRecorderDeps {
  memory?: MemoryService | null;
  conversationId?: string;
  userId?: string;
  schema: SchemaContext;
  writeTracker?: { count: number; reports?: number };
  modules?: ContentAgentModule[];
  waitUntil?: (pending: Promise<unknown>) => void;
}

export function createEditRecorder({
  memory,
  conversationId,
  userId,
  schema,
  writeTracker,
  modules,
  waitUntil,
}: EditRecorderDeps) {
  // The first record of a document keeps its state from before the conversation, so each record
  // waits for the one before it and they reach storage in the order of the writes.
  let previous: Promise<unknown> | null = null;

  return (refs: EditRecordRef[]) => {
    if (writeTracker) writeTracker.count += refs.length;

    if (memory && conversationId) {
      // A write without a locale lands in the default one: both are one row of the review.
      const changesetRefs = refs.map(
        ({ summary: _summary, toolName: _toolName, locale, ...changesetRef }) => ({
          ...changesetRef,
          locale: schema.defaultLocale ? (locale ?? schema.defaultLocale) : undefined,
        })
      );
      const pending = previous;

      const recordInTurn = async () => {
        if (pending) await pending;
        await memory.changesets.record(conversationId, changesetRefs);
      };

      const saved = caught(recordInTurn(), (err) => {
        console.warn(
          "[Content Agent] Failed to record changeset (review panel may miss this edit):",
          err instanceof Error ? err.message : err
        );
      });

      const settle = async () => {
        await saved;
        if (previous === saved) previous = null;
      };

      previous = saved;
      void settle();
      waitUntil?.(saved);
    }

    notifyEdits(
      modules,
      refs,
      { schema, conversationId, userId, db: memory?.db ?? null },
      waitUntil
    );
  };
}

function editRecorderFor(
  schema: SchemaContext,
  options: ResolvedPluginOptions,
  { recordEdits, memory, conversationId, userId, writeTracker }: CreateToolsContext
) {
  return (
    recordEdits ??
    createEditRecorder({
      memory,
      conversationId,
      userId,
      schema,
      writeTracker,
      modules: options.modules,
    })
  );
}

function turnReadTools(
  io: DocumentIO,
  schema: SchemaContext,
  { imageInput, mcpUrl }: ResolvedPluginOptions,
  { payload, request }: CreateToolsContext
) {
  return createIoReadTools(
    io,
    schema,
    // Not the origin of the request: it comes from a header that the sender chooses.
    payload?.config ? siteAddress(mcpUrl, payload.config) : undefined,
    imageInput
      ? { sessionHeaders: request?.sessionHeaders, sharp: payload?.config?.sharp }
      : undefined
  );
}

export function createTools<McpToolType extends McpTool>(
  mcpTools: Record<string, McpToolType>,
  schema: SchemaContext,
  options: ResolvedPluginOptions,
  context: CreateToolsContext = {}
) {
  const {
    memory,
    conversationId,
    userId,
    telemetry,
    payload,
    user,
    moduleTools,
    agentInstructions,
    personMessage,
    foundUrls,
    approvals,
  } = context;
  const recordEdits = editRecorderFor(schema, options, context);

  const documents: { io?: DocumentIO } = {};
  const writeGate = { schema, documentIo: () => documents.io!, recordEdits, approvals };
  const wrapped = wrapMcpTools(mcpTools, writeGate);
  // DocumentIO gets the uncapped tools: its snapshots, diffs and saves need whole documents.
  const io: DocumentIO = createDocumentIO({
    mcpTools: wrapped.safeMcpTools,
    schema,
    // Without them the document layer has no Local API to fall back on.
    ...(options.mcpOnly ? {} : { payload, user }),
    approvals,
  });

  documents.io = io;

  if (approvals) askBeforeWrites({ approvals, schema, io });

  const untrustedInput = { seen: false };
  const marksUntrusted = createUntrustedMarker(untrustedInput);

  const tools: Record<string, McpToolType | ToolSet[string]> = {
    ...guardBlockWrites(modelFacingMcpTools(wrapped)),
    ...turnReadTools(io, schema, options, context),
    ...createDocumentWriteTools(io, writeGate, wrapped.updateTargets),
    cloneDocument: createCloneDocumentTool(io, schema, recordEdits),
    findDocuments: createFindDocumentsTool(io, schema),
    getBlockLibrary: createBlockLibraryTool(io, schema),
    copyBlock: createCopyBlockTool(io, schema, recordEdits),
    ...createPresentVizTools(),
    getSchemaInfo: createSchemaInfoTool(schema),
    web: marksUntrusted(createWebTool(foundUrls?.refusal)),
    importArticle: marksUntrusted(createImportArticleTool(io, schema, recordEdits)),
    searchContent: createSearchContentTool(io, schema),
    ...createContentEditorTools({
      io,
      schema,
      model: options.subagentModel,
      concurrency: options.bulkConcurrency,
      telemetry,
      conversationId,
      recordEdits,
      config: payload?.config,
      agentInstructions,
      bulkTimeBudgetMs: options.bulkTimeBudgetMs,
      pendingStore: memory?.pendingBulk,
      probeLink: createLinkProbe(payload?.config?.serverURL),
      personMessage,
      approvals,
      budget: context.budget,
    }),
    ...createFindReplaceTool(io, schema, {
      concurrency: options.findReplaceConcurrency,
      recordEdits,
      approvals,
    }),
  };

  if (memory && conversationId && userId) {
    Object.assign(tools, createMemoryTools({ memory, options, conversationId, userId }));
  }

  const glossaryTarget = glossaryTargetOf(options.instructions, payload?.config?.routes?.admin);

  if (glossaryTarget) {
    tools.proposeGlossaryEntry = createGlossaryProposalTool(glossaryTarget, untrustedInput);
  }

  // A site with one locale has nothing to translate into.
  if (!schema.locales?.length) delete tools.translateContent;
  mergeModuleTools(tools, moduleTools, marksUntrusted);

  return omitLocaleParam(tools, schema);
}
