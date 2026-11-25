import { describe, it, expect } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { createContentEditorTools } from "../src/agent/content/contentEditor.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "body", type: "richText", editor: "lexical" },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const paragraph = (text: string) => ({
  type: "paragraph",
  version: 1,
  direction: "ltr",
  format: "",
  indent: 0,
  children: [{ type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" }],
});

const body = (...texts: string[]) => ({
  root: {
    type: "root",
    version: 1,
    direction: "ltr",
    format: "",
    indent: 0,
    children: texts.map(paragraph),
  },
});

function storeIo(initial: any) {
  const store = { doc: structuredClone(initial) };
  const io = {
    transports: () => ({ read: "local", write: "local", create: "local" }),
    lockRefusal: async () => null,
    read: async () => ({ doc: structuredClone(store.doc) }),
    write: async (_t: any, o: any) => {
      store.doc = { ...store.doc, ...o.patch };

      return { doc: structuredClone(store.doc) };
    },
    create: async () => ({}),
    list: async () => ({ docs: [], totalDocs: 0, totalPages: 1 }),
  } as any;

  return { io, store };
}

const call = (id: string, toolName: string, input: unknown) => ({
  type: "tool-call",
  toolCallId: id,
  toolName,
  input: JSON.stringify(input),
});

function editorModel(steps: unknown[][]) {
  let step = 0;

  return new MockLanguageModelV3({
    doGenerate: async (options: any) => {
      if (options.responseFormat?.type === "json") {
        return {
          content: [{ type: "text", text: JSON.stringify({ approved: true, reason: "ok" }) }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        } as any;
      }

      const content = steps[step] ?? [{ type: "text", text: "done" }];

      step += 1;

      return {
        content,
        finishReason: {
          unified: content.some((c: any) => c.type === "tool-call") ? "tool-calls" : "stop",
          raw: undefined,
        },
        usage,
        warnings: [],
      } as any;
    },
  });
}

const paragraphs = (doc: any): string[] =>
  doc.body.root.children.map((p: any) => p.children.map((c: any) => c.text).join(""));

describe("the editor runs the tool calls of one step one after another", () => {
  it("keeps both rich text edits the model sends in one step", async () => {
    const { io, store } = storeIo({ id: 1, title: "T", body: body("Alpha one.", "Beta two.") });
    const model = editorModel([
      [
        call("a", "applyRichText", {
          ref: "body",
          mode: "surgical",
          edits: [
            { key: "0", action: "replace", markdown: "Alpha new.", expectedText: "Alpha one." },
          ],
        }),
        call("b", "applyRichText", {
          ref: "body",
          mode: "surgical",
          edits: [{ key: "1", action: "insertAfter", markdown: "Inserted." }],
        }),
      ],
      [call("c", "finishEdit", { summary: "inserted one paragraph and replaced another" })],
    ]);
    const { editContent } = createContentEditorTools({ io, schema, model, concurrency: 1 });

    await editContent.execute!(
      { collection: "posts", id: "1", instruction: "insert and replace" },
      { toolCallId: "t", messages: [] } as any
    );

    expect(paragraphs(store.doc)).toEqual(["Alpha new.", "Beta two.", "Inserted."]);
  });
});
