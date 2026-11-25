import { describe, expect, it, vi } from "vitest";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { approvalReason, parseApprovalRequest } from "../src/approvalRequest.js";
import { askPerson, createTurnApprovals, decideApproval } from "../src/agent/approvals.js";
import {
  liveTargetOf,
  noDraftsCreateRefusal,
  noDraftsRefusal,
  withoutDraftsNotice,
} from "../src/agent/content/draftsOnly.js";
import { CHAT_SURFACE } from "../src/agent/toolSurface.js";
import { createFindReplaceTool } from "../src/agent/content/findReplace.js";
import { wrapMcpTools } from "../src/agent/tools/mcp/wrapTools.js";
import { schemaContextToString } from "../src/schema/renderSchema.js";
import { editorSchemaText } from "../src/agent/content/editor/schemaText.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  collections: [
    {
      slug: "posts",
      fields: [{ name: "title", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "categories",
      fields: [{ name: "name", type: "text" }],
      hasVersions: false,
      hasDrafts: false,
      hasAuth: false,
      timestamps: true,
    },
  ],
  globals: [
    {
      slug: "site-settings",
      fields: [{ name: "siteName", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
    },
    {
      slug: "footer",
      fields: [{ name: "note", type: "text" }],
      hasVersions: false,
      hasDrafts: false,
    },
  ],
};

const user: any = { id: 7 };

function makePayload(): any {
  return {
    create: vi.fn(async ({ data }: any) => ({ id: "1", ...data })),
    update: vi.fn(async ({ id, data }: any) => ({ id, ...data })),
    updateGlobal: vi.fn(async ({ data }: any) => ({ ...data })),
  };
}

describe("noDraftsRefusal", () => {
  it("passes a target with drafts and an unknown target", () => {
    expect(noDraftsRefusal(schema, { collection: "posts" })).toBeNull();
    expect(noDraftsRefusal(schema, { global: "site-settings" })).toBeNull();
    expect(noDraftsRefusal(schema, { collection: "nope" })).toBeNull();
  });

  it("refuses a target without drafts until the person confirms, and names the next call", () => {
    const collection = noDraftsRefusal(schema, { collection: "categories" });
    const global = noDraftsRefusal(schema, { global: "footer" });

    expect(collection).toMatch(/Collection "categories" has no drafts/u);
    expect(global).toMatch(/Global "footer" has no drafts/u);

    for (const refusal of [collection, global]) {
      expect(refusal).toMatch(/^Nothing was written/u);
      expect(refusal).toMatch(/after the person confirms it in the chat/u);
      expect(refusal).toMatch(
        /updateDocument, editContent, findReplaceContent or translateContent/u
      );
    }
  });

  it("refuses a new document with no way through a confirmation", () => {
    const refusal = noDraftsCreateRefusal(schema, { collection: "categories" });

    expect(refusal).toMatch(/^Nothing was created: Collection "categories" has no drafts/u);
    expect(refusal).toMatch(/by hand in the admin panel/u);
    expect(refusal).toMatch(/versions\.drafts/u);
    expect(noDraftsCreateRefusal(schema, { collection: "posts" })).toBeNull();
  });

  it("passes the confirmed tool call, and then only the documents that it named", () => {
    const approvals = createTurnApprovals();
    const categories = { collection: "categories" };
    const refusal = (consent: object) => noDraftsRefusal(schema, categories, CHAT_SURFACE, consent);

    approvals.asked.add("call-1");
    expect(refusal({ approvals, toolCallId: "call-2", ids: [1] })).toMatch(/has no drafts/u);
    expect(refusal({ approvals, toolCallId: "call-1", ids: [1, "2"] })).toBeNull();
    expect(refusal({ approvals, ids: ["1"] })).toBeNull();
    expect(refusal({ approvals, ids: [2] })).toBeNull();
    expect(refusal({ approvals, ids: [3] })).toMatch(/has no drafts/u);
    expect(refusal({ approvals, ids: [1, 3] })).toMatch(/has no drafts/u);
    expect(refusal({ approvals })).toMatch(/has no drafts/u);
    expect(noDraftsRefusal(schema, { global: "footer" }, CHAT_SURFACE, { approvals })).toMatch(
      /has no drafts/u
    );
  });

  it("opens a global for the confirmed call and the saves after it", () => {
    const approvals = createTurnApprovals();
    const footer = { global: "footer" };

    approvals.asked.add("call-1");
    expect(
      noDraftsRefusal(schema, footer, CHAT_SURFACE, { approvals, toolCallId: "call-1" })
    ).toBeNull();
    expect(noDraftsRefusal(schema, footer, CHAT_SURFACE, { approvals })).toBeNull();
  });
});

const ask = (toolName: string, input: unknown, approvals = createTurnApprovals()) => {
  approvals.liveTarget = liveTargetOf(schema);

  return decideApproval(approvals, { toolName, toolCallId: "call-1", input });
};

describe("the question about a live write", () => {
  it("asks before every write tool call on a target without drafts", async () => {
    const one = await ask("updateDocument", { collection: "categories", id: 4, data: {} });
    const global = await ask("editContent", { global: "footer", instruction: "x" });

    expect(parseApprovalRequest(one?.reason)).toEqual({
      kind: "live-write",
      collection: "categories",
      document: { id: 4 },
    });
    expect(parseApprovalRequest(global?.reason)).toEqual({ kind: "live-write", global: "footer" });
  });

  it("asks nothing for a target with drafts, a preview, a read or a create", async () => {
    expect(await ask("updateDocument", { collection: "posts", id: 4, data: {} })).toBeUndefined();
    expect(
      await ask("updateDocument", { collection: "categories", id: 4, data: {}, preview: true })
    ).toBeUndefined();
    expect(await ask("readDocument", { collection: "categories", id: 4 })).toBeUndefined();
    expect(await ask("createDocument", { collection: "categories", data: {} })).toBeUndefined();
  });

  it("adds the notice to the question that the tool itself asks", async () => {
    const approvals = createTurnApprovals();
    const request = {
      kind: "replace" as const,
      collection: "categories",
      count: 9,
      documents: [],
      find: "a",
      replace: "b",
    };

    approvals.policies.set("findReplaceContent", () => askPerson(approvalReason(request)));
    const decision = await ask("findReplaceContent", { collection: "categories" }, approvals);

    expect(parseApprovalRequest(decision?.reason)).toEqual({ ...request, live: true });
    expect(approvals.asked.has("call-1")).toBe(true);
  });
});

describe("DocumentIO without drafts", () => {
  it("writes the live document after the person confirmed, and still creates nothing", async () => {
    const payload = makePayload();
    const approvals = createTurnApprovals();
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user, approvals });

    approvals.live.add("collection:categories:1");
    const written = await io.write({ collection: "categories" }, { id: 1, patch: { name: "x" } });
    const created = await io.create({ collection: "categories" }, { data: { name: "x" } });
    const global = await io.write({ global: "footer" }, { patch: { note: "x" } });

    expect(written.error).toBeUndefined();
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ draft: false, data: { name: "x" } })
    );
    const other = await io.write({ collection: "categories" }, { id: 2, patch: { name: "x" } });

    expect(other.error).toMatch(/has no drafts/u);
    expect(payload.update).toHaveBeenCalledTimes(1);
    expect(created.error).toMatch(/^Nothing was created/u);
    expect(payload.create).not.toHaveBeenCalled();
    expect(global.error).toMatch(/has no drafts/u);
    expect(payload.updateGlobal).not.toHaveBeenCalled();
  });

  it("sends no draft state to the MCP tool of a target without drafts", async () => {
    const update = vi.fn(async () => ({
      content: [{ text: `Resource from collection "categories":\n${JSON.stringify({ id: 1 })}` }],
    }));
    const approvals = createTurnApprovals();
    const io = createDocumentIO({
      mcpTools: { updateCategories: { execute: update } } as any,
      schema,
      approvals,
    });

    approvals.live.add("collection:categories:1");
    await io.write({ collection: "categories" }, { id: 1, patch: { name: "x" } });
    expect(update).toHaveBeenCalledWith({ id: "1", name: "x" }, expect.anything());
  });

  it("writes nothing through the Local API", async () => {
    const payload = makePayload();
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });
    const written = await io.write({ collection: "categories" }, { id: 1, patch: { name: "x" } });
    const created = await io.create({ collection: "categories" }, { data: { name: "x" } });
    const global = await io.write({ global: "footer" }, { patch: { note: "x" } });

    for (const result of [written, created, global]) expect(result.error).toMatch(/has no drafts/u);
    expect(payload.update).not.toHaveBeenCalled();
    expect(payload.create).not.toHaveBeenCalled();
    expect(payload.updateGlobal).not.toHaveBeenCalled();
  });

  it("writes nothing through the MCP tools", async () => {
    const update = vi.fn();
    const create = vi.fn();
    const io = createDocumentIO({
      mcpTools: { updateCategories: { execute: update }, createCategories: { execute: create } },
      schema,
    });
    const written = await io.write({ collection: "categories" }, { id: 1, patch: { name: "x" } });
    const created = await io.create({ collection: "categories" }, { data: { name: "x" } });

    expect(written.error).toMatch(/has no drafts/u);
    expect(created.error).toMatch(/has no drafts/u);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("still writes a draft where drafts are on", async () => {
    const payload = makePayload();
    const io = createDocumentIO({ mcpTools: {}, schema, payload, user });

    await io.write({ global: "site-settings" }, { patch: { siteName: "x" } });
    expect(payload.updateGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ draft: true, data: { siteName: "x", _status: "draft" } })
    );
  });
});

