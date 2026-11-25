import { describe, it, expect } from "vitest";
import { createContentEditorTools } from "../src/agent/content/contentEditor.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  globals: [],
  locales: ["en", "de", "es"],
  defaultLocale: "en",
  collections: [
    {
      slug: "posts",
      fields: [{ name: "title", type: "text", localized: true }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
} as any;

const io = {
  read: async () => ({ doc: null, error: "boom" }),
  write: async () => ({}),
  create: async () => ({}),
  list: async () => ({ docs: [], totalPages: 1, totalDocs: 0 }),
  transports: () => ({ read: "local", write: "local" }),
  lockRefusal: async () => null,
} as any;

const tools = () =>
  createContentEditorTools({
    io,
    schema,
    model: {} as any,
    concurrency: 1,
    telemetry: null,
  });
const translate = (tool: any, context: any, to: string) =>
  tool.execute({ collection: "posts", id: "1", to }, { toolCallId: "t", messages: [], context });

describe("translateContent: the session limit of one document in one turn", () => {
  it("refuses the third translation of one document into one locale", async () => {
    const context = { contentEditorRuns: {} };
    const { translateContent } = tools();
    const results = [];

    for (let i = 0; i < 3; i++) results.push(await translate(translateContent, context, "de"));

    expect(JSON.stringify(results[0])).toMatch(/boom/u);
    expect(JSON.stringify(results[1])).toMatch(/boom/u);
    expect(JSON.stringify(results[2])).toMatch(/translateContent session #3/u);
  });

  it("counts each target locale by itself", async () => {
    const context = { contentEditorRuns: {} };
    const { translateContent } = tools();

    await translate(translateContent, context, "de");
    await translate(translateContent, context, "de");
    const other = await translate(translateContent, context, "es");

    expect(JSON.stringify(other)).not.toMatch(/session #/u);
  });
});
