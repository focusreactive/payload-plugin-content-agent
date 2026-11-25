import { describe, it, expect, vi } from "vitest";

let agentScript: (t: any, ctx: any) => Promise<string> = async () => "noop";

vi.mock("ai", () => {
  class MockToolLoopAgent {
    config: any;
    constructor(config: any) {
      this.config = config;
    }
    async generate() {
      const ctx = { toolCallId: "t", messages: [] };
      const text = await agentScript(this.config.tools, ctx);

      return { text };
    }
  }

  return {
    ToolLoopAgent: MockToolLoopAgent,
    isStepCount: (_n: number) => () => false,
    hasToolCall: () => () => false,
    jsonSchema: (schema: any) => ({ jsonSchema: schema }),
    tool: (cfg: any) => ({
      description: cfg.description,
      inputSchema: cfg.inputSchema,
      execute: cfg.execute,
    }),
    generateText: vi.fn().mockResolvedValue({ output: { approved: true, reason: "ok" } }),
    Output: { object: ({ schema }: any) => schema },
  };
});

import { createBlockTools, previewRefValue } from "../src/agent/content/blockTools.js";
import type { DocumentWorkspace } from "../src/agent/content/blockTools.js";
import { documentOutline } from "../src/agent/content/outline.js";
import { createContentEditorTools } from "../src/agent/content/contentEditor.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { createIoReadTools } from "../src/agent/tools/index.js";
import type { DocumentIO } from "../src/agent/content/documentIo.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const projectSlider = {
  slug: "projectSlider",
  fields: [
    { name: "title", type: "text" },
    { name: "projects", type: "relationship", relationTo: "projects", hasMany: true },
  ] as SchemaField[],
};
const testimonialSlider = {
  slug: "testimonialSlider",
  fields: [
    { name: "title", type: "text" },
    { name: "testimonials", type: "relationship", relationTo: "testimonials", hasMany: true },
  ] as SchemaField[],
};
const heroBlock = {
  slug: "hero",
  fields: [
    { name: "heading", type: "text" },
    { name: "image", type: "upload", relationTo: "media" },
  ] as SchemaField[],
};