function wrap() {
  const executes = {
    updateCategories: vi.fn(),
    createCategories: vi.fn(),
    updatePosts: vi.fn(async () => ({
      content: [{ text: `Resource from collection "posts":\n${JSON.stringify({ id: 1 })}` }],
    })),
  };
  const mcpTools: any = Object.fromEntries(
    Object.entries(executes).map(([name, execute]) => [name, { execute }])
  );
  const { safeMcpTools } = wrapMcpTools(mcpTools, {
    schema,
    documentIo: () => createDocumentIO({ mcpTools, schema }),
    recordEdits: vi.fn(),
  });

  return { executes, safeMcpTools: safeMcpTools as any };
}

describe("MCP write tools without drafts", () => {
  const options: any = { toolCallId: "call-1", messages: [] };

  it("refuses an update and a create before the tool runs", async () => {
    const { executes, safeMcpTools } = wrap();
    const updated = await safeMcpTools.updateCategories.execute({ id: 1, name: "x" }, options);
    const created = await safeMcpTools.createCategories.execute({ name: "x" }, options);

    expect(updated.error).toMatch(/Collection "categories" has no drafts/u);
    expect(created.error).toMatch(/Collection "categories" has no drafts/u);
    expect(executes.updateCategories).not.toHaveBeenCalled();
    expect(executes.createCategories).not.toHaveBeenCalled();
  });

  it("refuses the editor's own save too", async () => {
    const { executes, safeMcpTools } = wrap();
    const saved = await safeMcpTools.updateCategories.execute(
      { id: 1, name: "x" },
      { ...options, toolCallId: "ws-save" }
    );

    expect(saved.error).toMatch(/has no drafts/u);
    expect(executes.updateCategories).not.toHaveBeenCalled();
  });

  it("runs the update that the person confirmed, with no draft state, and no create", async () => {
    const executes = {
      updateCategories: vi.fn(async () => ({
        content: [{ text: `Resource from collection "categories":\n${JSON.stringify({ id: 1 })}` }],
      })),
      createCategories: vi.fn(),
    };
    const mcpTools: any = Object.fromEntries(
      Object.entries(executes).map(([name, execute]) => [name, { execute }])
    );
    const approvals = createTurnApprovals();
    const { safeMcpTools } = wrapMcpTools(mcpTools, {
      schema,
      documentIo: () => createDocumentIO({ mcpTools, schema, approvals }),
      recordEdits: vi.fn(),
      approvals,
    }) as any;

    approvals.asked.add("call-1");
    const updated = await safeMcpTools.updateCategories.execute({ id: 1, name: "x" }, options);
    const created = await safeMcpTools.createCategories.execute({ name: "x" }, options);

    expect(updated.error).toBeUndefined();
    expect(executes.updateCategories).toHaveBeenCalledWith(
      expect.not.objectContaining({ draft: true }),
      expect.anything()
    );
    expect(executes.updateCategories).toHaveBeenCalledWith(
      expect.not.objectContaining({ _status: "draft" }),
      expect.anything()
    );
    expect(created.error).toMatch(/^Nothing was created/u);
    expect(executes.createCategories).not.toHaveBeenCalled();
  });

  it("forces a draft where drafts are on", async () => {
    const { executes, safeMcpTools } = wrap();

    await safeMcpTools.updatePosts.execute({ id: 1, title: "x" }, options);
    expect(executes.updatePosts).toHaveBeenCalledWith(
      expect.objectContaining({ draft: true, _status: "draft" }),
      expect.anything()
    );
  });
});

