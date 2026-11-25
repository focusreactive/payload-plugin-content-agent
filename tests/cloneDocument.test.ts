import { describe, it, expect, vi } from "vitest";
import {
  buildClonePayload,
  cloneFieldValue,
  createCloneDocumentTool,
} from "../src/agent/tools/cloneDocument.js";
import { createReadDocumentTool } from "../src/agent/tools/documents/readDocument.js";
import { documentOutline } from "../src/agent/content/outline.js";
import type { SchemaContext, SchemaField } from "../src/types.js";
import type { DocumentIO } from "../src/agent/content/documentIo.js";

const richText = (text: string) => ({
  root: {
    type: "root",
    children: [
      {
        type: "paragraph",
        version: 1,
        children: [
          { type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" },
        ],
      },
    ],
    direction: "ltr",
    format: "",
    indent: 0,
    version: 1,
  },
});

const pageFields: SchemaField[] = [
  { name: "title", type: "text" },
  { name: "slug", type: "text", unique: true },
  { name: "migrationId", type: "text", readOnly: true },
  {
    name: "layout",
    type: "blocks",
    blocks: [
      {
        slug: "hero",
        fields: [
          { name: "heading", type: "text" },
          { name: "body", type: "richText" },
          {
            name: "partners",
            type: "array",
            fields: [
              { name: "label", type: "text" },
              { name: "logo", type: "upload", relationTo: "media" },
            ],
          },
        ],
      },
      {
        slug: "testimonials",
        fields: [{ name: "items", type: "relationship", relationTo: "reviews", hasMany: true }],
      },
      {
        slug: "columns",
        fields: [
          { name: "title", type: "text" },
          {
            name: "inner",
            type: "blocks",
            blocks: [{ slug: "metric", fields: [{ name: "value", type: "text" }] }],
          },
        ],
      },
    ],
  },
];

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      fields: pageFields,
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "reviews",
      fields: [{ name: "title", type: "text" }],
      hasVersions: false,
      hasDrafts: false,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const sourceDoc = () => ({
  id: "src-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  _status: "published",
  title: "Drupal to Headless CMS",
  slug: "migrate-from-drupal-to-headless-cms",
  migrationId: "legacy-9912",
  layout: [
    {
      id: "blk-hero",
      blockType: "hero",
      heading: "Drupal to Headless CMS Migration",
      body: richText("Legacy Drupal slows publishing down."),
      partners: [
        { id: "row-1", label: "Sanity", logo: 11 },
        { id: "row-2", label: "Payload", logo: 12 },
      ],
    },
    { id: "blk-tst", blockType: "testimonials", items: [4, 7] },
    {
      id: "blk-col",
      blockType: "columns",
      title: "Firsty",
      inner: [{ id: "blk-m1", blockType: "metric", value: "60% faster" }],
    },
  ],
});

function fakeIo(overrides: Partial<DocumentIO> = {}): DocumentIO {
  return {
    transports: () => ({ read: "local", write: "local", create: "local" }),
    read: vi.fn(async () => ({ doc: sourceDoc() })),
    write: vi.fn(async () => ({})),
    create: vi.fn(async (_t: any, opts: any) => ({ doc: { id: "new-9", ...opts.data } })),
    list: vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 })),
    ...overrides,
  } as DocumentIO;
}

const ctx = { toolCallId: "t", messages: [] } as any;

