import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { withContentAgent } from "../src/mcpLayer/index.js";
import { conversationIdOf } from "../src/mcpLayer/history.js";
import { chatToolNames } from "./chatToolNames.js";

const drafts = { versions: { drafts: true } };

const collections = [
  {
    slug: "posts",
    timestamps: true,
    ...drafts,
    fields: [
      { name: "title", type: "text", required: true },
      { name: "body", type: "textarea" },
      { name: "tags", type: "array", fields: [{ name: "label", type: "text" }] },
      { name: "content", type: "richText" },
      { name: "related", type: "relationship", relationTo: "notes", hasMany: true },
    ],
  },
  { slug: "notes", timestamps: true, ...drafts, fields: [{ name: "text", type: "text" }] },
  { slug: "orders", timestamps: true, fields: [{ name: "total", type: "number" }] },
];
const globals = [
  { slug: "site-settings", ...drafts, fields: [{ name: "siteName", type: "text" }] },
];

const hostOptions = () => ({
  collections: {
    posts: { enabled: true },
    notes: { enabled: true },
    orders: { enabled: true },
  },
  globals: { "site-settings": { enabled: true } },
});

const all = { find: true, create: true, update: true };
const fullKey = { posts: all, notes: all, orders: all, siteSettings: all };

const keySettings = (flags: Record<string, unknown> = fullKey) => ({
  id: 3,
  label: "Outside agent",
  user: { id: 7 },
  ...flags,
});

const stored = () => ({
  id: 1,
  title: "First",
  body: "A text about cats and cats",
  tags: [{ id: "a", label: "one" }],
  related: [2, 3],
  _status: "draft",
});

function memoryMock() {
  const titles = new Map<string, string | null>();

  return {
    db: {},
    titles,
    conversations: {
      findOrCreate: vi.fn(async (id: string, userId: string) => {
        if (!titles.has(id)) titles.set(id, null);

        return { id, userId, title: titles.get(id) };
      }),
      updateTitle: vi.fn(async (id: string, title: string) => {
        titles.set(id, title);
      }),
      touch: vi.fn(async () => undefined),
    },
    changesets: { record: vi.fn(async () => undefined) },
  };
}

function request(custom?: Record<string, unknown>) {
  const payload = {
    config: { collections, globals, custom },
    find: vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 })),
    findByID: vi.fn(async ({ id }: any) => ({ ...stored(), id })),
    findGlobal: vi.fn(async () => ({ siteName: "Site", _status: "draft" })),
    update: vi.fn(async ({ id, data }: any) => ({ ...stored(), id, ...data })),
    updateGlobal: vi.fn(async ({ data }: any) => ({ siteName: "Site", ...data })),
    create: vi.fn(async ({ data }: any) => ({ id: 50, ...data })),
  };

  return { payload, user: { id: 7 } } as any;
}

async function call(
  name: string,
  args: Record<string, unknown>,
  {
    settings = keySettings(),
    req = request(),
  }: { settings?: Record<string, unknown>; req?: any } = {}
) {
  const wrapped = withContentAgent(hostOptions()) as any;

  await wrapped.overrideAuth(req, async () => settings);
  const tool = wrapped.mcp.tools.find((candidate: any) => candidate.name === name);
  const result = await tool.handler(args, req, {});

  return { req, out: JSON.parse(result.content[0].text) };
}

const chatOnlyTools = async (): Promise<string[]> => {
  const layer = new Set(
    (withContentAgent(hostOptions()) as any).mcp.tools.map((tool: any) => tool.name)
  );

  return (await chatToolNames()).filter((name) => !layer.has(name));
};

const CHAT_ONLY_TOOLS = await chatOnlyTools();

// The endpoint can also hold the default tools of the MCP plugin, which run none of these checks.
// A text of the layer speaks for the content agent tools, never for the endpoint or every tool.
function expectOwnClaimsOnly(text: string) {
  expect(text).not.toMatch(/endpoint/iu);
  expect(text).not.toMatch(/every one of them|another write tool|every write tool/iu);
}

function expectLayerText(text: string) {
  for (const name of CHAT_ONLY_TOOLS) expect(text).not.toContain(name);
  expect(text).not.toMatch(/the chat (then )?(asks|shows)/u);
  expectOwnClaimsOnly(text);
}

