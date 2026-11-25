import { embed } from "ai";
import type { LanguageModel, EmbeddingModel } from "ai";
import { getPool, runMigrations, resolveVectorSchema } from "./database.js";
import type { DatabasePool } from "./database.js";
import { fitVectorColumns } from "./vectorColumns.js";
import { EmbeddingService } from "./embeddings.js";
import { ConversationStorage } from "./storage/conversations.js";
import { TemporalStorage } from "./storage/temporal.js";
import { LtmStorage } from "./storage/ltm.js";
import { PresentStateStorage } from "./storage/present.js";
import { BackgroundReportStorage } from "./storage/backgroundReports.js";
import { TelemetryStorage } from "./storage/telemetry.js";
import { ChangesetStorage } from "./storage/changesets.js";
import { ChatRatingStorage } from "./storage/chatRatings.js";
import { PendingBulkStorage } from "./storage/pendingBulk.js";
import {
  DEFAULT_CONTEXT_BUDGET,
  buildTemporalView,
  formatTemporalViewForMessages,
  formatPresentState,
  formatLtmForPrompt,
  formatBackgroundReports,
} from "./contextAssembler.js";
import type { ContextBudget, AssembledContext } from "./contextAssembler.js";
import { runDistillation, runConversationSummary } from "./distillation.js";
import { runLtmCuration } from "./ltmCurator.js";
import { caught } from "../promises.js";
import { embeddingTimeLimit } from "../modelCallTimeout.js";

export class MemoryService {
  readonly conversations: ConversationStorage;
  readonly temporal: TemporalStorage;
  readonly ltm: LtmStorage;
  readonly presentState: PresentStateStorage;
  readonly backgroundReports: BackgroundReportStorage;
  readonly embeddings: EmbeddingService | null;
  readonly telemetry: TelemetryStorage;
  readonly changesets: ChangesetStorage;
  readonly chatRatings: ChatRatingStorage;
  readonly pendingBulk: PendingBulkStorage;

  readonly db: DatabasePool;
  /** The background curator saves to long-term memory by itself only when the host turns it on. */
  ltmCurator = false;
  private budget: ContextBudget;

  constructor(
    db: DatabasePool,
    budget?: Partial<ContextBudget>,
    embeddingModel?: EmbeddingModel,
    vectorSchema?: string
  ) {
    this.db = db;
    this.budget = { ...DEFAULT_CONTEXT_BUDGET, ...budget };
    this.conversations = new ConversationStorage(db);
    this.temporal = new TemporalStorage(db);
    this.ltm = new LtmStorage(db);
    this.presentState = new PresentStateStorage(db);
    this.backgroundReports = new BackgroundReportStorage(db);
    this.telemetry = new TelemetryStorage(db);
    this.changesets = new ChangesetStorage(db);
    this.chatRatings = new ChatRatingStorage(db);
    this.pendingBulk = new PendingBulkStorage(db);
    this.embeddings = embeddingModel
      ? new EmbeddingService(db, embeddingModel, vectorSchema)
      : null;
  }

  async assembleContext(conversationId: string, userId: string): Promise<AssembledContext> {
    const [messages, summaries, presentState, ltmIdentity, ltmBehavior, backgroundReports] =
      await Promise.all([
        this.temporal.getMessages(conversationId),
        this.temporal.getSummaries(conversationId),
        this.presentState.get(conversationId),
        this.ltm.readWithShared(userId, "identity"),
        this.ltm.readWithShared(userId, "behavior"),
        this.backgroundReports.getUnsurfaced(conversationId),
      ]);

    const { view, droppedMessages, totalTokens, needsCompaction } = buildTemporalView(
      messages,
      summaries,
      this.budget
    );

    return {
      temporalView: view,
      droppedMessages,
      totalTokens,
      needsCompaction,
      presentState,
      ltmIdentity,
      ltmBehavior,
      backgroundReports,
    };
  }

  getSystemPromptAdditions(ctx: AssembledContext): string {
    const parts: string[] = [];

    const ltm = formatLtmForPrompt(ctx.ltmIdentity, ctx.ltmBehavior);

    if (ltm) parts.push(`\n# Memory\n${ltm}`);

    const present = formatPresentState(ctx.presentState);

    if (present) parts.push(`\n${present}`);

    return parts.join("\n");
  }

  getContextMessages(
    ctx: AssembledContext
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const msgs: Array<{ role: "user" | "assistant"; content: string }> = [];

    if (ctx.backgroundReports.length > 0) {
      msgs.push(...formatBackgroundReports(ctx.backgroundReports));
    }

    const summaries = ctx.temporalView.filter((item) => item.kind === "summary");

    if (summaries.length > 0) {
      msgs.push(...formatTemporalViewForMessages(summaries));
    }

    return msgs;
  }

  async saveMessage(
    conversationId: string,
    type: "user" | "assistant" | "tool_call" | "tool_result",
    content: string,
    parts?: unknown[]
  ) {
    return this.temporal.addMessage(conversationId, type, content, parts);
  }

