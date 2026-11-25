import { describe, expect, it } from "vitest";
import { createTurnApprovals } from "../src/agent/approvals.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import type { DocumentIO } from "../src/agent/content/documentIo.js";
import { createCopyBlockTool } from "../src/agent/tools/blocks/copyBlock.js";
import { wrapMcpTools } from "../src/agent/tools/mcp/wrapTools.js";
import type { EditRecordRef, SchemaContext, SchemaField } from "../src/types.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text" },
        { name: "template", type: "select", options: ["a", "b"], readOnly: true },
        { name: "theme", type: "select", options: ["light", "dark"] },
        {
          name: "layout",
          type: "blocks",
          blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }],
        },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const opts = { toolCallId: "t", messages: [] } as any;

const text = (doc: any) => ({
  content: [{ type: "text", text: `Resource from collection "pages":\n${JSON.stringify(doc)}` }],
});

function setUp({ failWrite = false } = {}) {
  const docs: Record<string, any> = {
    "1": {
      id: 1,
      title: "Source",
      template: "a",
      theme: "dark",
      layout: [{ id: "b1", blockType: "hero", heading: "Hello" }],
    },
    "2": { id: 2, title: "Target", template: null, theme: null, layout: [] },
  };
  const updates: any[] = [];
  const mcp = {
    findPages: { execute: async ({ id }: any) => text(docs[String(id)]) },
    updatePages: {
      execute: async ({ id, draft: _draft, ...data }: any) => {
        if (failWrite) throw new Error("the database is down");
        updates.push(data);
        docs[String(id)] = { ...docs[String(id)], ...data };

        return text(docs[String(id)]);
      },
    },
  };
  const recorded: EditRecordRef[] = [];
  const documents: { io?: DocumentIO } = {};

  const recordEdits = (refs: EditRecordRef[]) => {
    recorded.push(...refs);
  };

  const approvals = createTurnApprovals();
  const wrapped = wrapMcpTools(mcp as any, {
    schema,
    documentIo: () => documents.io!,
    recordEdits,
    approvals,
  });

  documents.io = createDocumentIO({ mcpTools: wrapped.safeMcpTools, schema, approvals });
  const copyBlock = createCopyBlockTool(documents.io, schema, recordEdits);

  return { copyBlock, updates, recorded };
}

const copy = { toCollection: "pages", toId: 2, fromId: 1, blockId: "b1" };

describe("copyBlock through the write gate", () => {
  it("writes once, records the copy once, and does not inherit a read-only setting", async () => {
    const { copyBlock, updates, recorded } = setUp();
    const r: any = await copyBlock.execute!(copy, opts);

    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].template).toBeUndefined();
    expect(updates[0].theme).toBe("dark");
    expect(updates[0].layout).toHaveLength(1);
    expect(recorded).toHaveLength(1);
  });

  it("reports a failed save as an error and records nothing", async () => {
    const { copyBlock, recorded } = setUp({ failWrite: true });
    const r: any = await copyBlock.execute!(copy, opts);

    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/Copy failed/u);
    expect(recorded).toEqual([]);
  });
});