describe("the MCP layer: patchDocument", () => {
  it("saves the fields as a draft, as the user of the key, with access control on", async () => {
    const { req, out } = await call("patchDocument", {
      collection: "posts",
      id: 1,
      data: { title: "Second" },
    });

    expect(out).toMatchObject({ ok: true, collection: "posts", id: 1, savedAs: "draft" });
    expect(out.doc.title).toBe("Second");
    expect(req.payload.update).toHaveBeenCalledTimes(1);
    expect(req.payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        id: 1,
        draft: true,
        overrideAccess: false,
        user: { id: 7 },
        data: expect.objectContaining({ title: "Second" }),
      })
    );
  });

  it("updates a global", async () => {
    const { req, out } = await call("patchDocument", {
      global: "site-settings",
      data: { siteName: "New" },
    });

    expect(out).toMatchObject({ ok: true, global: "site-settings" });
    expect(req.payload.updateGlobal).toHaveBeenCalledTimes(1);
  });

  it("refuses a target the key has no update flag for and names what it can update", async () => {
    const settings = keySettings({ ...fullKey, posts: { find: true, create: true } });
    const { req, out } = await call(
      "patchDocument",
      { collection: "posts", id: 1, data: { title: "Second" } },
      { settings }
    );

    expect(out.error).toMatch(/cannot update the collection "posts"/u);
    expect(out.error).toContain('"notes"');
    expect(out.error).toContain('"site-settings"');
    expect(req.payload.update).not.toHaveBeenCalled();
  });

  it("always refuses a destructive update, says what is lost and sends to a person", async () => {
    const { req, out } = await call("patchDocument", {
      collection: "posts",
      id: 1,
      data: { tags: [] },
    });

    expect(out.error).toMatch(/^Refused, nothing was written/u);
    expect(out.error).toContain("tags");
    expect(out.error).toMatch(/admin panel/u);
    expectLayerText(out.error);
    expect(req.payload.update).not.toHaveBeenCalled();
  });

  it("adds entries to a list with many values and keeps every entry it holds", async () => {
    const { req, out } = await call("patchDocument", {
      collection: "posts",
      id: 1,
      add: { related: [4, 2] },
    });

    expect(out).toMatchObject({ ok: true, collection: "posts", id: 1 });
    expect(req.payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ related: [2, 3, 4] }) })
    );
  });

  it("previews an `add` as the whole new list", async () => {
    const { req, out } = await call("patchDocument", {
      collection: "posts",
      id: 1,
      add: { related: [4] },
      preview: true,
    });

    expect(out).toMatchObject({ fieldsChanged: ["related"], safe: true });
    expect(req.payload.update).not.toHaveBeenCalled();
  });

  it("takes `add` and no `remove`: an outside agent removes nothing", () => {
    const tool = (withContentAgent(hostOptions()) as any).mcp.tools.find(
      (candidate: any) => candidate.name === "patchDocument"
    );

    expect(Object.keys(tool.parameters)).toContain("add");
    expect(Object.keys(tool.parameters)).not.toContain("remove");
    expect(
      z.object(tool.parameters).safeParse({ collection: "posts", id: 1, add: { related: [4] } })
        .success
    ).toBe(true);
  });

  it("refuses a rich text field, also in a preview, and names editDocument", async () => {
    const blank = {
      root: {
        type: "root",
        children: [{ type: "paragraph", children: [{ type: "text", text: " " }] }],
      },
    };

    for (const preview of [false, true]) {
      const { req, out } = await call("patchDocument", {
        collection: "posts",
        id: 1,
        data: { title: "Second", content: blank },
        preview,
      });

      expect(out.error).toMatch(/^Refused, nothing was written/u);
      expect(out.error).toContain('"content"');
      expect(out.error).toContain("editDocument");
      expect(req.payload.update).not.toHaveBeenCalled();
    }
  });

  it("a preview writes nothing and its note for a destructive change names no chat", async () => {
    const { req, out } = await call("patchDocument", {
      collection: "posts",
      id: 1,
      data: { title: "Second", tags: [] },
      preview: true,
    });

    expect(out.fieldsChanged).toEqual(expect.arrayContaining(["title", "tags"]));
    expect(out.safe).toBe(false);
    expectLayerText(out.nextStep);
    expect(req.payload.update).not.toHaveBeenCalled();
  });

  it("refuses a blocks field with a text of the layer", async () => {
    const { req, out } = await call("patchDocument", {
      collection: "posts",
      id: 1,
      data: { layout: [{ blockType: "hero", heading: "Hi" }] },
    });

    expect(out.error).toContain('"layout"');
    expectLayerText(out.error);
    expect(req.payload.update).not.toHaveBeenCalled();
  });

  it("an unchanged value names the name search of the layer", async () => {
    const { req, out } = await call("patchDocument", {
      collection: "posts",
      id: 1,
      data: { title: "First" },
    });

    expect(out.error).toContain("lookupDocuments");
    expectLayerText(out.error);
    expect(req.payload.update).not.toHaveBeenCalled();
  });

  it("refuses a collection without drafts", async () => {
    const { req, out } = await call("patchDocument", {
      collection: "orders",
      id: 1,
      data: { total: 5 },
    });

    expect(out.error).toMatch(/has no drafts/u);
    expect(out.error).toMatch(/content agent tool/u);
    expectLayerText(out.error);
    expect(req.payload.update).not.toHaveBeenCalled();
  });
});