const pageFields: SchemaField[] = [
  { name: "title", type: "text" },
  { name: "layout", type: "blocks", blocks: [heroBlock, projectSlider, testimonialSlider] },
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
      slug: "projects",
      fields: [{ name: "title", type: "text" }] as SchemaField[],
      hasVersions: false,
      hasDrafts: false,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "testimonials",
      fields: [{ name: "title", type: "text" }] as SchemaField[],
      hasVersions: false,
      hasDrafts: false,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const targetDoc = () => ({
  id: "145",
  title: "Sitecore to Storyblok",
  layout: [
    { id: "blk-hero", blockType: "hero", heading: "Migrate", image: 42 },
    {
      id: "blk-prj",
      blockType: "projectSlider",
      title: "Case studies",
      projects: [30, 29, 28, 27],
    },
    {
      id: "blk-tst",
      blockType: "testimonialSlider",
      title: "Testimonials",
      testimonials: [27, 26, 25],
    },
  ],
});

const opts = { toolCallId: "t", messages: [] } as any;

const rel = (extra: Partial<SchemaField> = {}): SchemaField => ({
  name: "projects",
  type: "relationship",
  relationTo: "projects",
  ...extra,
});

describe("previewRefValue", () => {
  it("renders a hasMany array as the actual ids, named by relationTo", () => {
    expect(previewRefValue(rel(), [30, 29, 28, 27])).toBe("→ projects [30, 29, 28, 27]");
  });

  it("renders a single reference and an upload id", () => {
    expect(previewRefValue(rel(), 30)).toBe("→ projects 30");
    expect(previewRefValue({ name: "image", type: "upload", relationTo: "media" }, 42)).toBe(
      "→ media 42"
    );
    expect(previewRefValue(rel(), "mongo-abc")).toBe("→ projects mongo-abc");
  });

  it("renders polymorphic and populated shapes by their ids", () => {
    const poly: SchemaField = { name: "ref", type: "relationship", relationTo: ["posts", "pages"] };

    expect(previewRefValue(poly, { relationTo: "posts", value: 7 })).toBe("→ posts:7");
    expect(
      previewRefValue(poly, [
        { relationTo: "posts", value: 7 },
        { relationTo: "pages", value: 3 },
      ])
    ).toBe("→ [posts:7, pages:3]");
    expect(previewRefValue(rel(), { id: 9, title: "populated" })).toBe("→ projects 9");
  });

  it("elides past 20 ids instead of flooding the outline", () => {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    const out = previewRefValue(rel(), ids)!;

    expect(out).toContain("20");
    expect(out).not.toContain("21");
    expect(out).toContain("… +5 more");
  });

  it("returns null for empty/non-reference values so callers fall back", () => {
    expect(previewRefValue(rel(), [])).toBeNull();
    expect(previewRefValue(rel(), null)).toBeNull();
    expect(previewRefValue({ name: "title", type: "text" }, "hello")).toBeNull();
  });
});

describe("documentOutline shows the referenced document ids", () => {
  it('renders relationship arrays and upload ids, not "[N items]"', () => {
    const out = documentOutline(pageFields, targetDoc()).join("\n");

    expect(out).toContain("projects: → projects [30, 29, 28, 27]");
    expect(out).toContain("testimonials: → testimonials [27, 26, 25]");
    expect(out).toContain("image: → media 42");
    expect(out).not.toContain("[4 items]");
  });

  it("shows the name a block carries in the admin", () => {
    const doc: any = targetDoc();
    const blocksField = pageFields.find((field) => field.type === "blocks")!;

    doc[blocksField.name][0].blockName = "Above the fold";
    const out = documentOutline(pageFields, doc).join("\n");

    expect(out).toContain('blockName "Above the fold"');
    expect(documentOutline(pageFields, targetDoc()).join("\n")).not.toContain("blockName");
  });

  it("never lets the per-block field cap hide a reference field", () => {
    const heavySlider = {
      slug: "heavySlider",
      fields: [
        ...["title", "subtitle", "description", "buttonText", "buttonUrl", "anchor", "eyebrow"].map(
          (name) => ({ name, type: "text" }) as SchemaField
        ),
        {
          name: "projects",
          type: "relationship",
          relationTo: "projects",
          hasMany: true,
        } as SchemaField,
      ],
    };
    const fields: SchemaField[] = [{ name: "layout", type: "blocks", blocks: [heavySlider] }];
    const doc = {
      layout: [
        {
          id: "b1",
          blockType: "heavySlider",
          title: "T",
          subtitle: "S",
          description: "D",
          buttonText: "B",
          buttonUrl: "/u",
          anchor: "a",
          eyebrow: "E",
          projects: [3, 2, 5, 8],
        },
      ],
    };
    const out = documentOutline(fields, doc).join("\n");

    expect(out).toContain("projects: → projects [3, 2, 5, 8]");
  });

  it("shows a reference field living OUTSIDE any block (document root / group)", () => {
    const fields: SchemaField[] = [
      { name: "relatedArticles", type: "relationship", relationTo: "posts", hasMany: true },
      {
        name: "seo",
        type: "group",
        fields: [{ name: "ogImage", type: "upload", relationTo: "media" }],
      },
    ];
    const out = documentOutline(fields, { relatedArticles: [11, 12], seo: { ogImage: 7 } }).join(
      "\n"
    );

    expect(out).toContain("relatedArticles: → posts [11, 12]");
    expect(out).toContain("ogImage: → media 7");
  });
});

describe("getEditableContent shows the referenced document ids", () => {
  it("lists a slider block's reference fields with their actual ids, writable via setValues", async () => {
    const workspace: DocumentWorkspace = { ref: { current: targetDoc() }, collection: "pages" };
    const tools = createBlockTools(workspace, schema);
    const res: any = await tools.getEditableContent.execute!({}, opts);
    const by = (ref: string) => res.fields.find((f: any) => f.ref === ref);

    expect(by("layout[blk-prj].projects")).toMatchObject({
      type: "relationship",
      editWith: "setValues",
      value: [30, 29, 28, 27],
    });
    expect(by("layout[blk-tst].testimonials")).toMatchObject({
      type: "relationship",
      editWith: "setValues",
      value: [27, 26, 25],
    });
  });
});

describe("documentOutline makes sections addressable", () => {
  it("shows each block's stable id in brackets", () => {
    const out = documentOutline(pageFields, targetDoc()).join("\n");

    expect(out).toContain("1. hero [blk-hero]");
    expect(out).toContain("2. projectSlider [blk-prj]");
  });
});

describe("readDocument({ path }) - one section, raw", () => {
  const articlesBlock = {
    slug: "relatedArticles",
    fields: [
      { name: "title", type: "text" },
      {
        name: "articles",
        type: "array",
        fields: [
          { name: "title", type: "text" },
          { name: "link", type: "text" },
          { name: "image", type: "upload", relationTo: "media" },
        ],
      },
    ] as SchemaField[],
  };
  const srcSchema: SchemaContext = {
    globals: [],
    collections: [
      {
        slug: "pages",
        fields: [
          { name: "title", type: "text" },
          { name: "layout", type: "blocks", blocks: [articlesBlock] },
        ] as SchemaField[],
        hasVersions: true,
        hasDrafts: true,
        hasAuth: false,
        timestamps: true,
      },
    ],
  };
  const sourcePage = {
    id: "49",
    title: "Framer to Storyblok",
    layout: [
      {
        id: "blk-art",
        blockType: "relatedArticles",
        title: "Related articles",
        articles: [
          { id: "row-1", title: "Framer CMS review", link: "/framer-cms", image: 15 },
          { id: "row-2", title: "Storyblok setup", link: "/storyblok-setup", image: 16 },
        ],
      },
    ],
  };
  const fakeIo = (doc: any = sourcePage): DocumentIO =>
    ({
      transports: () => ({ read: "local", write: "local", create: "local" }),
      read: vi.fn(async () => ({ doc })),
      write: vi.fn(async () => ({})),
      create: vi.fn(async () => ({ doc: {} })),
      list: vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 })),
    }) as unknown as DocumentIO;

  it("returns the raw rows of a plain-array section inside a block, media ids included", async () => {
    const res: any = await createIoReadTools(fakeIo(), srcSchema).readDocument.execute!(
      { collection: "pages", id: "49", path: "layout[blk-art].articles" },
      opts
    );

    expect(res.fieldType).toBe("array");
    expect(res.value).toHaveLength(2);
    expect(res.value[0]).toMatchObject({
      title: "Framer CMS review",
      link: "/framer-cms",
      image: 15,
    });
  });

  it("rejects an unresolvable path with a pointer to the outline view", async () => {
    const res: any = await createIoReadTools(fakeIo(), srcSchema).readDocument.execute!(
      { collection: "pages", id: "49", path: "layout[2].articles" },
      opts
    );

    expect(res.error).toContain('readDocument({ collection: "pages", id: "49", view: "outline" })');
  });

  it("validates its inputs like the outline tool does", async () => {
    const t = createIoReadTools(fakeIo(), srcSchema).readDocument;

    expect(((await t.execute!({ path: "layout" } as any, opts)) as any).error).toMatch(
      /exactly ONE/u
    );
    expect(
      ((await t.execute!({ collection: "pages", path: "layout" } as any, opts)) as any).error
    ).toMatch(/`id` is required/u);
    expect(
      ((await t.execute!({ collection: "nope", id: "1", path: "layout" } as any, opts)) as any)
        .error
    ).toMatch(/Unknown/u);
  });
});