describe("cloneFieldValue / buildClonePayload", () => {
  it("strips row ids from blocks and nested array rows, at every depth", () => {
    const payload: any = buildClonePayload(pageFields, sourceDoc());
    const [hero, testimonials, columns] = payload.layout;

    expect(hero.id).toBeUndefined();
    expect(hero.blockType).toBe("hero");
    expect(hero.partners.map((r: any) => r.id)).toEqual([undefined, undefined]);
    expect(testimonials.id).toBeUndefined();
    expect(columns.inner[0].id).toBeUndefined();
    expect(columns.inner[0].blockType).toBe("metric");
  });

  it("carries every relationship and upload id through verbatim", () => {
    const payload: any = buildClonePayload(pageFields, sourceDoc());

    expect(payload.layout[0].partners.map((r: any) => r.logo)).toEqual([11, 12]);
    expect(payload.layout[1].items).toEqual([4, 7]);
  });

  it("copies richText byte-for-byte, keeping the Lexical tree intact", () => {
    const payload: any = buildClonePayload(pageFields, sourceDoc());

    expect(payload.layout[0].body).toEqual(richText("Legacy Drupal slows publishing down."));
  });

  it("drops Payload-managed keys and readOnly fields", () => {
    const payload: any = buildClonePayload(pageFields, sourceDoc());

    for (const key of ["id", "createdAt", "updatedAt", "_status", "migrationId"]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("keeps keys the schema does not model rather than losing them", () => {
    const payload = buildClonePayload(pageFields, {
      ...sourceDoc(),
      customField: { nested: "value" },
    });

    expect(payload.customField).toEqual({ nested: "value" });
  });

  it("does not mutate the source document", () => {
    const source = sourceDoc();

    buildClonePayload(pageFields, source);
    expect(source.layout[0].id).toBe("blk-hero");
    expect((source.layout[0] as any).partners[0].id).toBe("row-1");
  });

  it("leaves an id inside a richText value alone (Lexical node shape, not a DB row)", () => {
    const embedded = {
      root: { children: [{ type: "block", fields: { id: "lex-1", blockType: "cta" } }] },
    };

    expect(cloneFieldValue(embedded, { name: "body", type: "richText" })).toEqual(embedded);
  });
});

const tool = () => createCloneDocumentTool(fakeIo(), schema);

describe("cloneDocument tool", () => {
  it("creates the clone with the source layout and the caller's overrides", async () => {
    const io = fakeIo();
    const res: any = await createCloneDocumentTool(io, schema).execute!(
      {
        collection: "pages",
        sourceId: "src-1",
        data: { title: "Drupal to Contentful", slug: "migrate-from-drupal-to-contentful" },
      },
      ctx
    );

    expect(res.ok).toBe(true);
    expect(res.id).toBe("new-9");
    const created = (io.create as any).mock.calls[0][1].data;

    expect(created.title).toBe("Drupal to Contentful");
    expect(created.slug).toBe("migrate-from-drupal-to-contentful");
    expect(created.layout).toHaveLength(3);
    expect(created.layout.map((b: any) => b.blockType)).toEqual([
      "hero",
      "testimonials",
      "columns",
    ]);
    expect(res.structure.join("\n")).toContain("testimonials");
  });

  it("refuses a clone that reuses a unique value of the source", async () => {
    const res: any = await tool().execute!(
      {
        collection: "pages",
        sourceId: "src-1",
        data: { slug: "migrate-from-drupal-to-headless-cms" },
      },
      ctx
    );

    expect(res.error).toMatch(/NEW value in `data` for `slug`/u);
  });

  it("refuses a clone with no new value for a unique field", async () => {
    const res: any = await tool().execute!(
      { collection: "pages", sourceId: "src-1", data: { title: "X" } },
      ctx
    );

    expect(res.error).toMatch(/NEW value in `data` for `slug`/u);
  });

  it("refuses empty overrides", async () => {
    const res: any = await tool().execute!(
      { collection: "pages", sourceId: "src-1", data: {} },
      ctx
    );

    expect(res.error).toMatch(/identity/u);
  });

  it("refuses a model-authored blocks array in the overrides", async () => {
    const res: any = await tool().execute!(
      {
        collection: "pages",
        sourceId: "src-1",
        data: { slug: "new", layout: [{ blockType: "hero" }] },
      },
      ctx
    );

    expect(res.error).toMatch(/Refusing the "layout" blocks field/u);
  });

  it("refuses an unknown collection and a missing source", async () => {
    expect(
      (
        (await tool().execute!(
          { collection: "nope", sourceId: "1", data: { slug: "x" } },
          ctx
        )) as any
      ).error
    ).toMatch(/Unknown collection/u);
    const io = fakeIo({ read: vi.fn(async () => ({ doc: null })) as any });
    const res: any = await createCloneDocumentTool(io, schema).execute!(
      { collection: "pages", sourceId: "gone", data: { slug: "x" } },
      ctx
    );

    expect(res.error).toMatch(/not found/u);
  });

  it("surfaces a failed create instead of reporting success", async () => {
    const io = fakeIo({
      create: vi.fn(async () => ({ error: "the record could not be written" })) as any,
    });
    const res: any = await createCloneDocumentTool(io, schema).execute!(
      { collection: "pages", sourceId: "src-1", data: { slug: "free" } },
      ctx
    );

    expect(res.ok).toBeUndefined();
    expect(res.error).toMatch(/the record could not be written/u);
  });

  it("explains a taken unique value instead of passing the raw validation error through", async () => {
    const io = fakeIo({
      create: vi.fn(async () => ({ error: "The following field is invalid: slug" })) as any,
      list: vi.fn(async () => ({
        docs: [{ id: "existing-9", slug: "taken" }],
        totalDocs: 1,
        totalPages: 1,
      })) as any,
    });
    const res: any = await createCloneDocumentTool(io, schema).execute!(
      { collection: "pages", sourceId: "src-1", data: { slug: "taken" } },
      ctx
    );

    expect(res.ok).toBeUndefined();
    expect(res.error).toMatch(/already in use/u);
    expect(res.error).toContain("existing-9");
    expect(res.taken).toEqual({ field: "slug", value: "taken" });
    expect(res.existingId).toBe("existing-9");
  });

  it("records the clone as a changeset so the review panel can diff it", async () => {
    const recordEdits = vi.fn();

    await createCloneDocumentTool(fakeIo(), schema, recordEdits).execute!(
      { collection: "pages", sourceId: "src-1", data: { slug: "fresh" }, locale: "es" },
      ctx
    );
    expect(recordEdits).toHaveBeenCalledWith([
      expect.objectContaining({
        collection: "pages",
        id: "new-9",
        op: "clone",
        locale: "es",
        toolName: "cloneDocument",
      }),
    ]);
  });
});

describe('documentOutline / readDocument({ view: "outline" })', () => {
  it("renders ordered block types with field previews and nested arrays", () => {
    const out = documentOutline(pageFields, sourceDoc()).join("\n");

    expect(out).toContain("layout: 3 block(s)");
    expect(out).toContain("1. hero");
    expect(out).toContain('heading: "Drupal to Headless CMS Migration"');
    expect(out).toContain("partners: [2 items]");
    expect(out).toContain("2. testimonials");
    expect(out).toContain("3. columns");
    expect(out).toContain("inner: 1 block(s)");
    expect(out).toContain("body: [rich text]");
    expect(out).not.toContain("Legacy Drupal");
  });

  it("reports a flat document honestly instead of an empty structure", async () => {
    const io = fakeIo({
      read: vi.fn(async () => ({ doc: { id: "r1", title: "A review" } })) as any,
    });
    const res: any = await createReadDocumentTool(io, schema).execute!(
      { collection: "reviews", id: "r1", view: "outline" },
      ctx
    );

    expect(res).toMatchObject({ collection: "reviews", id: "r1" });

    expect(res.structure).toEqual([]);
    expect(res.note).toMatch(/flat fields only/u);
  });

  it("outlines a global with its block ids", async () => {
    const withGlobal: SchemaContext = {
      ...schema,
      globals: [{ slug: "frontpage", fields: pageFields, hasVersions: true, hasDrafts: true }],
    };
    const read = vi.fn(async () => ({ doc: sourceDoc() })) as any;
    const res: any = await createReadDocumentTool(fakeIo({ read }), withGlobal).execute!(
      { global: "frontpage", view: "outline" },
      ctx
    );

    expect(res.global).toBe("frontpage");
    expect(res.structure.join("\n")).toContain("layout: 3 block(s)");
    expect(res.note).toBeUndefined();
    expect(read).toHaveBeenCalledWith(
      { global: "frontpage" },
      expect.objectContaining({ callId: "outline" })
    );
  });

  it("requires exactly one of collection or global", async () => {
    const res: any = await createReadDocumentTool(fakeIo(), schema).execute!(
      { view: "outline" },
      ctx
    );

    expect(res.error).toMatch(/exactly ONE/u);
  });
});
