// The text the model reads (system prompts, tool descriptions, parameter descriptions) is locked by hash.
// A refactor must leave every hash unchanged. A change on purpose: run
// `UPDATE_MODEL_TEXT_LOCK=1 npx vitest run tests/modelText.test.ts` and commit tests/fixtures/modelText.lock.json.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asSchema } from "ai";
import { z } from "zod";
import { buildSystemPrompt } from "../src/agent/systemPrompt.js";
import { buildToolAvailabilityNote, analyzeToolCoverage } from "../src/agent/toolCoverage.js";
import { buildInstructionsNote, buildSubAgentInstructionsNote } from "../src/agent/instructions.js";
import { changedDocumentsNote } from "../src/agent/changedDocuments.js";
import { createIoReadTools, createTools } from "../src/agent/tools/index.js";
import { createFinishEditTool } from "../src/agent/content/editor/checks.js";
import { layerInstructions } from "../src/mcpLayer/instructions.js";
import { LAYER_TOOLS } from "../src/mcpLayer/tools.js";
import { REVIEWER_INSTRUCTIONS } from "../src/agent/subAgents/reviewer.js";
import { CONTENT_EDITOR_INSTRUCTIONS } from "../src/agent/content/editorPrompts.js";
import { createOutcomeTools } from "../src/agent/content/outcomeCriteria.js";
import { createAskPersonTool } from "../src/agent/content/editor/askPerson.js";
import { createBlockTools } from "../src/agent/content/blockTools.js";
import type { DocumentWorkspace } from "../src/agent/content/blockTools.js";
import { createLookupTools } from "../src/agent/content/lookupTools.js";
import { createDocumentRewriteTools } from "../src/agent/content/documentRewrite.js";
import { createWorkspaceTools } from "../src/agent/content/workspaceTools.js";
import { createRichTextTools } from "../src/agent/content/richtextTools.js";
import { omitLocaleParam } from "../src/agent/content/discovery.js";
import { CURATOR_SYSTEM_PROMPT } from "../src/memory/ltmCurator.js";
import { DISTILLATION_SYSTEM_PROMPT } from "../src/memory/distillation.js";
import { REFLECT_SYNTHESIS_INSTRUCTIONS } from "../src/memory/reflect.js";
import type { SchemaContext } from "../src/types.js";
import { pluginOptions } from "./harness.js";

const LOCK = fileURLToPath(new URL("fixtures/modelText.lock.json", import.meta.url));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const collection = (slug: string, fields: unknown[]) => ({
  slug,
  fields,
  hasVersions: true,
  hasDrafts: true,
  hasAuth: false,
  timestamps: true,
});
const localized: SchemaContext = {
  globals: [
    {
      slug: "site-settings",
      fields: [{ name: "siteName", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
    },
  ],
  collections: [
    collection("posts", [
      { name: "title", type: "text" },
      { name: "content", type: "richText" },
      {
        name: "layout",
        type: "blocks",
        blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }],
      },
    ]),
    collection("media", [{ name: "alt", type: "text" }]),
  ],
  locales: ["en", "es"],
  defaultLocale: "en",
} as SchemaContext;
const withUploads = {
  ...localized,
  collections: [
    ...localized.collections,
    { ...collection("images", [{ name: "alt", type: "text" }]), upload: true },
  ],
} as SchemaContext;
const singleLocale = {
  ...localized,
  locales: undefined,
  defaultLocale: undefined,
} as SchemaContext;

const options = pluginOptions();

const mcpTool = (description: string, shape: z.ZodRawShape) => ({
  description,
  inputSchema: z.object(shape),
  execute: async () => ({ content: [] }),
});
const mcpTools = {
  findPosts: mcpTool("Find posts.", {
    where: z.string().optional(),
    draft: z.boolean().optional(),
  }),
  createPosts: mcpTool("Create a post.", { title: z.string(), draft: z.boolean().optional() }),
  updatePosts: mcpTool("Update a post.", { id: z.string(), draft: z.boolean().optional() }),
  findMedia: mcpTool("Find media.", { where: z.string().optional() }),
  findSiteSettings: mcpTool("Find site settings.", {}),
  updateSiteSettings: mcpTool("Update site settings.", { draft: z.boolean().optional() }),
};

type Hashes = Record<string, string>;

async function toolHashes(tools: Record<string, unknown>): Promise<Hashes> {
  const out: Hashes = {};

  for (const name of Object.keys(tools).sort()) {
    const tool = tools[name] as { description?: unknown; inputSchema?: unknown };
    const description =
      typeof tool.description === "function" ? String(tool.description) : tool.description;
    const schema = tool.inputSchema
      ? await asSchema(tool.inputSchema as Parameters<typeof asSchema>[0]).jsonSchema
      : null;

    out[name] = sha(JSON.stringify({ description, schema }));
  }

  return out;
}

const single = (name: string, tool: unknown) => ({ [name]: tool });

const workspace = (): DocumentWorkspace => ({ ref: { current: null }, collection: null });