  async runBackgroundTasks(
    conversationId: string,
    userId: string,
    model: LanguageModel,
    ctx: AssembledContext
  ): Promise<void> {
    if (ctx.backgroundReports.length > 0) {
      await this.backgroundReports.markSurfaced(ctx.backgroundReports.map((report) => report.id));
    }

    const tasks: Promise<void>[] = [];

    if (ctx.needsCompaction) {
      tasks.push(
        caught(runDistillation(conversationId, this, model, this.budget), (err) => {
          console.error("[Content Agent] Background distillation error:", err);
        })
      );
    } else if (this.embeddings) {
      tasks.push(
        caught(runConversationSummary(conversationId, this, model), (err) => {
          console.error("[Content Agent] Conversation summary error:", err);
        })
      );
    }

    if (this.ltmCurator) {
      tasks.push(
        caught(runLtmCuration(conversationId, userId, this, model), (err) => {
          console.error("[Content Agent] Background LTM curation error:", err);
        })
      );
    }

    await Promise.all(tasks);
  }

  get contextBudget(): ContextBudget {
    return this.budget;
  }
}

interface ProbedEmbeddingModel {
  model: EmbeddingModel;
  dimension: number;
}

const labelOf = (embeddingModel: EmbeddingModel): string =>
  typeof embeddingModel === "string" ? embeddingModel : embeddingModel.modelId;

async function probeEmbeddingDimension(
  embeddingModel: EmbeddingModel
): Promise<ProbedEmbeddingModel | undefined> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { embedding } = await embed({
        model: embeddingModel,
        value: "dimension probe",
        ...embeddingTimeLimit(),
      });

      return { model: embeddingModel, dimension: embedding.length };
    } catch (err) {
      if (attempt === 3) {
        console.warn(
          `[Content Agent] Failed to probe embeddingModel "${labelOf(embeddingModel)}" dimension (3 attempts) - embedding features disabled until restart:`,
          err instanceof Error ? err.message : err
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  return undefined;
}

async function modelThatFitsTheColumns(
  pool: DatabasePool,
  vectorSchema: string,
  embeddingModel: EmbeddingModel
): Promise<EmbeddingModel | undefined> {
  const probed = await probeEmbeddingDimension(embeddingModel);

  if (!probed) return undefined;

  try {
    const resized = await fitVectorColumns(pool, vectorSchema, probed.dimension);

    if (resized.length) {
      console.warn(
        `[Content Agent] embeddingModel "${labelOf(embeddingModel)}" produces ${probed.dimension}-dimension vectors. The embedding columns of ${resized.join(", ")} now have that size. The vectors of the earlier size are removed and are computed again in the background.`
      );
    }

    return probed.model;
  } catch (err) {
    console.warn(
      `[Content Agent] The embedding columns could not take ${probed.dimension} dimensions - embedding features disabled:`,
      err instanceof Error ? err.message : err
    );

    return undefined;
  }
}

async function backfillEmbeddings(embeddings: EmbeddingService): Promise<void> {
  try {
    const [ltm, summaries] = await Promise.all([
      embeddings.backfillLtm(),
      embeddings.backfillSummaries(),
    ]);

    if (ltm > 0 || summaries > 0) {
      console.log(
        `[Content Agent] Backfilled embeddings: ${ltm} LTM entries, ${summaries} summaries`
      );
    }
  } catch (err) {
    console.error(
      "[Content Agent] Embedding backfill error:",
      err instanceof Error ? err.message : err
    );
  }
}

export async function initMemory(
  connectionString: string,
  budget?: Partial<ContextBudget>,
  embeddingModel?: EmbeddingModel,
  moduleMigrations?: Array<{ module: string; migrations: Array<{ name: string; sql: string }> }>
): Promise<MemoryService> {
  const pool = getPool(connectionString);

  await runMigrations(pool, moduleMigrations);

  let validatedEmbeddingModel = embeddingModel;
  let vectorSchema: string | undefined;

  if (embeddingModel) {
    const resolved = await resolveVectorSchema(pool);

    if (!resolved) {
      console.warn(
        "[Content Agent] pgvector extension not installed - embedding features disabled."
      );
      validatedEmbeddingModel = undefined;
    } else {
      vectorSchema = resolved;

      try {
        await pool.query(
          `SELECT '[1,2,3]'::${resolved}.vector OPERATOR(${resolved}.<=>) '[1,2,3]'::${resolved}.vector`
        );
      } catch (err) {
        console.warn(
          "[Content Agent] pgvector unusable on this connection - embedding features disabled:",
          err instanceof Error ? err.message : err
        );
        validatedEmbeddingModel = undefined;
      }
    }
  }

  if (validatedEmbeddingModel && vectorSchema) {
    validatedEmbeddingModel = await modelThatFitsTheColumns(
      pool,
      vectorSchema,
      validatedEmbeddingModel
    );
  }

  const service = new MemoryService(pool, budget, validatedEmbeddingModel, vectorSchema);

  if (service.embeddings) {
    void backfillEmbeddings(service.embeddings);
  }

  return service;
}
