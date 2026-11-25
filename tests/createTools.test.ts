import { describe, it, expect, vi } from "vitest";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { createTools } from "../src/agent/tools/index.js";
import { wrapMcpTools } from "../src/agent/tools/mcp/wrapTools.js";
import type { SchemaContext } from "../src/types.js";
import { pluginOptions } from "./harness.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [{ name: "title", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

describe("createTools: universal read tools (readDocument / listDocuments)", () => {
  it("exposes readDocument/listDocuments that work via the Local API fallback (no MCP tools)", async () => {
    const payload: any = {
      findByID: vi.fn(async ({ id }: any) => ({ id, title: "Hello" })),
      find: vi.fn(async () => ({ docs: [{ id: "1", title: "A" }], totalPages: 1 })),
    };
    const options = pluginOptions();
    const tools: Record<string, any> = createTools({}, schema, options, {
      payload,
      user: { id: 1 } as any,
    });

    const readRes: any = await tools.readDocument.execute(
      { collection: "posts", id: "1" },
      { toolCallId: "t", messages: [] }
    );

    expect(readRes.doc).toMatchObject({ id: "1", title: "Hello" });

    const listRes: any = await tools.listDocuments.execute(
      { collection: "posts" },
      { toolCallId: "t", messages: [] }
    );

    expect(listRes.docs).toHaveLength(1);
  });

  it("readDocument reports a clear error with no MCP tools and no payload/user", async () => {
    const options = pluginOptions();
    const tools: Record<string, any> = createTools({}, schema, options);
    const res: any = await tools.readDocument.execute(
      { collection: "posts", id: "1" },
      { toolCallId: "t", messages: [] }
    );

    expect(res.error).toMatch(/no Local API fallback/u);
  });

  it("readDocument/listDocuments cap their STORED output for a document with large text fields, not just what toModelOutput shows", async () => {
    const bigDoc = { id: "1", title: "x".repeat(60_000) };
    const payload: any = {
      findByID: vi.fn(async () => bigDoc),
      find: vi.fn(async () => ({ docs: [bigDoc], totalPages: 1, totalDocs: 1 })),
    };
    const options = pluginOptions();
    const tools: Record<string, any> = createTools({}, schema, options, {
      payload,
      user: { id: 1 } as any,
    });
    const opts = { toolCallId: "t", messages: [] } as any;

    const readRes: any = await tools.readDocument.execute({ collection: "posts", id: "1" }, opts);

    expect(JSON.stringify(readRes).length).toBeLessThan(60_000);

    const listRes: any = await tools.listDocuments.execute({ collection: "posts" }, opts);

    expect(JSON.stringify(listRes).length).toBeLessThan(60_000);
  });
});

const payloadWithCreate = () => ({
  findByID: vi.fn(async ({ id }: any) => ({ id, title: "x" })),
  create: vi.fn(async ({ data }: any) => ({ id: "new-1", ...data })),
});

describe("createTools: universal createDocument tool", () => {
  it("creates a draft via the Local API fallback and returns the id", async () => {
    const payload: any = payloadWithCreate();
    const tools: Record<string, any> = createTools({}, schema, pluginOptions(), {
      payload,
      user: { id: 1 } as any,
    });
    const res: any = await tools.createDocument.execute(
      { collection: "posts", data: { title: "Shell" } },
      { toolCallId: "t", messages: [] }
    );

    expect(res.error).toBeUndefined();
    expect(res.id).toBe("new-1");
    expect(payload.create).toHaveBeenCalled();
  });

  it("refuses blocks arrays in data (compose via editContent instead)", async () => {
    const payload: any = payloadWithCreate();
    const tools: Record<string, any> = createTools({}, schema, pluginOptions(), {
      payload,
      user: { id: 1 } as any,
    });
    const res: any = await tools.createDocument.execute(
      { collection: "posts", data: { title: "X", layout: [{ blockType: "hero" }] } },
      { toolCallId: "t", messages: [] }
    );

    expect(res.error).toMatch(/blocks/u);
    expect(payload.create).not.toHaveBeenCalled();
  });

  const withBody: any = {
    globals: [],
    collections: [
      {
        slug: "notes",
        fields: [
          { name: "heading", type: "text", required: true },
          { name: "owner", type: "relationship", required: true },
          { name: "body", type: "richText", editor: "lexical", required: true },
          { name: "aside", type: "richText", editor: "lexical" },
        ],
        hasVersions: true,
        hasDrafts: true,
        hasAuth: false,
        timestamps: true,
      },
    ],
  };

  it("creates a required rich text field empty when data has no value for it, and says so", async () => {
    const payload: any = payloadWithCreate();
    const tools: Record<string, any> = createTools({}, withBody, pluginOptions(), {
      payload,
      user: { id: 1 } as any,
    });
    const res: any = await tools.createDocument.execute(
      { collection: "notes", data: { heading: "Shell", owner: 3 } },
      { toolCallId: "t", messages: [] }
    );
    const sent = payload.create.mock.calls[0][0].data;

    expect(res.error).toBeUndefined();
    expect(sent.body.root.children).toHaveLength(1);
    expect(sent.aside).toBeUndefined();
    expect(res.createdEmpty).toEqual(["body"]);
    expect(res.note).toContain("editContent");
  });

  it("keeps the rich text value that data sends", async () => {
    const payload: any = payloadWithCreate();
    const tools: Record<string, any> = createTools({}, withBody, pluginOptions(), {
      payload,
      user: { id: 1 } as any,
    });
    const body = { root: { type: "root", children: [{ type: "paragraph", children: [] }] } };
    const res: any = await tools.createDocument.execute(
      { collection: "notes", data: { heading: "Shell", owner: 3, body } },
      { toolCallId: "t", messages: [] }
    );

    expect(res.createdEmpty).toBeUndefined();
    expect(payload.create.mock.calls[0][0].data.body.root.children[0].type).toBe("paragraph");
  });

  it("names the required fields that were not sent when the create fails", async () => {
    const payload: any = {
      ...payloadWithCreate(),
      create: vi.fn(async () => {
        throw new Error("Required at owner");
      }),
    };
    const tools: Record<string, any> = createTools({}, withBody, pluginOptions(), {
      payload,
      user: { id: 1 } as any,
    });
    const res: any = await tools.createDocument.execute(
      { collection: "notes", data: { heading: "Shell" } },
      { toolCallId: "t", messages: [] }
    );

    expect(res.error).toContain("Required at owner");
    expect(res.error).toContain('Required and not sent: "owner"');
    expect(res.error).not.toContain('"body"');
    expect(res.error).toContain("Call createDocument again");
  });

  it("refuses unknown collections with the available list", async () => {
    const tools: Record<string, any> = createTools({}, schema, pluginOptions(), {
      payload: payloadWithCreate() as any,
      user: { id: 1 } as any,
    });
    const res: any = await tools.createDocument.execute(
      { collection: "nope", data: { title: "X" } },
      { toolCallId: "t", messages: [] }
    );

    expect(res.error).toMatch(/Unknown collection/u);
  });
});

