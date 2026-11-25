import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asSchema } from "ai";
import { afterEach, describe, it, expect, vi } from "vitest";

import * as documentIo from "../src/agent/content/documentIo.js";
import { buildSystemPrompt } from "../src/agent/systemPrompt.js";
import { createTools } from "../src/agent/tools/index.js";
import type { SchemaContext, SchemaField } from "../src/types.js";
import { PROJECT_TERMS } from "./projectTerms.js";
import { pluginOptions } from "./harness.js";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

const GENERATED = new Set(["ui/generatedStyles.ts", "buildInfo.ts"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);

    if (statSync(full).isDirectory()) return walk(full);

    return /\.tsx?$/u.test(name) ? [full] : [];
  });
}

describe("the source names nothing of the projects it was built on", () => {
  it("no file of src holds a project term", () => {
    const offending = walk(SRC).flatMap((file) => {
      const relative = path.relative(SRC, file);

      if (GENERATED.has(relative)) return [];

      return readFileSync(file, "utf-8")
        .split("\n")
        .flatMap((line, index) => {
          const hit = PROJECT_TERMS.exec(line);

          return hit ? [`${relative}:${index + 1} "${hit[0]}"`] : [];
        });
    });

    expect(offending).toEqual([]);
  });
});

// A schema unlike the ones the plugin was built on: no field named after a title, a slug or
// a body, the blocks sit in a group, the editor has few features, the title field is declared.
const strip = { slug: "strip", fields: [{ name: "line", type: "text" }] as SchemaField[] };
const saying = {
  slug: "saying",
  fields: [
    { name: "words", type: "textarea" },
    { name: "voice", type: "relationship", relationTo: "voices" },
  ] as SchemaField[],
};

const schema: SchemaContext = {
  globals: [{ slug: "masthead", fields: [{ name: "motto", type: "text" }], hasVersions: false }],
  collections: [
    {
      slug: "ledgers",
      useAsTitle: "caption",
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
      fields: [
        { name: "caption", type: "text", required: true },
        { name: "code", type: "text", unique: true },
        {
          name: "memo",
          type: "richText",
          editor: "lexical",
          features: ["bold", "paragraph"],
          nodeTypes: [],
        },
        {
          name: "frame",
          type: "group",
          fields: [
            { name: "lead", type: "textarea" },
            { name: "rows", type: "blocks", blocks: [strip, saying] },
          ],
        },
        { name: "stamps", type: "array", fields: [{ name: "mark", type: "text" }] },
      ] as SchemaField[],
    },
    {
      slug: "voices",
      useAsTitle: "handle",
      hasVersions: false,
      hasDrafts: false,
      hasAuth: false,
      timestamps: true,
      fields: [{ name: "handle", type: "text" }] as SchemaField[],
    },
  ],
} as SchemaContext;

