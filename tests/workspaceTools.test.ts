import { describe, it, expect } from "vitest";
import { createWorkspaceTools } from "../src/agent/content/workspaceTools.js";
import { buildChangedFields } from "../src/agent/content/schemaValues.js";
import type { SchemaContext, SchemaField } from "../src/types.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text", localized: true },
        { name: "subtitle", type: "text" },
        { name: "body", type: "richText", editor: "lexical" },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const asIo = (tools: any) => createDocumentIO({ mcpTools: tools, schema });

const opts = { toolCallId: "t", messages: [] } as any;

function fakeMcp(doc: any) {
  const state: { updateArgs: any; findArgs: any; finds: any[] } = {
    updateArgs: null,
    findArgs: null,
    finds: [],
  };
  const tools = {
    findPosts: {
      execute: async (params: any) => {
        state.findArgs = params;
        state.finds.push(params);

        return {
          content: [
            { type: "text", text: `Resource from collection "posts":\n${JSON.stringify(doc)}` },
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

const makeDoc = () => ({
  id: 1,
  title: "A",
  subtitle: "B",
  body: {
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [
        { type: "paragraph", version: 1, children: [{ type: "text", version: 1, text: "hi" }] },
      ],
    },
  },
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
});

describe("saveDocument: minimal patch (precision, no collateral)", () => {
  it("sends ONLY the changed top-level field, not the whole document", async () => {
    const { tools, state } = fakeMcp(makeDoc());
    const ws: any = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(ws, asIo(tools), schema);

    await t.openDocument.execute!({ collection: "posts", id: "1" }, opts);
    ws.ref.current.title = "A2";

    const r: any = await t.saveDocument.execute!({}, opts);

    expect(r.ok).toBe(true);
    expect(r.changed).toEqual(["title"]);
    expect(state.updateArgs.title).toBe("A2");
    expect("subtitle" in state.updateArgs).toBe(false);
    expect("body" in state.updateArgs).toBe(false);
    expect("createdAt" in state.updateArgs).toBe(false);
    expect("updatedAt" in state.updateArgs).toBe(false);
  });

  it("saves nothing (no update call) when no field changed", async () => {
    const { tools, state } = fakeMcp(makeDoc());
    const ws: any = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(ws, asIo(tools), schema);

    await t.openDocument.execute!({ collection: "posts", id: "1" }, opts);

    const r: any = await t.saveDocument.execute!({}, opts);

    expect(r.changed).toEqual([]);
    expect(state.updateArgs).toBeNull();
  });

  it("heals a pre-existing empty-root richText on save (no edit needed)", async () => {
    const broken = {
      ...makeDoc(),
      body: {
        root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children: [] },
      },
    };
    const { tools, state } = fakeMcp(broken);
    const ws: any = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(ws, asIo(tools), schema);

    await t.openDocument.execute!({ collection: "posts", id: "1" }, opts);

    const r: any = await t.saveDocument.execute!({}, opts);

    expect(r.changed).toContain("body");
    expect(state.updateArgs.body.root.children.length).toBeGreaterThanOrEqual(1);
    expect(state.updateArgs.body.root.children[0].type).toBe("paragraph");
  });

  it("surfaces a silently-rejected MCP write instead of reporting success", async () => {
    const tools = {
      findPosts: {
        execute: async () => ({
          content: [
            {
              type: "text",
              text: `Resource from collection "posts":\n${JSON.stringify(makeDoc())}`,
            },
          ],
        }),
      },
      updatePosts: {
        execute: async () => ({
          content: [
            { type: "text", text: 'Error updating resource in collection "posts": invalid layout' },
          ],
        }),
      },
    };
    const ws: any = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(ws, asIo(tools), schema);

    await t.openDocument.execute!({ collection: "posts", id: "1" }, opts);
    ws.ref.current.title = "A2";
    const r: any = await t.saveDocument.execute!({}, opts);

    expect(r.ok).toBeUndefined();
    expect(r.error).toContain("CMS rejected the save");
  });

  it("opens AND saves in the SAME locale (localized edit lands in the right locale)", async () => {
    const { tools, state } = fakeMcp(makeDoc());
    const ws: any = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(ws, asIo(tools), schema);

    await t.openDocument.execute!({ collection: "posts", id: "1", locale: "es" }, opts);
    expect(state.findArgs.locale).toBe("es");
    ws.ref.current.title = "Título";
    const r: any = await t.saveDocument.execute!({}, opts);

    expect(r.ok).toBe(true);
    expect(state.updateArgs.locale).toBe("es");
    expect(state.updateArgs.title).toBe("Título");
  });

  it("TRANSLATION: reads the source locale but saves to the target (writeLocale)", async () => {
    const { tools, state } = fakeMcp(makeDoc());
    const ws: any = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(ws, asIo(tools), schema);

    await t.openDocument.execute!(
      { collection: "posts", id: "1", locale: "en", writeLocale: "es" },
      opts
    );
    expect(state.finds[0].locale).toBe("en");
    expect(ws.locale).toBe("es");
    ws.ref.current.title = "Título traducido";
    const r: any = await t.saveDocument.execute!({}, opts);

    expect(r.ok).toBe(true);
    expect(state.updateArgs.locale).toBe("es");
    expect(state.updateArgs.title).toBe("Título traducido");
  });

  it("TRANSLATION: a change to a NON-localized field is reverted, never saved to the target locale", async () => {
    const { tools, state } = fakeMcp(makeDoc());
    const ws: any = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(ws, asIo(tools), schema);

    await t.openDocument.execute!(
      { collection: "posts", id: "1", locale: "en", writeLocale: "es" },
      opts
    );
    ws.ref.current.subtitle = "Mistakenly translated subtitle";
    const r: any = await t.saveDocument.execute!({}, opts);

    expect(r.error).toMatch(/shared across every locale/u);
    expect(r.revertedShared).toBe(1);
    expect(r.changed).toEqual([]);
    expect(state.updateArgs).toBeNull();
  });

  it("omits locale entirely on a single-locale (default) open/save", async () => {
    const { tools, state } = fakeMcp(makeDoc());
    const ws: any = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(ws, asIo(tools), schema);

    await t.openDocument.execute!({ collection: "posts", id: "1" }, opts);
    expect("locale" in state.findArgs).toBe(false);
    ws.ref.current.title = "A2";
    await t.saveDocument.execute!({}, opts);
    expect("locale" in state.updateArgs).toBe(false);
  });

  it("leaves a valid (non-empty) richText untouched - no spurious save", async () => {
    const { tools, state } = fakeMcp(makeDoc());
    const ws: any = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(ws, asIo(tools), schema);

    await t.openDocument.execute!({ collection: "posts", id: "1" }, opts);

    const r: any = await t.saveDocument.execute!({}, opts);

    expect(r.changed).toEqual([]);
    expect(state.updateArgs).toBeNull();
  });
});

function fakePayload(doc: any) {
  const state: { updateArgs: any } = { updateArgs: null };
  const payload = {
    findGlobal: async () => ({ ...doc }),
    updateGlobal: async (args: any) => {
      state.updateArgs = args;

      return { ...doc, ...args.data };
    },
  };

  return { payload, state };
}

describe("saveDocument: globals (Local API, no id)", () => {
  const globalSchema: SchemaContext = {
    collections: [],
    globals: [
      {
        slug: "site-settings",
        fields: [
          { name: "siteName", type: "text" },
          { name: "tagline", type: "text" },
        ] as SchemaField[],
        hasVersions: true,
        hasDrafts: true,
      },
    ],
  };

  it("opens a global with no id and saves only the changed field", async () => {
    const { payload, state } = fakePayload({ siteName: "Acme Co", tagline: "Old" });
    const io = createDocumentIO({
      mcpTools: {},
      schema: globalSchema,
      payload: payload as any,
      user: { id: 1 } as any,
    });
    const ws: any = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(ws, io, globalSchema);

    const opened: any = await t.openDocument.execute!({ global: "site-settings" }, opts);

    expect(opened.ok).toBe(true);
    expect(opened.global).toBe("site-settings");
    ws.ref.current.tagline = "New tagline";

    const r: any = await t.saveDocument.execute!({}, opts);

    expect(r.ok).toBe(true);
    expect(r.changed).toEqual(["tagline"]);
    expect(state.updateArgs.data).toEqual({ tagline: "New tagline", _status: "draft" });
    expect(state.updateArgs.slug).toBe("site-settings");
  });

  it("refuses when both collection and global are given, or neither", async () => {
    const io = createDocumentIO({ mcpTools: {}, schema: globalSchema });
    const ws: any = { ref: { current: null }, collection: null };
    const t = createWorkspaceTools(ws, io, globalSchema);
    const both: any = await t.openDocument.execute!(
      { collection: "posts", global: "site-settings", id: "1" },
      opts
    );

    expect(both.error).toMatch(/exactly ONE/u);
    const neither: any = await t.openDocument.execute!({}, opts);

    expect(neither.error).toMatch(/exactly ONE/u);
  });
});

describe("buildChangedFields", () => {
  it("returns only changed top-level fields, excluding reserved keys", () => {
    const a = { id: 1, title: "A", subtitle: "B", updatedAt: "x" };
    const b = { id: 1, title: "A2", subtitle: "B", updatedAt: "y" };
    const { patch, changed } = buildChangedFields(a, b);

    expect(changed).toEqual(["title"]);
    expect(patch).toEqual({ title: "A2" });
  });

  it("an added row with a temp id is a change of its field", () => {
    const a = { id: 1, layout: [{ id: "real1", blockType: "hero", heading: "H" }] };
    const b = {
      id: 1,
      layout: [
        { id: "real1", blockType: "hero", heading: "H" },
        { id: "tmp_abc", blockType: "cta", heading: "New" },
      ],
    };
    const { changed } = buildChangedFields(a, b);

    expect(changed).toEqual(["layout"]);
  });

  it("reports no change when only a temp id differs on otherwise-equal content", () => {
    const a = { id: 1, layout: [{ id: "tmp_x", blockType: "hero", heading: "H" }] };
    const b = { id: 1, layout: [{ id: "tmp_y", blockType: "hero", heading: "H" }] };

    expect(buildChangedFields(a, b).changed).toEqual([]);
  });
});
