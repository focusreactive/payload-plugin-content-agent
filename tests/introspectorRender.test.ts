import { describe, it, expect } from "vitest";
import {
  schemaContextToString,
  introspectSchema,
  renderSchemaForPrompt,
  collectBlockDefs,
} from "../src/schema/introspector.js";
import type { SchemaContext } from "../src/types.js";

const blockSchema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      fields: [
        {
          name: "layout",
          type: "blocks",
          minRows: 1,
          maxRows: 12,
          blocks: [
            {
              slug: "hero",
              label: "Hero",
              description: "Opening section. Use once, at the top.",
              group: "Sections",
              fields: [
                { name: "heading", type: "text", required: true, description: "Main headline" },
                {
                  name: "alignment",
                  type: "select",
                  options: ["left", "center"],
                  defaultValue: "center",
                },
              ],
            },
          ],
        },
      ],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

describe("schemaContextToString: block & section semantics", () => {
  const out = schemaContextToString(blockSchema);

  it("renders block label and purpose description", () => {
    expect(out).toContain('Block "hero" - Hero');
    expect(out).toContain("Opening section. Use once, at the top.");
    expect(out).toContain("[group: Sections]");
  });

  it("renders field default values", () => {
    expect(out).toContain('[default: "center"]');
  });

  it("renders blocks-field row cardinality", () => {
    expect(out).toContain("[rows: 1-12]");
  });

  it("still renders nested block field descriptions", () => {
    expect(out).toContain("Main headline");
  });
});

describe("schemaContextToString: richText embedded blocks", () => {
  const out = schemaContextToString({
    globals: [],
    collections: [
      {
        slug: "posts",
        fields: [
          {
            name: "content",
            type: "richText",
            editor: "lexical",
            blocks: [
              { slug: "callout", label: "Callout", fields: [{ name: "heading", type: "text" }] },
            ],
            inlineBlocks: [{ slug: "mention", fields: [{ name: "label", type: "text" }] }],
          },
        ],
        hasVersions: false,
        hasDrafts: false,
        hasAuth: false,
        timestamps: true,
      },
    ],
  } as SchemaContext);

  it("tells the agent how to address fields inside embedded blocks", () => {
    expect(out).toContain("[embeds blocks - address fields inside as content[blockId].subField]");
  });
  it("renders embedded + inline block definitions distinctly", () => {
    expect(out).toContain('Embedded block "callout" - Callout');
    expect(out).toContain('Inline block "mention"');
  });
});

describe("localization", () => {
  const config = {
    localization: {
      locales: [
        { code: "en", label: "English" },
        { code: "es", label: "Spanish" },
      ],
      defaultLocale: "en",
    },
    collections: [
      {
        slug: "posts",
        timestamps: true,
        fields: [
          { name: "title", type: "text", localized: true },
          { name: "slug", type: "text" },
        ],
      },
    ],
    globals: [],
  } as any;

  it("captures configured locales + defaultLocale into the schema context", () => {
    const schema = introspectSchema(config);

    expect(schema.locales).toEqual(["en", "es"]);
    expect(schema.defaultLocale).toBe("en");
  });

  it("marks localized fields and leaves shared fields unmarked", () => {
    const schema = introspectSchema(config);
    const fields = schema.collections[0].fields;

    expect(fields.find((f) => f.name === "title")!.localized).toBe(true);
    expect(fields.find((f) => f.name === "slug")!.localized).toBeUndefined();
  });

  it("renders a Localization section and [localized] markers in the prompt", () => {
    const out = schemaContextToString(introspectSchema(config));

    expect(out).toContain("## Localization");
    expect(out).toContain("en, es");
    expect(out).toMatch(/title \(text\) \[localized\]/u);
  });

  it("omits localization entirely for a single-locale project", () => {
    const schema = introspectSchema({
      collections: [{ slug: "x", timestamps: true, fields: [{ name: "a", type: "text" }] }],
      globals: [],
    } as any);

    expect(schema.locales).toBeUndefined();
    expect(schemaContextToString(schema)).not.toContain("## Localization");
  });
});

