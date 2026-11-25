import { describe, expect, it, vi } from "vitest";
import { createWorkspaceTools } from "../src/agent/content/workspaceTools.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
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
  globals: [],
  locales: ["en", "es"],
  defaultLocale: "en",
} as SchemaContext;
const opts = { toolCallId: "t", messages: [] } as any;

function site() {
  const store: Record<string, any> = {
    en: { id: 1, title: "Hello", updatedAt: "t1" },
    es: { id: 1, title: "Hola", updatedAt: "t1" },
  };
  const io = {
    transports: () => ({ read: "local", write: "local", create: "local" }),
    read: vi.fn(async (_target: unknown, { locale }: any) => ({
      doc: structuredClone(store[locale ?? "en"]),
    })),
    write: vi.fn(async (_target: unknown, { patch }: any) => ({ doc: patch })),
    lockRefusal: async () => null,
  } as any;

  return { store, io };
}

describe("the save of a translation and a person's edit of the target locale", () => {
  it("is refused when the person changed the field in the target locale after the open", async () => {
    const { store, io } = site();
    const workspace: any = { ref: { current: null }, collection: null };
    const tools = createWorkspaceTools(workspace, io, schema);

    await tools.openDocument.execute!(
      { collection: "posts", id: "1", locale: "en", writeLocale: "es" },
      opts
    );
    store.es = { ...store.es, title: "Hola, de una persona", updatedAt: "t2" };
    workspace.ref.current.title = "Hola del agente";
    const saved: any = await tools.saveDocument.execute!({}, opts);

    expect(saved.error).toMatch(/Not saved: "title"/u);
    expect(io.write).not.toHaveBeenCalled();
  });

  it("saves when nobody changed the target locale", async () => {
    const { io } = site();
    const workspace: any = { ref: { current: null }, collection: null };
    const tools = createWorkspaceTools(workspace, io, schema);

    await tools.openDocument.execute!(
      { collection: "posts", id: "1", locale: "en", writeLocale: "es" },
      opts
    );
    workspace.ref.current.title = "Hola del agente";
    const saved: any = await tools.saveDocument.execute!({}, opts);

    expect(saved.ok).toBe(true);
    expect(io.write.mock.calls[0][1]).toMatchObject({ locale: "es" });
  });
});

describe("an edit of a locale other than the default", () => {
  const layoutSchema = {
    ...schema,
    collections: [
      {
        ...schema.collections[0],
        fields: [
          {
            name: "layout",
            type: "blocks",
            blocks: [
              {
                slug: "section",
                fields: [
                  { name: "heading", type: "text", localized: true },
                  { name: "body", type: "textarea", localized: true },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as SchemaContext;
  const stored: Record<string, any> = {
    en: {
      id: 1,
      updatedAt: "t1",
      layout: [{ id: "r1", blockType: "section", heading: "Why", body: "English body" }],
    },
    es: {
      id: 1,
      updatedAt: "t1",
      layout: [{ id: "r1", blockType: "section", heading: "Por qué", body: null }],
    },
  };
  const withFallback = (doc: any) => ({
    ...doc,
    layout: doc.layout.map((row: any, i: number) => ({
      ...row,
      body: row.body ?? stored.en.layout[i].body,
    })),
  });

  it("writes no value that the locale only showed from its fallback locale", async () => {
    const io = {
      transports: () => ({ read: "local", write: "local", create: "local" }),
      read: vi.fn(async (_target: unknown, { locale, fallbackLocale }: any) => {
        const doc = structuredClone(stored[locale ?? "en"]);

        return { doc: fallbackLocale === false ? doc : withFallback(doc) };
      }),
      write: vi.fn(async (_target: unknown, { patch }: any) => ({ doc: patch })),
      lockRefusal: async () => null,
    } as any;
    const workspace: any = { ref: { current: null }, collection: null };
    const tools = createWorkspaceTools(workspace, io, layoutSchema);

    await tools.openDocument.execute!({ collection: "posts", id: "1", locale: "es" }, opts);
    workspace.ref.current.layout[0].heading = "Por qué ahora";
    const saved: any = await tools.saveDocument.execute!({}, opts);

    expect(saved.ok).toBe(true);
    const { patch, locale } = io.write.mock.calls[0][1];

    expect(locale).toBe("es");
    expect(patch.layout[0].heading).toBe("Por qué ahora");
    expect(patch.layout[0].body).toBeNull();
  });
});

describe("an edit that fills a locale from what its fallback shows", () => {
  it("lets the editor see the fallback text and writes the new value of that field", async () => {
    const stored: Record<string, any> = {
      en: { id: 1, updatedAt: "t1", title: "Hello" },
      de: { id: 1, updatedAt: "t1", title: null },
    };
    const io = {
      transports: () => ({ read: "local", write: "local", create: "local" }),
      read: vi.fn(async (_target: unknown, { locale, fallbackLocale }: any) => {
        const doc = structuredClone(stored[locale ?? "en"]);

        return { doc: fallbackLocale === false ? doc : { ...doc, title: doc.title ?? "Hello" } };
      }),
      write: vi.fn(async (_target: unknown, { patch }: any) => ({ doc: patch })),
      lockRefusal: async () => null,
    } as any;
    const workspace: any = { ref: { current: null }, collection: null };
    const tools = createWorkspaceTools(workspace, io, schema);

    await tools.openDocument.execute!({ collection: "posts", id: "1", locale: "de" }, opts);
    expect(workspace.ref.current.title).toBe("Hello");
    workspace.ref.current.title = "Hallo";
    const saved: any = await tools.saveDocument.execute!({}, opts);

    expect(saved.ok).toBe(true);
    expect(io.write.mock.calls[0][1]).toMatchObject({ locale: "de", patch: { title: "Hallo" } });
  });
});