describe("bulk tools without drafts", () => {
  it("findReplaceContent refuses before it asks for a confirmation", async () => {
    const io = createDocumentIO({ mcpTools: {}, schema, payload: makePayload(), user });
    const tools = createFindReplaceTool(io, schema);
    const result: any = await tools.findReplaceContent.execute!(
      { collection: "categories", find: "a", replace: "b", ids: [1, 2, 3, 4, 5, 6, 7] },
      { toolCallId: "call-1", messages: [] } as any
    );

    expect(result.error).toMatch(/Collection "categories" has no drafts/u);
  });
});

const section = (text: string, slug: string) =>
  text.split("### ").find((part) => part.includes(`(slug: "${slug}")`)) ?? "";

describe("what the host and the model are told", () => {
  it("tells createDocument only the collections that take a new document", async () => {
    const { createCreateDocumentTool, creatableCollections } =
      await import("../src/agent/tools/documents/createDocument.js");
    const io = createDocumentIO({ mcpTools: {}, schema, payload: makePayload(), user });
    const tool = createCreateDocumentTool(io, schema);

    expect(creatableCollections(io, schema)).toEqual(["posts"]);
    expect(tool.description).toContain("in one of these collections: posts.");
    expect(tool.description).not.toContain("categories");
    expect(creatableCollections(createDocumentIO({ mcpTools: {}, schema }), schema)).toEqual([]);
  });

  it("lists the read-only targets once, for the server log", () => {
    const notice = withoutDraftsNotice(schema);

    expect(notice).toMatch(/collections categories; globals footer/u);
    expect(notice).toMatch(/versions\.drafts/u);
    expect(
      withoutDraftsNotice({ collections: [schema.collections[0]!], globals: [schema.globals[0]!] })
    ).toBeNull();
  });

  it("tells the editor that a write without drafts is already confirmed", () => {
    const collection = editorSchemaText(schema, { collection: "categories" });
    const global = editorSchemaText(schema, { global: "footer" });

    for (const text of [collection, global]) {
      expect(text).toContain("This write was confirmed before the session started");
      expect(text).not.toContain("the chat asks the person to confirm it");
    }

    expect(editorSchemaText(schema, { collection: "posts" })).not.toContain("Agent access");
  });

  it("marks the targets without drafts in the schema text", () => {
    const chat = schemaContextToString(schema);
    const outside = schemaContextToString(schema, { noDraftsNote: "Agent access: read only" });

    for (const slug of ["categories", "footer"]) {
      expect(section(chat, slug)).toContain("Agent access: no drafts.");
      expect(section(chat, slug)).toContain("the chat asks the person to confirm it");
      expect(section(outside, slug)).toContain("Agent access: read only");
      expect(section(outside, slug)).not.toContain("the chat asks");
    }

    expect(section(chat, "posts")).not.toContain("Agent access");
    expect(section(chat, "site-settings")).not.toContain("Agent access");
  });
});
