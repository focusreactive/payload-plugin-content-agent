import type { PayloadHandler, PayloadRequest } from "payload";
import type { MemoryService } from "../memory/index.js";
import type { ResolvedPluginOptions, SchemaContext } from "../types.js";
import { getMcpTools } from "../agent/mcpClient.js";
import type { McpServerTools } from "../agent/mcpClient.js";
import { createDocumentIO } from "../agent/content/documentIo.js";
import { resolveMcpUrl } from "../agent/mcpUrl.js";
import { BUILD_INFO } from "../buildInfo.js";
import { appliedMigrations } from "../memory/database.js";
import { runInitScanner, isInitialized } from "../memory/initScanner.js";

const RESCAN_MIN_INTERVAL_MS = 5 * 60 * 1000;

export function createInitHandlers(
  getOptions: () => Promise<ResolvedPluginOptions>,
  ensureSchema: (req: PayloadRequest) => Promise<SchemaContext>,
  getMemory: () => Promise<MemoryService | null>
) {
  const status: PayloadHandler = async (req) => {
    if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const memory = await getMemory();
      const identity = {
        build: BUILD_INFO,
        modules: (await getOptions()).modules.map((module) => module.name),
        migrations: memory ? await appliedMigrations(memory.db) : [],
      };

      if (!memory) return Response.json({ initialized: false, memoryEnabled: false, ...identity });

      return Response.json({
        initialized: await isInitialized(memory),
        memoryEnabled: true,
        ...identity,
      });
    } catch (err) {
      console.error("[Content Agent] Init status endpoint error:", err);

      return Response.json({ initialized: false, memoryEnabled: false, build: BUILD_INFO });
    }
  };

  const run: PayloadHandler = async (req) => {
    if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const memory = await getMemory();

    if (!memory) return Response.json({ error: "Memory is not configured" }, { status: 400 });

    try {
      const last = await memory.backgroundReports.getLastCompletedWorker("init-scanner");

      if (last?.completedAt) {
        const elapsed = Date.now() - new Date(last.completedAt).getTime();

        if (elapsed < RESCAN_MIN_INTERVAL_MS) {
          const waitSec = Math.ceil((RESCAN_MIN_INTERVAL_MS - elapsed) / 1000);

          return Response.json(
            { error: `Init scan ran recently - please wait ${waitSec}s before re-running.` },
            { status: 429 }
          );
        }
      }

      const opts = await getOptions();
      const schema = await ensureSchema(req);
      const mcpUrl = resolveMcpUrl(opts.mcpUrl, req.payload.config);

      let mcpTools: McpServerTools = {};

      try {
        mcpTools = await getMcpTools(mcpUrl, opts.mcpApiKey);
      } catch (error) {
        console.warn(
          "[Content Agent] Init: MCP unavailable, scanning via Local API only:",
          error instanceof Error ? error.message : error
        );
      }

      const io = createDocumentIO({
        mcpTools,
        schema,
        ...(opts.mcpOnly ? {} : { payload: req.payload, user: req.user }),
      });
      const result = await runInitScanner(io, schema, memory, mcpUrl);

      return Response.json(result, { status: result.ok ? 200 : 500 });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Init failed" },
        { status: 500 }
      );
    }
  };

  return { status, run };
}