async function collect(): Promise<Record<string, Hashes>> {
  const memory = {
    pendingBulk: undefined,
    changesets: { record: async () => {} },
  } as never;
  const withMemory = { memory, conversationId: "c", userId: "u" };
  const io = {} as never;

  const editorTools = (schema: SchemaContext) =>
    omitLocaleParam(
      {
        ...createOutcomeTools({ criteria: [] }),
        askPerson: createAskPersonTool({ question: "" }),
        ...createBlockTools(workspace(), schema, {}),
        ...createLookupTools(io, schema),
        ...createRichTextTools(workspace(), schema),
        ...createDocumentRewriteTools(workspace(), schema, { textPassReads: 0 }),
      },
      schema
    );

  const prompt = (
    schema: SchemaContext,
    mode: "full" | "compact" | "auto",
    memoryEnabled: boolean,
    extras = false
  ) => {
    const { stable, volatile } = buildSystemPrompt({
      schemaContext: schema,
      customInstructions: extras ? "Write in British English." : undefined,
      pageContext: extras ? { collection: "posts", documentId: "7" } : undefined,
      memoryAdditions: extras ? "MEMORY ADDITIONS" : undefined,
      toolAvailabilityNote: extras
        ? buildToolAvailabilityNote(analyzeToolCoverage(schema, {}), true)
        : undefined,
      schemaPromptMode: mode,
      memoryEnabled,
      glossaryEnabled: extras,
      moduleNote: extras ? "MODULE NOTE" : undefined,
      alwaysInstructionsNote: extras ? "ALWAYS NOTE" : undefined,
      modulePrompt: extras ? "MODULE PROMPT" : undefined,
    });

    return sha(`${stable}\n---\n${volatile}`);
  };

  const instructions = [
    { scope: "always", title: "Tone", text: "Be brief." },
    { scope: "writing", title: "Style", text: "Use sentence case." },
    { scope: "review", title: "Check", text: "Reject passive voice." },
  ] as never;

  return {
    systemPrompt: {
      "localized, auto, memory on": prompt(localized, "auto", true),
      "localized, auto, memory off": prompt(localized, "auto", false),
      "localized, full, memory on": prompt(localized, "full", true),
      "localized, compact, memory on": prompt(localized, "compact", true),
      "single locale, auto, memory on": prompt(singleLocale, "auto", true),
      "localized, auto, every optional part": prompt(localized, "auto", true, true),
    },
    prompts: {
      contentEditor: sha(CONTENT_EDITOR_INSTRUCTIONS),
      reviewer: sha(REVIEWER_INSTRUCTIONS),
      curator: sha(CURATOR_SYSTEM_PROMPT),
      distillation: sha(DISTILLATION_SYSTEM_PROMPT),
      reflectSynthesis: sha(REFLECT_SYNTHESIS_INSTRUCTIONS),
      "instructions note, always": sha(buildInstructionsNote(instructions, "always")),
      "instructions note, writing": sha(buildSubAgentInstructionsNote(instructions, "writing")),
      "instructions note, review": sha(buildSubAgentInstructionsNote(instructions, "review")),
      "changed documents note": sha(
        changedDocumentsNote([
          { collection: "c", id: "1", title: "T", created: true, locale: "en" },
          { collection: "c", id: "2", op: "discarded", created: false },
        ])
      ),
      "MCP layer instructions, all default tools": sha(layerInstructions("all")),
      "MCP layer instructions, read default tools": sha(layerInstructions("read")),
      "MCP layer instructions, no default tools": sha(layerInstructions("none")),
    },
    "orchestrator tools, memory on": await toolHashes(
      createTools(mcpTools, localized, { ...options, instructions: true }, withMemory)
    ),
    "orchestrator tools, memory off": await toolHashes(createTools(mcpTools, localized, options)),
    "orchestrator tools, single locale": await toolHashes(
      createTools(mcpTools, singleLocale, options, withMemory)
    ),
    "orchestrator tools, no MCP tools": await toolHashes(
      createTools({}, localized, options, withMemory)
    ),
    "editor tools": await toolHashes(editorTools(localized)),
    "editor tools, single locale": await toolHashes(editorTools(singleLocale)),
    "editor session tools": await toolHashes(
      single("finishEdit", createFinishEditTool({} as never))
    ),
    "image tools": await toolHashes(
      single("viewImage", createIoReadTools(io, withUploads, undefined, {}).viewImage)
    ),
    "MCP layer tools": await toolHashes(
      Object.fromEntries(
        LAYER_TOOLS.map((tool) => [
          tool.name,
          { description: tool.description, inputSchema: tool.input },
        ])
      )
    ),
    "workspace tools": await toolHashes(createWorkspaceTools(workspace(), io, localized)),
    "rich text tools": await toolHashes(createRichTextTools(workspace(), localized)),
  };
}

describe("the text the model reads is unchanged", async () => {
  const current = await collect();

  if (process.env.UPDATE_MODEL_TEXT_LOCK) {
    writeFileSync(LOCK, `${JSON.stringify(current, null, 2)}\n`);
  }

  if (!existsSync(LOCK)) {
    throw new Error(
      "tests/fixtures/modelText.lock.json is missing. Write it with UPDATE_MODEL_TEXT_LOCK=1 npx vitest run tests/modelText.test.ts and commit it."
    );
  }

  const lock: Record<string, Hashes> = JSON.parse(readFileSync(LOCK, "utf-8"));

  it("covers the same groups as the lock", () => {
    expect(Object.keys(current).sort()).toEqual(Object.keys(lock).sort());
  });

  for (const [group, hashes] of Object.entries(current)) {
    it(`${group}: every text matches the lock`, () => {
      expect(Object.keys(hashes).length).toBeGreaterThan(0);
      const changed = Object.keys({ ...hashes, ...lock[group] }).filter(
        (name) => hashes[name] !== lock[group]?.[name]
      );

      expect(changed).toEqual([]);
    });
  }
});