const mcpTool = (properties?: Record<string, any>) => ({
  description: "desc",
  ...(properties && { inputSchema: { jsonSchema: { type: "object", properties } } }),
  execute: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
});

describe("createTools - draft defaulting by tool schema", () => {
  const ctx = { toolCallId: "t", messages: [] };
  const draftSchema: SchemaContext = {
    collections: schema.collections,
    globals: [
      {
        slug: "site-settings",
        fields: [{ name: "siteName", type: "text" }],
        hasVersions: true,
        hasDrafts: true,
      },
    ],
  };

  it("defaults draft:true on a custom tool that declares `draft`, and keeps an explicit draft:false", async () => {
    const getDocument = mcpTool({ collectionSlug: {}, id: {}, draft: {} });
    const tools: Record<string, any> = createTools({ getDocument }, draftSchema, pluginOptions());

    await tools.getDocument.execute({ collectionSlug: "posts", id: "1" }, ctx);
    expect(getDocument.execute).toHaveBeenLastCalledWith(
      { draft: true, collectionSlug: "posts", id: "1" },
      ctx
    );
    await tools.getDocument.execute({ collectionSlug: "posts", id: "1", draft: false }, ctx);
    expect(getDocument.execute).toHaveBeenLastCalledWith(
      { draft: false, collectionSlug: "posts", id: "1" },
      ctx
    );
    expect(tools.getDocument.description).toBe("desc");
  });

  it("flags a document reader without `draft` as published-only and passes its params untouched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getGlobalDocument = mcpTool({ globalSlug: {} });
    const tools: Record<string, any> = createTools(
      { getGlobalDocument },
      draftSchema,
      pluginOptions()
    );

    expect(tools.getGlobalDocument.description).toContain("PUBLISHED version only");
    await tools.getGlobalDocument.execute({ globalSlug: "site-settings" }, ctx);
    expect(getGlobalDocument.execute).toHaveBeenLastCalledWith(
      { globalSlug: "site-settings" },
      ctx
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("getGlobalDocument"));
    warn.mockRestore();
  });

  it("flags plugin-mcp find{Global} on a drafts global (it takes no `draft`), not find{Collection} that does", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mcpTools = {
      findSiteSettings: mcpTool({ depth: {}, locale: {} }),
      findPosts: mcpTool({ id: {}, draft: {}, where: {} }),
    };
    const wrapped = wrapMcpTools(mcpTools, {
      schema: draftSchema,
      documentIo: () => createDocumentIO({ mcpTools, schema: draftSchema }),
      recordEdits: vi.fn(),
    });
    const tools: Record<string, any> = wrapped.safeMcpTools;

    expect(tools.findSiteSettings.description).toContain("PUBLISHED version only");
    expect(tools.findPosts.description).toBe("desc");
    expect(wrapped.publishedOnlyReaders).toEqual(["findSiteSettings"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("findSiteSettings"));
    warn.mockRestore();
  });

  it("does not flag non-document readers, tools with no schema, or any tool when nothing has drafts", () => {
    const noDrafts: SchemaContext = {
      globals: [],
      collections: [{ ...schema.collections[0], hasDrafts: false }],
    };
    const tools: Record<string, any> = createTools(
      { findConfig: mcpTool({ includeMetadata: {} }), getField: mcpTool() },
      draftSchema,
      pluginOptions()
    );

    expect(tools.findConfig.description).toBe("desc");
    expect(tools.getField.description).toBe("desc");
    const plain: Record<string, any> = createTools(
      { getDocument: mcpTool({ collectionSlug: {}, id: {} }) },
      noDrafts,
      pluginOptions()
    );

    expect(plain.getDocument.description).toBe("desc");
  });
});
