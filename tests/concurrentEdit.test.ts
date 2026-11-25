import { describe, expect, it } from "vitest";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { createWorkspaceTools } from "../src/agent/content/workspaceTools.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "subtitle", type: "text" },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const opts = { toolCallId: "t", messages: [] } as any;

const stored = () => ({
  id: 1,
  title: "A",
  subtitle: "B",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
});

function fakeCms(findFails = false) {
  const state: { doc: any; updateArgs: any; reads: number } = {
    doc: stored(),
    updateArgs: null,
    reads: 0,
  };
  const tools = {
    findPosts: {
      execute: async () => {
        state.reads += 1;
        if (findFails && state.reads > 1) throw new Error("connection reset");

        return {
          content: [
            {
              type: "text",
              text: `Resource from collection "posts":\n${JSON.stringify(state.doc)}`,
            },
          ],
        };
      },
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

async function openAndEditTitle(cms: ReturnType<typeof fakeCms>) {
  const workspace: any = { ref: { current: null }, collection: null };
  const tools = createWorkspaceTools(
    workspace,
    createDocumentIO({ mcpTools: cms.tools as any, schema }),
    schema
  );

  await tools.openDocument.execute!({ collection: "posts", id: "1" }, opts);
  workspace.ref.current.title = "A2";

  return tools;
}

describe("a save does not overwrite a change made after the editor opened the document", () => {
  it("refuses when a field of the patch changed meanwhile, and names it", async () => {
    const cms = fakeCms();
    const tools = await openAndEditTitle(cms);

    cms.state.doc = { ...stored(), title: "A by a person", updatedAt: "2026-01-03" };
    const result: any = await tools.saveDocument.execute!({}, opts);

    expect(result.error).toContain('"title"');
    expect(result.error).toContain("nothing was written");
    expect(result.error).toContain("make the same edit again");
    expect(cms.state.updateArgs).toBeNull();
  });

  it("keeps the fact and the way out in the first sentence, which is all the session reports", async () => {
    const cms = fakeCms();
    const tools = await openAndEditTitle(cms);

    cms.state.doc = { ...stored(), title: "A by a person", updatedAt: "2026-01-03" };
    const result: any = await tools.saveDocument.execute!({}, opts);

    expect(String(result.error).split(". ")[0]).toBe(result.error);
  });

  it("saves when only another field changed meanwhile, and leaves that field alone", async () => {
    const cms = fakeCms();
    const tools = await openAndEditTitle(cms);

    cms.state.doc = { ...stored(), subtitle: "B by a person", updatedAt: "2026-01-03" };
    const result: any = await tools.saveDocument.execute!({}, opts);

    expect(result.ok).toBe(true);
    expect(cms.state.updateArgs.title).toBe("A2");
    expect("subtitle" in cms.state.updateArgs).toBe(false);
  });

  it("saves when only `updatedAt` moved (a hook or a bookkeeping field)", async () => {
    const cms = fakeCms();
    const tools = await openAndEditTitle(cms);

    cms.state.doc = { ...stored(), updatedAt: "2026-01-03" };
    const result: any = await tools.saveDocument.execute!({}, opts);

    expect(result.ok).toBe(true);
    expect(cms.state.updateArgs.title).toBe("A2");
  });

  it("compares the fields also when the collection has no `updatedAt`", async () => {
    const cms = fakeCms();
    const { updatedAt: _updatedAt, ...withoutTimestamp } = stored();

    cms.state.doc = withoutTimestamp;
    const tools = await openAndEditTitle(cms);

    cms.state.doc = { ...withoutTimestamp, title: "A by a person" };
    const result: any = await tools.saveDocument.execute!({}, opts);

    expect(result.error).toContain('"title"');
    expect(cms.state.updateArgs).toBeNull();
  });

  it("refuses when the document cannot be read again before the save", async () => {
    const cms = fakeCms(true);
    const tools = await openAndEditTitle(cms);
    const result: any = await tools.saveDocument.execute!({}, opts);

    expect(result.error).toContain("could not read");
    expect(result.error).toContain("connection reset");
    expect(cms.state.updateArgs).toBeNull();
  });
});