describe("introspectSchema: extract BlocksFeature blocks from a Lexical richText field", () => {
  const calloutDef = {
    slug: "callout",
    labels: { singular: "Callout" },
    fields: [{ name: "heading", type: "text" }],
  };
  const mentionDef = { slug: "mention", fields: [{ name: "label", type: "text" }] };

  // The shape of the sanitized lexical adapter:
  // field.editor.editorConfig.resolvedFeatureMap.get('blocks').sanitizedServerFeatureProps.{blocks,inlineBlocks}
  const config = {
    blocks: [mentionDef],
    collections: [
      {
        slug: "posts",
        timestamps: true,
        fields: [
          {
            name: "content",
            type: "richText",
            editor: {
              editorConfig: {
                resolvedFeatureMap: new Map([
                  [
                    "blocks",
                    {
                      sanitizedServerFeatureProps: {
                        blocks: [calloutDef],
                        inlineBlocks: ["mention"],
                      },
                    },
                  ],
                ]),
              },
            },
          },
        ],
      },
    ],
    globals: [],
  } as any;

  const schema = introspectSchema(config);
  const content = schema.collections[0].fields.find((f) => f.name === "content")!;

  it("captures embedded block defs (slug + fields) from the editor config", () => {
    expect(content.blocks?.[0]).toMatchObject({ slug: "callout", label: "Callout" });
    expect(content.blocks?.[0].fields.map((f) => f.name)).toContain("heading");
  });
  it("resolves a slug-referenced inline block via config.blocks", () => {
    expect(content.inlineBlocks?.[0]).toMatchObject({ slug: "mention" });
    expect(content.inlineBlocks?.[0].fields.map((f) => f.name)).toContain("label");
  });
  it("leaves a plain richText field (no BlocksFeature) without blocks - and never throws", () => {
    const plain = introspectSchema({
      collections: [
        { slug: "x", timestamps: true, fields: [{ name: "body", type: "richText", editor: {} }] },
      ],
      globals: [],
      blocks: [],
    } as any);
    const body = plain.collections[0].fields[0];

    expect(body.type).toBe("richText");
    expect(body.blocks).toBeUndefined();
  });
});

describe("introspectSchema: universal-schema edge fields", () => {
  it("captures admin.readOnly and flags it in the rendered schema", () => {
    const schema = introspectSchema({
      collections: [
        {
          slug: "page",
          timestamps: true,
          fields: [{ name: "sanityId", type: "text", admin: { readOnly: true } }],
        },
      ],
      globals: [],
      blocks: [],
    } as any);
    const field = schema.collections[0].fields[0];

    expect(field.readOnly).toBe(true);
    expect(schemaContextToString(schema)).toContain("[readOnly - NEVER write this field]");
  });

  it("captures admin.condition and flags it in the rendered schema", () => {
    const schema = introspectSchema({
      collections: [
        {
          slug: "page",
          timestamps: true,
          fields: [{ name: "abVariant", type: "text", admin: { condition: () => true } }],
        },
      ],
      globals: [],
      blocks: [],
    } as any);
    const field = schema.collections[0].fields[0];

    expect(field.conditional).toBe(true);
    expect(schemaContextToString(schema)).toContain(
      "[conditional - may be hidden depending on other fields]"
    );
  });

  it("keeps a custom/unknown field type VISIBLE instead of silently dropping it", () => {
    const schema = introspectSchema({
      collections: [
        {
          slug: "page",
          timestamps: true,
          fields: [{ name: "weirdField", type: "sanityCustomWidget" }],
        },
      ],
      globals: [],
      blocks: [],
    } as any);
    const field = schema.collections[0].fields.find((f) => f.name === "weirdField");

    expect(field).toBeDefined();
    expect(field?.unsupported).toBe(true);
    expect(field?.type).toBe("sanityCustomWidget");
    expect(schemaContextToString(schema)).toContain(
      "[custom field type - not editable via agent tools]"
    );
  });

  it("drops a nameless unknown field (carries no data)", () => {
    const schema = introspectSchema({
      collections: [
        { slug: "page", timestamps: true, fields: [{ type: "sanityCustomWidget" } as any] },
      ],
      globals: [],
      blocks: [],
    } as any);

    expect(schema.collections[0].fields).toEqual([]);
  });

  it("flattens an unnamed layout-only group like row/collapsible", () => {
    const schema = introspectSchema({
      collections: [
        {
          slug: "page",
          timestamps: true,
          fields: [{ type: "group", fields: [{ name: "heading", type: "text" }] } as any],
        },
      ],
      globals: [],
      blocks: [],
    } as any);

    expect(schema.collections[0].fields.map((f) => f.name)).toEqual(["heading"]);
  });

  it("captures hasMany on upload fields", () => {
    const schema = introspectSchema({
      collections: [
        {
          slug: "gallery",
          timestamps: true,
          fields: [{ name: "images", type: "upload", relationTo: "media", hasMany: true }],
        },
      ],
      globals: [],
      blocks: [],
    } as any);

    expect(schema.collections[0].fields[0].hasMany).toBe(true);
  });
});