describe("the MCP layer: a text speaks only for the content agent tools", () => {
  it("no description speaks for the endpoint or for every tool", () => {
    for (const tool of (withContentAgent(hostOptions()) as any).mcp.tools)
      expectOwnClaimsOnly(tool.description);
  });

  it("addDocument refuses a collection without drafts in the words of the layer", async () => {
    const { req, out } = await call("addDocument", { collection: "orders", data: { total: 5 } });

    expect(out.error).toMatch(/has no drafts/u);
    expect(out.error).toContain("create no document in it");
    expect(out.error).toContain("create the document by hand");
    expectLayerText(out.error);
    expect(req.payload.create).not.toHaveBeenCalled();
  });

  it("replaceText refuses a collection without drafts in the words of the layer", async () => {
    const { req, out } = await call("replaceText", {
      collection: "orders",
      find: "a",
      replace: "b",
      ids: [1],
    });

    expect(out.error).toMatch(/has no drafts/u);
    expectLayerText(out.error);
    expect(req.payload.update).not.toHaveBeenCalled();
  });
});

describe("the MCP layer: addDocument", () => {
  it("creates a draft as the user of the key", async () => {
    const { req, out } = await call("addDocument", { collection: "posts", data: { title: "New" } });

    expect(out).toMatchObject({ ok: true, collection: "posts", id: 50 });
    expect(req.payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        draft: true,
        overrideAccess: false,
        user: { id: 7 },
      })
    );
  });

  it("refuses a collection the key has no create flag for", async () => {
    const settings = keySettings({ ...fullKey, posts: { find: true, update: true } });
    const { req, out } = await call(
      "addDocument",
      { collection: "posts", data: { title: "New" } },
      { settings }
    );

    expect(out.error).toMatch(/cannot create the collection "posts"/u);
    expect(out.error).not.toContain("site-settings");
    expect(req.payload.create).not.toHaveBeenCalled();
  });

  it("refuses a blocks field with a text of the layer", async () => {
    const { req, out } = await call("addDocument", {
      collection: "posts",
      data: { title: "New", layout: [{ blockType: "hero" }] },
    });

    expectLayerText(out.error);
    expect(req.payload.create).not.toHaveBeenCalled();
  });
});

describe("the MCP layer: replaceText", () => {
  it("replaces the string in the named documents", async () => {
    const { req, out } = await call("replaceText", {
      collection: "posts",
      find: "cats",
      replace: "dogs",
      ids: [1, 2],
    });

    expect(out).toMatchObject({ changedDocs: 2, totalReplacements: 4, errors: 0 });
    expect(req.payload.update).toHaveBeenCalledTimes(2);
    expect(req.payload.update.mock.calls[0][0].data).toEqual({
      body: "A text about dogs and dogs",
      _status: "draft",
    });
  });

  it("takes any number of documents in one call and asks nobody", async () => {
    const ids = Array.from({ length: 12 }, (_unused, index) => index + 1);
    const { req, out } = await call("replaceText", {
      collection: "posts",
      find: "cats",
      replace: "dogs",
      ids,
    });

    expect(out.error).toBeUndefined();
    expect(out).toMatchObject({ changedDocs: 12, errors: 0 });
    expect(req.payload.update).toHaveBeenCalledTimes(12);
  });

  it("its description states no limit of documents", () => {
    const tool = (withContentAgent(hostOptions()) as any).mcp.tools.find(
      (candidate: any) => candidate.name === "replaceText"
    );

    expect(tool.description).not.toMatch(/at most \d+ ids/u);
  });

  it("refuses a replace that empties a field or cuts most of its text, as editDocument does", async () => {
    const long = `Keep this. ${"Cats sleep. ".repeat(100)}`;

    for (const [body, find] of [
      [stored().body, stored().body],
      [long, "Cats sleep. ".repeat(100)],
    ]) {
      const req = request();

      req.payload.findByID.mockImplementation(async ({ id }: any) => ({ ...stored(), id, body }));
      const { out } = await call(
        "replaceText",
        { collection: "posts", find, replace: "", ids: [1] },
        { req }
      );

      expect(out).toMatchObject({ changedDocs: 0, errors: 1 });
      expect(JSON.stringify(out)).toMatch(/nothing was written/iu);
      expect(req.payload.update).not.toHaveBeenCalled();
    }
  });

  it("refuses a collection the key has no update flag for", async () => {
    const settings = keySettings({ ...fullKey, posts: { find: true } });
    const { req, out } = await call(
      "replaceText",
      { collection: "posts", find: "cats", replace: "dogs", ids: [1] },
      { settings }
    );

    expect(out.error).toMatch(/cannot update/u);
    expect(req.payload.update).not.toHaveBeenCalled();
  });
});

