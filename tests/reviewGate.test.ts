import { describe, it, expect, vi } from "vitest";
import { assessUpdateRisk, topLevelField } from "../src/agent/tools/review.js";
import { createTools } from "../src/agent/tools/index.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { wrapMcpTools } from "../src/agent/tools/mcp/wrapTools.js";
import { createTurnApprovals, decideApproval } from "../src/agent/approvals.js";
import { healEmptyRichTextDeep } from "../src/agent/content/schemaValues.js";
import type { SchemaContext, SchemaField } from "../src/types.js";
import { pluginOptions } from "./harness.js";

const fields: SchemaField[] = [
  { name: "title", type: "text" },
  { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
  { name: "content", type: "richText", editor: "lexical" },
  { name: "sanityId", type: "text", readOnly: true },
  { name: "widget", type: "sanityCustomWidget", unsupported: true },
  { name: "featured", type: "relationship", relationTo: ["posts", "pages"] },
  {
    name: "sections",
    type: "array",
    fields: [{ name: "body", type: "richText", editor: "lexical" }],
  },
];

const schema: SchemaContext = {
  globals: [],
  collections: [
    { slug: "posts", fields, hasVersions: true, hasDrafts: true, hasAuth: false, timestamps: true },
  ],
};

const para = (text: string) => ({
  type: "paragraph",
  version: 1,
  children: [{ type: "text", version: 1, text }],
});
const richText = (...texts: string[]) => ({
  root: { type: "root", version: 1, children: texts.map(para) },
});

const doc = () => ({
  id: "1",
  title: "A",
  tags: [1, 2, 3],
  content: richText("one", "two", "three"),
  sanityId: "abc",
});

describe("assessUpdateRisk: deterministic destructive-update detection", () => {
  it("flags nothing for a harmless scalar change", () => {
    expect(
      assessUpdateRisk(fields, doc(), { id: "1", title: "B", _status: "draft", draft: true })
    ).toEqual([]);
  });

  it("flags a read-only field as forbidden", () => {
    const risks = assessUpdateRisk(fields, doc(), { sanityId: "zzz" });

    expect(risks).toHaveLength(1);
    expect(risks[0]).toMatchObject({ field: "sanityId", kind: "forbidden" });
  });

  it("flags an unsupported custom-type field as forbidden", () => {
    const risks = assessUpdateRisk(fields, doc(), { widget: { any: "thing" } });

    expect(risks[0]).toMatchObject({ field: "widget", kind: "forbidden" });
  });

  it("flags array item removal (deep equality for id arrays)", () => {
    const risks = assessUpdateRisk(fields, doc(), { tags: [1, 3] });

    expect(risks[0]).toMatchObject({ field: "tags", kind: "reviewable" });
    expect(risks[0].reason).toContain("lose 1");
  });

  it("flags emptying an array", () => {
    const risks = assessUpdateRisk(fields, doc(), { tags: [] });

    expect(risks[0]).toMatchObject({ field: "tags", kind: "reviewable" });
  });

  it("does NOT flag adding array items (superset)", () => {
    expect(assessUpdateRisk(fields, doc(), { tags: [1, 2, 3, 4] })).toEqual([]);
  });

  it("detects removal by stable id for arrays of objects", () => {
    const before = {
      rows: [
        { id: "a", v: 1 },
        { id: "b", v: 2 },
      ],
    };
    const rowFields: SchemaField[] = [{ name: "rows", type: "array", fields: [] }];
    const risks = assessUpdateRisk(rowFields, before, { rows: [{ id: "a", v: 99 }] });

    expect(risks[0]).toMatchObject({ field: "rows", kind: "reviewable" });
    expect(
      assessUpdateRisk(rowFields, before, {
        rows: [
          { id: "a", v: 99 },
          { id: "b", v: 2 },
        ],
      })
    ).toEqual([]);
  });

  it("flags replacing rich text with a non-richText value", () => {
    const risks = assessUpdateRisk(fields, doc(), { content: "plain string" });

    expect(risks[0]).toMatchObject({ field: "content", kind: "reviewable" });
  });

  it("flags a >50% rich text node shrink, tolerates a small edit", () => {
    const shrunk = assessUpdateRisk(fields, doc(), { content: richText("one") });

    expect(shrunk[0]).toMatchObject({ field: "content", kind: "reviewable" });
    const smallEdit = assessUpdateRisk(fields, doc(), {
      content: richText("one", "two", "three edited"),
    });

    expect(smallEdit).toEqual([]);
  });

  it("flags clearing a populated single polymorphic relationship/upload ({relationTo, value})", () => {
    const risks = assessUpdateRisk(
      fields,
      { featured: { relationTo: "posts", value: 5 } },
      { featured: null }
    );

    expect(risks[0]).toMatchObject({ field: "featured", kind: "reviewable" });
    expect(
      assessUpdateRisk(
        fields,
        { featured: { relationTo: "posts", value: 5 } },
        { featured: { relationTo: "pages", value: 9 } }
      )
    ).toEqual([]);
  });

  it("does NOT misreport a non-relationship field as a cleared reference just because its value shape has a `value` key", () => {
    const jsonFields: SchemaField[] = [{ name: "config", type: "json" }];
    const risks = assessUpdateRisk(
      jsonFields,
      { config: { value: 42, unit: "kg" } },
      { config: null }
    );

    expect(risks.some((risk) => /references a document/u.test(risk.reason))).toBe(false);
  });

  it("asks before a json field that holds an object is cleared or emptied", () => {
    const jsonFields: SchemaField[] = [{ name: "specs", type: "json" }];
    const before = { specs: { weight: "2kg", size: "M" } };

    for (const specs of [null, {}])
      expect(assessUpdateRisk(jsonFields, before, { specs })).toMatchObject([
        { field: "specs", kind: "reviewable" },
      ]);
    expect(assessUpdateRisk(jsonFields, before, { specs: { weight: "3kg" } })).toEqual([]);
  });

  it("flags a row-level destructive edit inside an array field, reported as a nested path", () => {
    const before = { sections: [{ id: "a", body: richText("one", "two") }] };
    const risks = assessUpdateRisk(fields, before, { sections: [{ id: "a", body: null }] });

    expect(risks[0]).toMatchObject({ field: "sections[a].body", kind: "reviewable" });
  });
});

describe("assessUpdateRisk: removedArrayItems scalar/object identity", () => {
  const tagFields: SchemaField[] = [
    { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
  ];

  it("a pure append of scalar ids onto POPULATED before-objects is not reported as a removal", () => {
    const before = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    const risks = assessUpdateRisk(tagFields, { tags: before }, { tags: [1, 2, 3] });

    expect(risks).toEqual([]);
  });
  it("still flags a genuine removal in the same populated-vs-scalar shape", () => {
    const before = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    const risks = assessUpdateRisk(tagFields, { tags: before }, { tags: [1] });

    expect(risks[0]).toMatchObject({ field: "tags", kind: "reviewable" });
  });
});

describe("assessUpdateRisk: row-level destructive edits inside array/blocks fields", () => {
  const rowFields: SchemaField[] = [
    { name: "id", type: "text" },
    { name: "body", type: "richText", editor: "lexical" },
  ];
  const sectionFields: SchemaField[] = [{ name: "sections", type: "array", fields: rowFields }];

  it("does not flag an untouched row", () => {
    const document = { sections: [{ id: "a", body: richText("hello world") }] };
    const risks = assessUpdateRisk(sectionFields, document, { sections: document.sections });

    expect(risks).toEqual([]);
  });
});

const gateSchema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
        {
          name: "meta",
          type: "group",
          fields: [
            { name: "note", type: "text" },
            { name: "migrationId", type: "text", readOnly: true },
          ],
        },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

describe("assessUpdateRisk: nested group readOnly", () => {
  it("flags a readOnly subfield inside a group as forbidden, reported group.subfield", () => {
    const risks = assessUpdateRisk(
      gateSchema.collections[0].fields,
      { meta: { note: "x", migrationId: "orig" } },
      { meta: { migrationId: "llm-invented" } }
    );

    expect(
      risks.find((r) => r.field === "meta.migrationId" && r.kind === "forbidden")
    ).toBeTruthy();
  });
});

describe("healEmptyRichTextDeep", () => {
  it("injects an empty paragraph into an empty root, at any nesting depth", () => {
    const value = { sections: [{ id: "a", body: { root: { type: "root", children: [] } } }] };

    healEmptyRichTextDeep(value);
    expect(value.sections[0].body.root.children).toHaveLength(1);
  });

  it("does not throw on a pathologically deep LLM-controlled object (depth-bounded like containsBlocksArray)", () => {
    let deep: any = { root: { type: "root", children: [] } };

    for (let i = 0; i < 5000; i++) deep = { nested: deep };
    expect(() => healEmptyRichTextDeep(deep)).not.toThrow();
  });
});

describe("topLevelField", () => {
  it("strips a group-nested suffix", () => {
    expect(topLevelField("hero.body")).toBe("hero");
  });
  it("strips an array-row-nested suffix", () => {
    expect(topLevelField("sections[a].body")).toBe("sections");
  });
  it("leaves a plain top-level field name untouched", () => {
    expect(topLevelField("title")).toBe("title");
  });
});

function makeToolset(document = doc()) {
  const captured: { update?: any } = {};
  const mcpTools = {
    findPosts: {
      execute: vi.fn(async () => ({
        content: [{ text: `Resource from collection "posts":\n${JSON.stringify(document)}` }],
      })),
    },
    updatePosts: {
      execute: vi.fn(async (params: any) => {
        captured.update = params;

        return { content: [{ text: "Document updated successfully" }] };
      }),
    },
  };
  const approvals = createTurnApprovals();
  const tools: Record<string, any> = createTools(mcpTools, schema, pluginOptions(), { approvals });
  const ask = (input: unknown, toolCallId = "t") =>
    decideApproval(approvals, { toolName: "updateDocument", toolCallId, input });

  return { tools, captured, mcpTools, ask };
}

const opts = { toolCallId: "t", messages: [] } as any;
const update = (data: Record<string, unknown>) => ({ collection: "posts", id: "1", data });

describe("destructive-update gate (update wrapper)", () => {
  it("lets a harmless scalar update through with no review", async () => {
    const { tools, captured } = makeToolset();
    const res: any = await tools.updateDocument.execute(update({ title: "B" }), opts);

    expect(res.error).toBeUndefined();
    expect(captured.update).toMatchObject({ id: "1", title: "B" });
  });

  it("reviews a document with the id 0 like any other", async () => {
    const { tools, captured, ask } = makeToolset({ ...doc(), id: 0 } as any);
    const input = { collection: "posts", id: 0, data: { tags: [1, 3] } };
    const blocked: any = await tools.updateDocument.execute(input, opts);

    expect(blocked.error).toMatch(/DESTRUCTIVE/u);
    expect(captured.update).toBeUndefined();
    expect((await ask(input))?.type).toBe("user-approval");
  });

  it("asks the person what will be removed, and runs after the click", async () => {
    const { tools, captured, ask } = makeToolset();
    const asked = await ask(update({ tags: [1, 3] }));

    expect(asked?.type).toBe("user-approval");
    expect(JSON.parse(asked?.reason ?? "")).toMatchObject({
      kind: "risky-update",
      collection: "posts",
      document: { id: "1" },
      effects: ['"tags" loses 1 of its 3 items.'],
    });
    const allowed: any = await tools.updateDocument.execute(update({ tags: [1, 3] }), opts);

    expect(allowed.error).toBeUndefined();
    expect(captured.update).toMatchObject({ tags: [1, 3] });
  });

  it("one click covers one tool call: another call is refused", async () => {
    const { tools, captured, ask } = makeToolset();

    expect(await ask(update({ tags: [1] }), "first")).toBeDefined();
    const other: any = await tools.updateDocument.execute(update({ tags: [1] }), {
      toolCallId: "second",
      messages: [],
    } as any);

    expect(other.error).toMatch(/DESTRUCTIVE/u);
    expect(captured.update).toBeUndefined();
  });

  it("does not ask for a harmless update or for one that is refused anyway", async () => {
    const { ask } = makeToolset();

    expect(await ask(update({ title: "B" }))).toBeUndefined();
    expect(await ask(update({ sanityId: "zzz" }))).toBeUndefined();
  });

  it("read-only fields are refused unconditionally", async () => {
    const { tools, captured } = makeToolset();
    const res: any = await tools.updateDocument.execute(update({ sanityId: "zzz" }), opts);

    expect(res.error).toMatch(/read-only/u);
    expect(captured.update).toBeUndefined();
  });

  it("internal pipeline saves (ws-save) bypass the gate - they passed the sub-agent Reviewer", async () => {
    const { captured, mcpTools } = makeToolset();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { safeMcpTools }: any = wrapMcpTools(mcpTools as any, {
      schema,
      documentIo: () => createDocumentIO({ mcpTools: mcpTools as any, schema }),
      recordEdits: vi.fn(),
    });

    log.mockRestore();
    const gated: any = await safeMcpTools.updatePosts.execute({ id: "1", tags: [1, 3] }, opts);

    expect(gated.error).toMatch(/DESTRUCTIVE/u);
    expect(captured.update).toBeUndefined();
    const res: any = await safeMcpTools.updatePosts.execute({ id: "1", tags: [1, 3] }, {
      toolCallId: "ws-save",
      messages: [],
    } as any);

    expect(res.error).toBeUndefined();
    expect(captured.update).toMatchObject({ tags: [1, 3] });
  });

  it("a preview reports forbidden fields distinctly, reads the CURRENT draft and writes nothing", async () => {
    const { tools, mcpTools } = makeToolset();
    const review: any = await tools.updateDocument.execute(
      { ...update({ sanityId: "zzz", title: "B" }), preview: true },
      opts
    );

    expect(mcpTools.updatePosts.execute).not.toHaveBeenCalled();

    expect(review.forbiddenFields).toEqual(["sanityId"]);
    expect(review.fieldsChanged).toContain("title");
    expect(mcpTools.findPosts.execute).toHaveBeenCalledWith(
      expect.objectContaining({ draft: true }),
      expect.anything()
    );
  });

  it("a destructive field nested in an array row is asked about and runs after the click", async () => {
    const document = { ...doc(), sections: [{ id: "a", body: richText("one", "two") }] };
    const { tools, captured, ask } = makeToolset(document);
    const input = update({ sections: [{ id: "a", body: null }] });
    const blocked: any = await tools.updateDocument.execute(input, opts);

    expect(blocked.error).toMatch(/DESTRUCTIVE/u);
    expect(captured.update).toBeUndefined();
    const asked = await ask(input);

    expect(JSON.parse(asked?.reason ?? "").effects).toEqual([
      '"body" has text now. The update removes all of it.',
    ]);
    const allowed: any = await tools.updateDocument.execute(input, opts);

    expect(allowed.error).toBeUndefined();
    expect(captured.update.sections[0].id).toBe("a");
  });

  it("self-heals an empty Lexical root in an array row of a direct update, instead of persisting a value that crashes the admin editor on load", async () => {
    const document = { ...doc(), sections: [] };
    const { tools, captured, ask } = makeToolset(document);
    const input = update({
      sections: [{ id: "a", body: { root: { type: "root", children: [] } } }],
    });

    await ask(input);

    const res: any = await tools.updateDocument.execute(input, opts);

    expect(res.error).toBeUndefined();
    expect(captured.update.sections[0].body.root.children).toHaveLength(1);
    expect(captured.update.sections[0].body.root.children[0].type).toBe("paragraph");
  });
});

describe("updateDocument({ preview: true }) - diff/warnings COUNT cap", () => {
  it("caps the number of warnings when an array field has many risky rows (one warning per row, uncapped otherwise)", async () => {
    const manyRowsFields: SchemaField[] = [
      {
        name: "items",
        type: "array",
        fields: [{ name: "body", type: "richText", editor: "lexical" }],
      },
    ];
    const manySchema: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "posts",
          fields: manyRowsFields,
          hasVersions: true,
          hasDrafts: true,
          hasAuth: false,
          timestamps: true,
        },
      ],
    };
    const rowCount = 60;
    const before = {
      id: "1",
      items: Array.from({ length: rowCount }, (_, i) => ({
        id: `r${i}`,
        body: richText("one", "two"),
      })),
    };
    const proposed = { items: before.items.map((r: any) => ({ id: r.id, body: null })) };
    const mcpTools = {
      findPosts: {
        execute: vi.fn(async () => ({
          content: [{ text: `Resource from collection "posts":\n${JSON.stringify(before)}` }],
        })),
      },
      updatePosts: { execute: vi.fn() },
    };
    const tools: Record<string, any> = createTools(mcpTools, manySchema, pluginOptions());
    const r: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: proposed, preview: true },
      opts
    );

    expect(r.warnings.length).toBeLessThanOrEqual(50);
    expect(r.warningsTruncated).toBe(true);
    expect(r.warningsTruncatedNote).toMatch(new RegExp(`50 of ${rowCount}`, "u"));
  });

  it("caps the number of diff entries when a preview touches many top-level fields", async () => {
    const wideFields: SchemaField[] = Array.from({ length: 150 }, (_, i) => ({
      name: `field${i}`,
      type: "text",
    }));
    const wideSchema: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "posts",
          fields: wideFields,
          hasVersions: true,
          hasDrafts: true,
          hasAuth: false,
          timestamps: true,
        },
      ],
    };
    const before: Record<string, any> = { id: "1" };
    const proposed: Record<string, any> = {};

    for (let i = 0; i < 150; i++) {
      before[`field${i}`] = `old${i}`;
      proposed[`field${i}`] = `new${i}`;
    }

    const mcpTools = {
      findPosts: {
        execute: vi.fn(async () => ({
          content: [{ text: `Resource from collection "posts":\n${JSON.stringify(before)}` }],
        })),
      },
      updatePosts: { execute: vi.fn() },
    };
    const tools: Record<string, any> = createTools(mcpTools, wideSchema, pluginOptions());
    const r: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: proposed, preview: true },
      opts
    );

    expect(Object.keys(r.diff).length).toBeLessThanOrEqual(100);
    expect(r.diffTruncated).toBe(true);
    expect(r.fieldsChanged).toHaveLength(150);
  });
});