describe("introspector: a function-valued admin.hidden does not vanish the collection", () => {
  it("only a literal hidden:true excludes a collection; a role-conditional function stays visible", () => {
    const config: any = {
      collections: [
        { slug: "posts", timestamps: true, fields: [{ name: "title", type: "text" }] },
        {
          slug: "internal-notes",
          timestamps: true,
          admin: { hidden: () => true },
          fields: [{ name: "title", type: "text" }],
        },
        { slug: "payload-preferences", timestamps: true, admin: { hidden: true }, fields: [] },
      ],
      globals: [],
    };
    const schema = introspectSchema(config);
    const slugs = schema.collections.map((c) => c.slug);

    expect(slugs).toContain("posts");
    expect(slugs).toContain("internal-notes");
    expect(slugs).not.toContain("payload-preferences");
  });
});

describe("introspector: Payload 3 hoisted blocks (blockReferences)", () => {
  it("resolves slug references through config.blocks", () => {
    const config: any = {
      blocks: [
        { slug: "hero", labels: { singular: "Hero" }, fields: [{ name: "heading", type: "text" }] },
      ],
      collections: [
        {
          slug: "pages",
          timestamps: true,
          fields: [{ name: "layout", type: "blocks", blocks: [], blockReferences: ["hero"] }],
        },
      ],
      globals: [],
    };
    const schema = introspectSchema(config);
    const layout = schema.collections[0].fields.find((f) => f.name === "layout")!;

    expect(layout.blocks).toHaveLength(1);
    expect(layout.blocks![0].slug).toBe("hero");
    expect(layout.blocks![0].fields.map((f) => f.name)).toContain("heading");
  });
});

const innerBlock = (block: any, slug: string) =>
  block.fields.find((f: any) => f.name === "inner").blocks.find((b: any) => b.slug === slug);

describe("introspector: recursive hoisted blocks do not stack-overflow", () => {
  it("keeps the fields of one level of a block inside itself, and cuts the cycle below it", () => {
    const config: any = {
      blocks: [
        {
          slug: "columns",
          labels: { singular: "Columns" },
          fields: [
            { name: "heading", type: "text" },
            { name: "inner", type: "blocks", blocks: [], blockReferences: ["columns", "hero"] },
          ],
        },
        { slug: "hero", labels: { singular: "Hero" }, fields: [{ name: "title", type: "text" }] },
      ],
      collections: [
        {
          slug: "pages",
          timestamps: true,
          fields: [{ name: "layout", type: "blocks", blocks: [], blockReferences: ["columns"] }],
        },
      ],
      globals: [],
    };
    const schema = introspectSchema(config);
    const layout = schema.collections[0].fields.find((f) => f.name === "layout")!;
    const columns = layout.blocks!.find((b) => b.slug === "columns")!;

    expect(columns.fields.map((f) => f.name)).toContain("inner");
    const inner = columns.fields.find((f) => f.name === "inner")!;
    const innerColumns = inner.blocks!.find((b) => b.slug === "columns")!;

    expect(innerColumns.fields.map((f) => f.name)).toEqual(["heading", "inner"]);
    const deepest = innerColumns.fields
      .find((f) => f.name === "inner")!
      .blocks!.find((b) => b.slug === "columns")!;

    expect(deepest.fields).toEqual([]);
    const innerHero = inner.blocks!.find((b) => b.slug === "hero")!;

    expect(innerHero.fields.map((f) => f.name)).toContain("title");
  });

  it("cuts a cycle that goes through another block, and every repeat after the first", () => {
    const config: any = {
      blocks: ["a", "b"].map((slug) => ({
        slug,
        fields: [
          { name: "heading", type: "text" },
          { name: "inner", type: "blocks", blocks: [], blockReferences: ["a", "b"] },
        ],
      })),
      collections: [
        {
          slug: "pages",
          timestamps: true,
          fields: [{ name: "layout", type: "blocks", blocks: [], blockReferences: ["a", "b"] }],
        },
      ],
      globals: [],
    };
    const layout = introspectSchema(config).collections[0].fields[0];
    const a = layout.blocks!.find((b) => b.slug === "a")!;

    expect(innerBlock(innerBlock(a, "b"), "a").fields).toEqual([]);
    expect(innerBlock(a, "a").fields).not.toEqual([]);
    expect(innerBlock(innerBlock(a, "a"), "a").fields).toEqual([]);
    expect(innerBlock(innerBlock(innerBlock(a, "b"), "b"), "a").fields).toEqual([]);
  });
});