const today = () => new Date().toISOString().slice(0, 10);

describe("the MCP layer: the history of a write", () => {
  it("keeps the change in one conversation of the key and the day and tells the modules", async () => {
    const memory = memoryMock();
    const onEdits = vi.fn();
    const custom = {
      contentAgent: {
        getMemory: async () => memory,
        getModules: () => [{ name: "probe", onEdits }],
        isChatKey: () => false,
      },
    };
    const req = request(custom);

    await call("patchDocument", { collection: "posts", id: 1, data: { title: "Second" } }, { req });
    await call("addDocument", { collection: "posts", data: { title: "New" } }, { req });
    const id = conversationIdOf("3", "7", today());

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(memory.conversations.findOrCreate).toHaveBeenCalledWith(id, "7");
    expect(memory.titles.get(id)).toBe("MCP: Outside agent");
    expect(memory.conversations.updateTitle).toHaveBeenCalledTimes(1);
    expect(memory.changesets.record).toHaveBeenCalledTimes(2);
    expect(memory.changesets.record.mock.calls[0]).toEqual([
      id,
      [
        expect.objectContaining({
          collection: "posts",
          id: 1,
          op: "update",
          before: expect.objectContaining({ title: "First" }),
          after: expect.objectContaining({ title: "Second" }),
        }),
      ],
    ]);
    expect(onEdits).toHaveBeenCalledTimes(2);
    expect(onEdits.mock.calls[1][0][0]).toMatchObject({ op: "create", toolName: "addDocument" });
    expect(onEdits.mock.calls[0][1]).toMatchObject({ conversationId: id, userId: "7" });
  });

  it("another key and another day get another conversation", () => {
    const id = conversationIdOf("3", "7", "2026-01-01");

    expect(conversationIdOf("4", "7", "2026-01-01")).not.toBe(id);
    expect(conversationIdOf("3", "8", "2026-01-01")).not.toBe(id);
    expect(conversationIdOf("3", "7", "2026-01-02")).not.toBe(id);
    expect(conversationIdOf("3", "7", "2026-01-01")).toBe(id);
  });

  it("a read opens no conversation", async () => {
    const memory = memoryMock();
    const req = request({
      contentAgent: { getMemory: async () => memory, getModules: () => [], isChatKey: () => false },
    });

    await call("readDocument", { collection: "posts", id: 1 }, { req });
    await call("patchDocument", { collection: "posts", id: 1, data: { tags: [] } }, { req });

    expect(memory.conversations.findOrCreate).not.toHaveBeenCalled();
  });

  it("writes without the plugin and without its memory database", async () => {
    const bare = await call("patchDocument", {
      collection: "posts",
      id: 1,
      data: { title: "Second" },
    });
    const onEdits = vi.fn();
    const noMemory = await call(
      "patchDocument",
      { collection: "posts", id: 1, data: { title: "Second" } },
      {
        req: request({
          contentAgent: {
            getMemory: async () => null,
            getModules: () => [{ name: "probe", onEdits }],
            isChatKey: () => false,
          },
        }),
      }
    );

    expect(bare.out.ok).toBe(true);
    expect(noMemory.out.ok).toBe(true);
    expect(onEdits).toHaveBeenCalledTimes(1);
  });

  it("a history that fails does not fail the write", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const custom = {
      contentAgent: {
        getMemory: async () => {
          throw new Error("database down");
        },
        getModules: () => [],
        isChatKey: () => false,
      },
    };
    const { out } = await call(
      "patchDocument",
      { collection: "posts", id: 1, data: { title: "Second" } },
      { req: request(custom) }
    );

    expect(out.ok).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