const stored = (output: unknown) => (typeof output === "string" ? output : JSON.stringify(output));

describe("agent-facing MCP output capping (find/create/update)", () => {
  it("caps the returned/stored output of a large find response, without truncating DocumentIO’s own internal reads", async () => {
    const bigDoc = { ...doc(), bigField: "x".repeat(60_000) };
    const { tools, mcpTools } = makeToolset(bigDoc);

    const listed: any = await tools.listDocuments.execute({ collection: "posts", limit: 1 }, opts);

    expect(stored(listed).length).toBeLessThan(60_000);
    expect(stored(listed)).toContain("truncated");
    const read: any = await tools.readDocument.execute({ collection: "posts", id: "1" }, opts);

    expect(stored(read).length).toBeLessThan(60_000);
    expect(stored(read)).toContain("truncated");

    const review: any = await tools.updateDocument.execute(
      { ...update({ title: "B" }), preview: true },
      opts
    );

    expect(mcpTools.findPosts.execute).toHaveBeenCalled();
    expect(review.error).toBeUndefined();
    expect(review.fieldsChanged).toContain("title");
  });

  it("caps the returned/stored output of an update whose response holds a large document", async () => {
    const bigDoc = { ...doc(), bigField: "x".repeat(60_000) };
    const { tools, mcpTools } = makeToolset(bigDoc);

    mcpTools.updatePosts.execute = vi.fn(async () => ({
      content: [
        { text: `Document updated successfully\n${JSON.stringify({ ...bigDoc, title: "B" })}` },
      ],
    }));
    const res: any = await tools.updateDocument.execute(update({ title: "B" }), opts);

    expect(res.error).toBeUndefined();
    expect(mcpTools.updatePosts.execute).toHaveBeenCalledOnce();
    expect(stored(res).length).toBeLessThan(60_000);
    expect(stored(res)).toContain("truncated");
  });
});