describe("renderSchemaForPrompt: compact mode + block dedup", () => {
  const manyBlocksSchema: SchemaContext = {
    globals: [],
    collections: [
      {
        slug: "pagesV1",
        fields: [
          {
            name: "blocks",
            type: "blocks",
            blocks: [
              { slug: "hero", label: "Hero", fields: [{ name: "heading", type: "text" }] },
              { slug: "shared", label: "Shared Section", fields: [{ name: "body", type: "text" }] },
            ],
          },
        ],
        hasVersions: true,
        hasDrafts: true,
        hasAuth: false,
        timestamps: true,
      },
      {
        slug: "pagesV2",
        fields: [
          {
            name: "blocks",
            type: "blocks",
            blocks: [
              { slug: "shared", label: "Shared Section", fields: [{ name: "body", type: "text" }] },
            ],
          },
        ],
        hasVersions: true,
        hasDrafts: true,
        hasAuth: false,
        timestamps: true,
      },
    ],
  };

  it('"full" mode dedups a block shared across collections - renders its fields once', () => {
    const { text, mode } = renderSchemaForPrompt(manyBlocksSchema, "full");

    expect(mode).toBe("full");
    expect(text).toContain("heading (text)");
    expect((text.match(/body \(text\)/gu) ?? []).length).toBe(1);
    expect(text).toContain("fields as defined at its first occurrence above");
  });

  it('"compact" mode lists blocks by slug only, no nested fields', () => {
    const { text, mode } = renderSchemaForPrompt(manyBlocksSchema, "compact");

    expect(mode).toBe("compact");
    expect(text).toContain("hero");
    expect(text).toContain("shared");
    expect(text).not.toContain("heading (text)");
    expect(text).not.toContain("body (text)");
  });

  it('"auto" mode stays full under the size threshold', () => {
    const { mode } = renderSchemaForPrompt(manyBlocksSchema, "auto");

    expect(mode).toBe("full");
  });

  it('"auto" mode switches to compact once the rendered schema is too large', () => {
    const bigBlocks = Array.from({ length: 120 }, (_, i) => ({
      slug: `block${i}`,
      label: `Block ${i}`,
      fields: Array.from({ length: 6 }, (_field, j) => ({
        name: `field${j}`,
        type: "text",
        description: "A fairly descriptive field to pad size",
      })),
    }));
    const big: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "pages",
          fields: [{ name: "blocks", type: "blocks", blocks: bigBlocks }],
          hasVersions: true,
          hasDrafts: true,
          hasAuth: false,
          timestamps: true,
        },
      ],
    };
    const { mode, text } = renderSchemaForPrompt(big, "auto");

    expect(mode).toBe("compact");
    expect(text).not.toContain("field0 (text)");
  });

  it("collectBlockDefs returns every distinct block once, reachable via getSchemaInfo", () => {
    const defs = collectBlockDefs(manyBlocksSchema);

    expect([...defs.keys()].sort()).toEqual(["hero", "shared"]);
    expect(defs.get("shared")).toHaveLength(1);
    expect(defs.get("shared")?.[0].block.fields.map((f) => f.name)).toEqual(["body"]);
  });
});
