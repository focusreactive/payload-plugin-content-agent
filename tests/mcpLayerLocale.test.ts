import { beforeAll, describe, expect, it, vi } from "vitest";
import { sanitizeConfig } from "payload";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { withContentAgent } from "../src/mcpLayer/index.js";

const hero = {
  slug: "hero",
  fields: [
    { name: "heading", type: "text", localized: true },
    { name: "note", type: "text", localized: true },
  ],
};

// es has a heading of its own in b1 and none in b2: a read with fallback lends b2 the English one.
const byLocale: Record<string, any> = {
  en: [
    { id: "b1", blockType: "hero", heading: "Welcome", note: "First" },
    { id: "b2", blockType: "hero", heading: "Second", note: "Other" },
  ],
  es: [
    { id: "b1", blockType: "hero", heading: "Bienvenido", note: null },
    { id: "b2", blockType: "hero", heading: null, note: null },
  ],
};
const lend = (rows: any[]) =>
  rows.map((row, index) => ({
    ...row,
    heading: row.heading ?? byLocale.en[index].heading,
    note: row.note ?? byLocale.en[index].note,
  }));

let config: unknown;

beforeAll(async () => {
  config = await sanitizeConfig({
    secret: "x",
    db: { defaultIDType: "number", init: () => ({}) },
    editor: lexicalEditor({}),
    localization: { locales: ["en", "es"], defaultLocale: "en", fallback: true },
    collections: [
      {
        slug: "pages",
        timestamps: true,
        versions: { drafts: true },
        fields: [
          { name: "title", type: "text" },
          { name: "layout", type: "blocks", blocks: [hero] },
        ],
      },
    ],
  } as any);
});

describe("the MCP layer: editDocument in a locale other than the default", () => {
  it("writes no value that the locale only showed from its fallback locale", async () => {
    const payload = {
      config,
      find: vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 })),
      findByID: vi.fn(async ({ id, locale, fallbackLocale }: any) => {
        const rows = structuredClone(byLocale[locale ?? "en"]);

        return {
          id,
          title: "Home",
          _status: "draft",
          layout: fallbackLocale === false || fallbackLocale === "none" ? rows : lend(rows),
        };
      }),
      update: vi.fn(async ({ id, data }: any) => ({ id, ...data })),
    };
    const req = { payload, user: { id: 7 } } as any;
    const wrapped = withContentAgent({ collections: { pages: { enabled: true } } }) as any;

    await wrapped.overrideAuth(req, async () => ({
      id: 3,
      label: "Outside",
      user: { id: 7 },
      pages: { find: true, create: true, update: true },
    }));
    const tool = wrapped.mcp.tools.find((candidate: any) => candidate.name === "editDocument");
    const result = await tool.handler(
      {
        collection: "pages",
        id: 1,
        locale: "es",
        operations: [{ type: "set", ref: "layout[b1].heading", value: "Hola" }],
      },
      req,
      {}
    );
    const out = JSON.parse(result.content[0].text);
    const { data, locale } = payload.update.mock.calls[0][0];

    expect(out.status).toBe("saved");
    expect(locale).toBe("es");
    expect(data.layout[0].heading).toBe("Hola");
    expect(data.layout[1].heading).toBeNull();
    expect(data.layout[0].note).toBeNull();
  });
});
