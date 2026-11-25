import { pathToFileURL } from "node:url";
import { buildConfig } from "payload";
import type { CollectionConfig } from "payload";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { postgresAdapter } from "@payloadcms/db-postgres";
import { mcpPlugin } from "@payloadcms/plugin-mcp";
import { contentAgentPlugin, withContentAgent } from "@focus-reactive/payload-plugin-content-agent";
import { activeSchema } from "./schemas";
import { scriptedModel } from "./scriptedModel";

const schema = activeSchema();
const port = process.env.LAB_PORT || "3100";
const databaseUrl = process.env.LAB_DATABASE_URL;

if (!databaseUrl)
  throw new Error("LAB_DATABASE_URL is not set. Start the host with `node lab/start.mjs`.");

const Users: CollectionConfig = {
  slug: "users",
  auth: true,
  admin: { useAsTitle: "email" },
  fields: [],
};

const modelMode = process.env.LAB_MODEL || "openai";
const models =
  modelMode === "scripted"
    ? { model: scriptedModel() }
    : {
        provider: modelMode as "openai" | "anthropic",
        ...(process.env.LAB_API_KEY ? { apiKey: process.env.LAB_API_KEY } : {}),
        ...(process.env.LAB_MODEL_ID ? { model: process.env.LAB_MODEL_ID } : {}),
        ...(process.env.LAB_SUBAGENT_MODEL_ID
          ? { subagentModel: process.env.LAB_SUBAGENT_MODEL_ID }
          : {}),
        ...(process.env.LAB_BACKGROUND_MODEL_ID
          ? { backgroundModel: process.env.LAB_BACKGROUND_MODEL_ID }
          : {}),
      };

// Node loads the file at run time, so the bundler must not try to resolve the path.
async function labModules() {
  const file = process.env.LAB_MODULES;

  if (!file) return [];
  const loaded = await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(file).href
  );

  return [loaded.default].flat();
}

const modules = await labModules();

export default buildConfig({
  editor: lexicalEditor(),
  secret: process.env.LAB_PAYLOAD_SECRET || "lab-secret-not-for-production",
  serverURL: `http://localhost:${port}`,
  db: postgresAdapter({ pool: { connectionString: databaseUrl }, push: true }),
  admin: { user: Users.slug },
  collections: [Users, ...schema.collections],
  globals: schema.globals,
  ...(schema.localization ? { localization: { ...schema.localization, fallback: true } } : {}),
  plugins: [
    // Every collection and global is open to the MCP key, delete included, as on a real host.
    mcpPlugin(
      withContentAgent(
        {
          collections: Object.fromEntries(
            schema.collections.map((c) => [c.slug, { enabled: true }])
          ),
          globals: Object.fromEntries(schema.globals.map((g) => [g.slug, { enabled: true }])),
        },
        process.env.LAB_DEFAULT_TOOLS
          ? { defaultTools: process.env.LAB_DEFAULT_TOOLS as "all" | "read" | "none" }
          : {}
      )
    ),
    contentAgentPlugin({
      ...models,
      mcpApiKey: process.env.LAB_MCP_API_KEY || "lab-mcp-key-0000-0000",
      memoryDatabaseUrl: databaseUrl,
      chatRating: true,
      instructions: true,
      telemetry: "full",
      modules,
      ...(process.env.LAB_TURN_TOKEN_BUDGET
        ? { turnTokenBudget: Number(process.env.LAB_TURN_TOKEN_BUDGET) }
        : {}),
      ...(process.env.LAB_REASONING_EFFORT
        ? {
            reasoningEffort: process.env.LAB_REASONING_EFFORT as "none" | "low" | "medium" | "high",
          }
        : {}),
    }),
  ],
  // No generated types: the host serves several schemas, and generated types would fit only one.
  typescript: { autoGenerate: false },
});
