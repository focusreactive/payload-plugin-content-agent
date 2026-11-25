import { describe, expect, it, vi } from "vitest";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  collections: [
    {
      slug: "articles",
      fields: [{ name: "title", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
  globals: [],
};

const published = { id: 5, title: "Old published title" };
const draft = { id: 5, title: "New draft title" };

/** A site's own find tool that declares no `draft`: it always answers with the published version. */
const mcpTools = {
  findArticles: {
    inputSchema: {
      jsonSchema: { type: "object", properties: { id: {}, where: {}, limit: {}, locale: {} } },
    },
    execute: vi.fn(async () => ({ content: [{ text: JSON.stringify(published) }] })),
  },
};

describe("a draft read through a find tool of the site that takes no draft", () => {
  it("reads the draft through the Local API when the plugin has it", async () => {
    const findByID = vi.fn(async () => draft);
    const io = createDocumentIO({
      mcpTools,
      schema,
      payload: { findByID } as any,
      user: { id: 1 } as any,
    });
    const { doc } = await io.read({ collection: "articles" }, { id: 5 });

    expect(doc?.title).toBe("New draft title");
    expect(findByID).toHaveBeenCalledWith(expect.objectContaining({ draft: true }));
  });

  it("is refused with mcpOnly, and never returns the published version as the draft", async () => {
    const io = createDocumentIO({ mcpTools, schema });
    const { doc, error } = await io.read({ collection: "articles" }, { id: 5 });

    expect(doc).toBeUndefined();
    expect(error).toMatch(/takes no `draft`/u);
  });

  it("still reads the published version through the tool when that is asked for", async () => {
    const io = createDocumentIO({ mcpTools, schema });
    const { doc } = await io.read({ collection: "articles" }, { id: 5, draft: false });

    expect(doc?.title).toBe("Old published title");
  });
});

const updateArticles = (execute: any) => ({
  updateArticles: {
    inputSchema: { jsonSchema: { type: "object", properties: { id: {}, title: {}, locale: {} } } },
    execute,
  },
});

describe("a draft write through an update tool of the site that takes no draft", () => {
  it("saves the draft through the Local API when the plugin has it", async () => {
    const execute = vi.fn();
    const update = vi.fn(async ({ id, data }: any) => ({ id, ...data }));
    const io = createDocumentIO({
      mcpTools: { ...mcpTools, ...updateArticles(execute) },
      schema,
      payload: { update, findByID: vi.fn(async () => draft) } as any,
      user: { id: 1 } as any,
    });
    const { error } = await io.write({ collection: "articles" }, { id: 5, patch: { title: "B" } });

    expect(error).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ draft: true }));
  });

  it("is refused with mcpOnly, and never writes the live document", async () => {
    const execute = vi.fn();
    const io = createDocumentIO({ mcpTools: { ...mcpTools, ...updateArticles(execute) }, schema });
    const { error } = await io.write({ collection: "articles" }, { id: 5, patch: { title: "B" } });

    expect(error).toMatch(/takes no `draft`/u);
    expect(execute).not.toHaveBeenCalled();
  });
});
