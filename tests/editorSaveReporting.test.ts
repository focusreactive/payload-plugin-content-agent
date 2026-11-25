import { describe, it, expect } from "vitest";

import { createWorkspaceTools } from "../src/agent/content/workspaceTools.js";
import { createRichTextTools } from "../src/agent/content/richtextTools.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const opts = { toolCallId: "t", messages: [] } as any;

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "subtitle", type: "text" },
        { name: "strapline", type: "text" },
        { name: "body", type: "richText", editor: "lexical" },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const paragraph = (text: string) => ({
  type: "paragraph",
  version: 1,
  children: [{ type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" }],
});

const makeDoc = () => ({
  id: 1,
  title: "Title",
  subtitle: "Subtitle",
  strapline: "Strapline",
  body: {
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [paragraph("First"), paragraph("Second")],
    },
  },
});

function fakeMcp(doc: any) {
  const state: { updateArgs: any } = { updateArgs: null };
  const tools = {
    findPosts: {
      execute: async () => ({
        content: [
          { type: "text", text: `Resource from collection "posts":\n${JSON.stringify(doc)}` },
        ],
      }),
    },
    updatePosts: {
      execute: async (params: any) => {
        state.updateArgs = params;

        return { content: [{ type: "text", text: "Document updated successfully" }] };
      },
    },
  };

  return { tools, state };
}

const openWorkspace = async () => {
  const { tools: mcp, state } = fakeMcp(makeDoc());
  const workspace: any = { ref: { current: null }, collection: null };
  const ws = createWorkspaceTools(workspace, createDocumentIO({ mcpTools: mcp, schema }), schema);

  await ws.openDocument.execute!({ collection: "posts", id: "1" }, opts);

  return { workspace, ws, state };
};

describe("a save that persists nothing is a failure, not a success", () => {
  it("answers with an error and never reaches the CMS when the document is unchanged", async () => {
    const { ws, state } = await openWorkspace();
    const r: any = await ws.saveDocument.execute!({}, opts);

    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/Nothing was written/u);
    expect(r.error).toMatch(/Do NOT report this as done/u);
    expect(r.changed).toEqual([]);
    expect(state.updateArgs).toBeNull();
  });

  it("reports an edit that matched nothing as unchanged rather than done", async () => {
    const { workspace, ws } = await openWorkspace();

    workspace.ref.current.title = "Title";
    const r: any = await ws.saveDocument.execute!({}, opts);

    expect(r.error).toMatch(/byte-identical/u);
  });

  it("still saves normally when something did change", async () => {
    const { workspace, ws, state } = await openWorkspace();

    workspace.ref.current.title = "A new title";
    const r: any = await ws.saveDocument.execute!({}, opts);

    expect(r.ok).toBe(true);
    expect(r.changed).toContain("title");
    expect(state.updateArgs.title).toBe("A new title");
  });
});

describe("a surgical rich text edit returns the field it just changed", () => {
  it("includes a fresh view, identical to what a re-read would have produced", async () => {
    const { workspace } = await openWorkspace();
    const rt: any = createRichTextTools(workspace, schema);

    const applied: any = await rt.applyRichText.execute(
      {
        ref: "body",
        mode: "surgical",
        edits: [{ key: "0", action: "replace", markdown: "Rewritten", expectedText: "First" }],
      },
      opts
    );

    expect(applied.ok).toBe(true);
    expect(applied.view).toBeTruthy();
    expect(JSON.stringify(applied.view)).toContain("Rewritten");

    const reRead: any = await rt.viewRichText.execute({ ref: "body", mode: "surgical" }, opts);

    expect(JSON.stringify(applied.view)).toBe(JSON.stringify(reRead.content));
  });
});

describe("a failed richText ref names the refs that ARE richText", () => {
  it("lists the real richText fields instead of only refusing", async () => {
    const { workspace } = await openWorkspace();
    const rt: any = createRichTextTools(workspace, schema);
    const r: any = await rt.viewRichText.execute({ ref: "nope", mode: "surgical" }, opts);

    expect(r.error).toMatch(/is not a richText field/u);
    expect(r.error).toMatch(/richText in this document: body/u);
    expect(r.error).toMatch(/getEditableContent/u);
  });

  it("answers a plain-text ref with its value instead of a hint - that path already worked", async () => {
    const { workspace } = await openWorkspace();
    const rt: any = createRichTextTools(workspace, schema);
    const r: any = await rt.viewRichText.execute({ ref: "title", mode: "surgical" }, opts);

    expect(r.value).toBe("Title");
    expect(r.note).toMatch(/setValues/u);
  });
});