const paragraph = (text: string) => ({
  type: "paragraph",
  version: 1,
  children: [{ type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" }],
});
const memo = (...lines: string[]) => ({
  root: { type: "root", version: 1, children: lines.map(paragraph) },
});

function store() {
  return {
    ledgers: [
      {
        id: 1,
        caption: "North pier",
        code: "np-1",
        _status: "draft",
        memo: memo("The crane lifts at dawn.", "Old rope is replaced each spring."),
        frame: {
          lead: "A short lead about the pier.",
          rows: [
            { id: "s1", blockType: "strip", line: "Mind the tide" },
            { id: "q1", blockType: "saying", words: "Rope first, then sail.", voice: 5 },
          ],
        },
        stamps: [{ id: "m1", mark: "checked" }],
      },
      {
        id: 2,
        caption: "South quay",
        code: "sq-2",
        _status: "draft",
        memo: memo("Empty for now."),
        frame: { lead: "", rows: [] },
        stamps: [],
      },
    ],
    voices: [{ id: 5, handle: "Harbour master" }],
    masthead: [{ id: "masthead", motto: "Steady hands" }],
  } as Record<string, any[]>;
}

function fakeIo(all: Record<string, any[]>): documentIo.DocumentIO {
  const rowsOf = (target: documentIo.DocTarget) => all[target.collection ?? target.global ?? ""];
  const find = (target: documentIo.DocTarget, id: unknown) =>
    target.global
      ? rowsOf(target)?.[0]
      : rowsOf(target)?.find((doc) => String(doc.id) === String(id));

  return {
    transports: () => ({ read: "mcp", write: "mcp", create: "mcp" }),
    lockRefusal: async () => null,
    history: async () => ({ versions: [], total: 0 }),
    read: async (target, opts) => ({ doc: structuredClone(find(target, opts?.id) ?? null) }),
    write: async (target, opts) => {
      const doc = find(target, opts.id);

      if (!doc) return { error: "not found" };
      Object.assign(doc, structuredClone(opts.patch));

      return { doc: structuredClone(doc) };
    },
    create: async (target, opts) => {
      const doc = { id: rowsOf(target).length + 100, ...structuredClone(opts.data) };

      rowsOf(target).push(doc);

      return { doc: structuredClone(doc) };
    },
    list: async (collection, opts) => {
      const docs = (opts?.page ?? 1) === 1 ? structuredClone(all[collection] ?? []) : [];

      return { docs, totalPages: 1, totalDocs: (all[collection] ?? []).length };
    },
  };
}

const options = pluginOptions({ mcpUrl: undefined });

// The site's update tool: the transport of `updateDocument`, never in the model's tool set.
function siteUpdateTools(all: Record<string, any[]>) {
  return {
    updateLedgers: {
      execute: async ({ id, draft: _draft, _status, ...fields }: any) => {
        const doc = all.ledgers.find((row) => String(row.id) === String(id));

        Object.assign(doc, fields);

        return {
          content: [{ text: `Document updated successfully\n${JSON.stringify(doc)}` }],
        };
      },
    },
  };
}

function toolsOn(all = store()) {
  vi.spyOn(documentIo, "createDocumentIO").mockReturnValue(fakeIo(all));

  return createTools(siteUpdateTools(all), schema, options, {}) as Record<string, any>;
}

const call = (tools: Record<string, any>, name: string, input: unknown) =>
  tools[name].execute(input, { toolCallId: `call-${name}`, messages: [] });

// A tool that needs a model or the network is not run here; the evals run it.
const NOT_RUN_HERE = ["web", "importArticle", "editContent"];

const CALLS: Record<string, unknown> = {
  readDocument: { collection: "ledgers", id: 1 },
  listDocuments: { collection: "ledgers" },
  createDocument: { collection: "voices", data: { handle: "Pilot" } },
  updateDocument: {
    collection: "ledgers",
    id: 2,
    data: { caption: "South quay, east side" },
  },
  cloneDocument: {
    collection: "ledgers",
    sourceId: 1,
    data: { caption: "West dock", code: "wd-3" },
  },
  findDocuments: { query: "pier" },
  getBlockLibrary: { collection: "ledgers" },
  copyBlock: { toCollection: "ledgers", toId: 2, blocks: [{ fromId: 1, blockId: "s1" }] },
  getSchemaInfo: { target: "ledgers" },
  searchContent: { collection: "ledgers", query: "rope" },
  checkLinks: { collection: "ledgers" },
  findReplaceContent: { collection: "ledgers", find: "crane", replace: "winch", ids: [1] },
  present_table: { title: "T", columns: [{ key: "a", label: "A" }], rows: [{ a: 1 }] },
  present_metrics: { title: "M", cards: [{ label: "A", value: 1 }] },
  present_chart: { title: "C", series: [{ name: "s", data: [{ x: "a", y: 1 }] }] },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a schema unlike the ones the plugin was built on", () => {
  it("every tool is either run here or named as left to the evals", () => {
    expect(Object.keys(toolsOn()).sort()).toEqual([...Object.keys(CALLS), ...NOT_RUN_HERE].sort());
  });

  it.each(Object.entries(CALLS))("%s runs and reports no error", async (name, input) => {
    const result = await call(toolsOn(), name, input);

    expect(result?.error).toBeUndefined();
  });

  it("the writes and the search do their work on this schema", async () => {
    const all = store();
    const tools = toolsOn(all);
    const replaced: any = await call(tools, "findReplaceContent", CALLS.findReplaceContent);

    expect(replaced.changedDocs).toBe(1);
    expect(JSON.stringify(all.ledgers[0].memo)).toContain("winch");
    expect(JSON.stringify(all.ledgers[0].memo)).not.toContain("crane");

    const searched: any = await call(tools, "searchContent", CALLS.searchContent);

    expect(searched.matchedIds).toEqual([1]);

    const created: any = await call(tools, "createDocument", CALLS.createDocument);
    const cloned: any = await call(tools, "cloneDocument", CALLS.cloneDocument);

    expect(created.id).toBeDefined();
    expect(cloned.id).toBeDefined();
  });

  it("the tools use the fields the schema has", async () => {
    const all = store();
    const tools = toolsOn(all);

    const found: any = await call(tools, "findDocuments", { query: "pier" });

    expect(JSON.stringify(found)).toContain("North pier");

    const library: any = await call(tools, "getBlockLibrary", { collection: "ledgers" });

    expect(library.path).toBe("frame.rows");

    await call(tools, "copyBlock", {
      toCollection: "ledgers",
      toId: 2,
      blocks: [{ fromId: 1, blockId: "s1" }],
    });
    expect(all.ledgers[1].frame.rows[0]).toMatchObject({
      blockType: "strip",
      line: "Mind the tide",
    });

    const outline: any = await call(tools, "readDocument", {
      collection: "ledgers",
      id: 1,
      view: "outline",
    });

    expect(JSON.stringify(outline)).toContain("frame.rows");

    const links: any = await call(tools, "readDocument", {
      collection: "ledgers",
      id: 1,
      view: "links",
    });

    expect(links.error).toBeUndefined();
    expect(links.document).toBe("ledgers/1");
    expect(links.total).toBe(links.links.length);

    const preview: any = await call(tools, "updateDocument", {
      collection: "ledgers",
      id: 2,
      data: { caption: "South quay, east side" },
      preview: true,
    });

    expect(preview.error).toBeUndefined();
    expect(preview.fieldsChanged).toEqual(["caption"]);
    expect(all.ledgers[1].caption).not.toBe("South quay, east side");

    await call(tools, "updateDocument", {
      collection: "ledgers",
      id: 2,
      data: { caption: "South quay, east side" },
    });
    expect(all.ledgers[1].caption).toBe("South quay, east side");
  });

  it("the text the model reads on this schema holds no project term", async () => {
    const tools = toolsOn();
    const offending: string[] = [];
    const prompt = buildSystemPrompt({
      schemaContext: schema,
      memoryEnabled: false,
    });

    if (PROJECT_TERMS.test(prompt.stable + prompt.volatile)) offending.push("system prompt");

    for (const [name, tool] of Object.entries(tools)) {
      const input = tool.inputSchema
        ? JSON.stringify(await asSchema(tool.inputSchema).jsonSchema)
        : "";
      const hit = PROJECT_TERMS.exec(`${name}\n${tool.description ?? ""}\n${input}`);

      if (hit) offending.push(`tool ${name}: "${hit[0]}"`);
    }

    expect(offending).toEqual([]);
  });
});