function makeMcp(doc: any, captured: { update?: any } = {}) {
  return {
    findpages: {
      execute: vi
        .fn()
        .mockResolvedValue({ content: [{ text: `Resource:\n${JSON.stringify(doc)}` }] }),
    },
    updatepages: {
      execute: vi.fn(async (args: any) => {
        captured.update = args;

        return { content: [{ text: "{}" }] };
      }),
    },
  };
}

const toolsFor = (doc: any, captured: { update?: any } = {}) =>
  createContentEditorTools({
    io: createDocumentIO({ mcpTools: makeMcp(doc, captured), schema }),
    schema,
    model: {} as any,
    concurrency: 5,
  });

describe("the outline the Reviewer judges carries the reference ids", () => {
  it("a prose-only edit leaves identical id lines in Before and After - the reviewer can SEE nothing was replaced", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockClear();
    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });

    agentScript = async (t, ctx) => {
      await t.setValues.execute(
        { edits: [{ ref: "layout[blk-prj].title", value: "Framer case studies" }] },
        ctx
      );

      return "updated the slider title";
    };

    await toolsFor(targetDoc()).editContent.execute!(
      {
        collection: "pages",
        id: "145",
        instruction: "replace the case studies with the ones from the framer page",
      },
      opts
    );
    const prompt = vi.mocked(ai.generateText as any).mock.calls[0][0].messages[0].content as string;
    const idLine = "layout[blk-prj].projects: → projects [30, 29, 28, 27]";
    const beforeSide = prompt.slice(prompt.indexOf("Before:"), prompt.indexOf("After:"));
    const afterSide = prompt.slice(prompt.indexOf("After:"));

    expect(beforeSide).toContain(idLine);
    expect(afterSide).toContain(idLine);
  });

  it("an actual replacement shows the NEW ids in After and persists them", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockClear();
    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });

    agentScript = async (t, ctx) => {
      await t.setValues.execute(
        {
          edits: [
            { ref: "layout[blk-prj].projects", value: [3, 2, 5, 8] },
            { ref: "layout[blk-tst].testimonials", value: [19, 16, 11, 6] },
          ],
        },
        ctx
      );

      return "replaced the references with the ids from the task";
    };

    const captured: { update?: any } = {};
    const r: any = await toolsFor(targetDoc(), captured).editContent.execute!(
      {
        collection: "pages",
        id: "145",
        instruction:
          "in the projectSlider set projects to [3, 2, 5, 8]; in the testimonialSlider set testimonials to [19, 16, 11, 6]",
      },
      opts
    );

    expect(r.status).toBe("done");
    const prompt = vi.mocked(ai.generateText as any).mock.calls[0][0].messages[0].content as string;
    const afterSide = prompt.slice(prompt.indexOf("After:"));

    expect(afterSide).toContain("layout[blk-prj].projects: → projects [3, 2, 5, 8]");
    expect(afterSide).toContain("layout[blk-tst].testimonials: → testimonials [19, 16, 11, 6]");
    expect(captured.update.layout.find((b: any) => b.id === "blk-prj").projects).toEqual([
      3, 2, 5, 8,
    ]);
    expect(captured.update.layout.find((b: any) => b.id === "blk-tst").testimonials).toEqual([
      19, 16, 11, 6,
    ]);
  });
});
