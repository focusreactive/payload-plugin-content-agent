import { describe, it, expect, vi, beforeAll } from "vitest";
import { sanitizeConfig } from "payload";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { withContentAgent } from "../src/mcpLayer/index.js";

const paragraph = (text: string) => ({
  type: "paragraph",
  version: 1,
  direction: "ltr",
  format: "",
  indent: 0,
  children: [{ type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" }],
});

const richText = (...texts: string[]) => ({
  root: {
    type: "root",
    version: 1,
    direction: "ltr",
    format: "",
    indent: 0,
    children: texts.map(paragraph),
  },
});

const hero = {
  slug: "hero",
  fields: [
    { name: "heading", type: "text" },
    { name: "body", type: "richText" },
    { name: "items", type: "array", fields: [{ name: "label", type: "text" }] },
  ],
};

const collections = [
  {
    slug: "pages",
    timestamps: true,
    versions: { drafts: true },
    fields: [
      { name: "title", type: "text", required: true },
      { name: "summary", type: "textarea" },
      { name: "content", type: "richText" },
      { name: "layout", type: "blocks", blocks: [hero] },
      { name: "tags", type: "array", fields: [{ name: "label", type: "text" }] },
      { name: "related", type: "relationship", relationTo: "orders", hasMany: true },
    ],
  },
  { slug: "orders", timestamps: true, fields: [{ name: "total", type: "number" }] },
];

const stored = () => ({
  id: 1,
  title: "Home",
  summary: "A page about cats and cats",
  content: richText("The first paragraph about cats.", "The second paragraph about dogs."),
  layout: [
    { id: "b1", blockType: "hero", heading: "Welcome", items: [{ id: "r1", label: "one" }] },
    { id: "b2", blockType: "hero", heading: "Second", items: [{ id: "r2", label: "two" }] },
  ],
  tags: [{ id: "a", label: "one" }],
  related: [2, 3],
  _status: "draft",
});

const all = { find: true, create: true, update: true };

let config: unknown;

beforeAll(async () => {
  config = await sanitizeConfig({
    secret: "x",
    db: { defaultIDType: "number", init: () => ({}) },
    editor: lexicalEditor({}),
    collections,
  } as any);
});

function request() {
  const payload = {
    config,
    find: vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 })),
    findByID: vi.fn(async ({ id }: any) => ({ ...stored(), id })),
    update: vi.fn(async ({ id, data }: any) => ({ ...stored(), id, ...data })),
  };

  return { payload, user: { id: 7 } } as any;
}

async function edit(
  operations: Array<Record<string, unknown>>,
  {
    args = {},
    flags = { pages: all, orders: all },
  }: { args?: Record<string, unknown>; flags?: Record<string, unknown> } = {}
) {
  const req = request();
  const wrapped = withContentAgent({
    collections: { pages: { enabled: true }, orders: { enabled: true } },
  }) as any;

  await wrapped.overrideAuth(req, async () => ({
    id: 3,
    label: "Outside",
    user: { id: 7 },
    ...flags,
  }));
  const tool = wrapped.mcp.tools.find((candidate: any) => candidate.name === "editDocument");
  const result = await tool.handler({ collection: "pages", id: 1, operations, ...args }, req, {});
  const data = req.payload.update.mock.calls[0]?.[0]?.data;

  return { req, data, out: JSON.parse(result.content[0].text) };
}

const textsOf = (value: any): string[] =>
  value.root.children.map((node: any) =>
    (node.children ?? []).map((child: any) => child.text ?? "").join("")
  );

describe("the MCP layer: editDocument", () => {
  it("sets a field of one array row and saves a draft", async () => {
    const { req, data, out } = await edit([{ type: "set", ref: "tags[a].label", value: "two" }]);

    expect(out).toMatchObject({ status: "saved", collection: "pages", id: 1, savedAs: "draft" });
    expect(out.changes.length).toBeGreaterThan(0);
    expect(data).toMatchObject({ tags: [{ id: "a", label: "two" }] });
    expect(req.payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ draft: true, overrideAccess: false, user: { id: 7 } })
    );
  });

  it("writes nothing when one operation fails, and names it", async () => {
    const { req, out } = await edit([
      { type: "set", ref: "title", value: "New" },
      { type: "set", ref: "nope", value: "x" },
    ]);

    expect(out.error).toContain("Operation 2 of 2 (set)");
    expect(out.error).toContain("Nothing was written");
    expect(req.payload.update).not.toHaveBeenCalled();
  });

  it("names the valid types for an unknown operation and the wrong input of a known one", async () => {
    const unknown = await edit([{ type: "removeItem", path: "layout", id: "b1" }]);

    expect(unknown.out.error).toContain("insertItem");
    expect(unknown.out.error).toContain("replacePart");
    const wrong = await edit([{ type: "moveItem", path: "layout", id: "b1" }]);

    expect(wrong.out.error).toContain("`toIndex`");
    expect(wrong.req.payload.update).not.toHaveBeenCalled();
  });

  it("adds entries to a list with many values and keeps every entry it holds", async () => {
    const { data, out } = await edit([{ type: "set", ref: "related", add: [4, 2] }]);

    expect(out).toMatchObject({ status: "saved" });
    expect(data.related).toEqual([2, 3, 4]);
  });

  it("refuses a set with neither `value` nor `add`, or with both", async () => {
    const neither = await edit([{ type: "set", ref: "related" }]);
    const both = await edit([{ type: "set", ref: "related", value: [4], add: [4] }]);

    for (const { out, req } of [neither, both]) {
      expect(out.error).toContain('Send either `value` with the new value of "related", or `add`');
      expect(req.payload.update).not.toHaveBeenCalled();
    }
  });

  it("sends a rich text field to the rich text operations", async () => {
    const { out } = await edit([{ type: "set", ref: "content", value: "text" }]);

    expect(out.error).toContain("replaceText, insertText or replacePart");
  });

  it("replaces a string that occurs once in a rich text field", async () => {
    const { data, out } = await edit([
      { type: "replaceText", ref: "content", find: "about dogs", replace: "about birds" },
    ]);

    expect(out.error).toBeUndefined();
    expect(out.status).toBe("saved");
    expect(textsOf(data.content)).toEqual([
      "The first paragraph about cats.",
      "The second paragraph about birds.",
    ]);
  });

  it("refuses a string that occurs twice unless all is set", async () => {
    const twice = await edit([
      { type: "replaceText", ref: "summary", find: "cats", replace: "dogs" },
    ]);

    expect(twice.out.error).toContain("occurs 2 times");
    expect(twice.req.payload.update).not.toHaveBeenCalled();
    const every = await edit([
      { type: "replaceText", ref: "summary", find: "cats", replace: "dogs", all: true },
    ]);

    expect(every.data).toMatchObject({ summary: "A page about dogs and dogs" });
  });

  it("reports a string that the field does not hold", async () => {
    const { out } = await edit([
      { type: "replaceText", ref: "content", find: "birds", replace: "x" },
    ]);

    expect(out.error).toContain("does not hold");
  });

  it("points a plain text field that misses the string at set, not at replacePart", async () => {
    const { out } = await edit([
      { type: "replaceText", ref: "summary", find: "birds", replace: "x" },
    ]);

    expect(out.error).toContain("does not hold");
    expect(out.error).toContain("the operation set");
    expect(out.error).not.toContain("replacePart");
  });

  it("inserts Markdown after the part that holds a fragment", async () => {
    const { data, out } = await edit([
      { type: "insertText", ref: "content", markdown: "A new paragraph.", after: "about cats" },
    ]);

    expect(out.error).toBeUndefined();
    expect(out.status).toBe("saved");
    expect(textsOf(data.content)).toEqual([
      "The first paragraph about cats.",
      "A new paragraph.",
      "The second paragraph about dogs.",
    ]);
  });

  it("inserts at the start and at the end", async () => {
    const { data } = await edit([
      { type: "insertText", ref: "content", markdown: "Top.", at: "start" },
      { type: "insertText", ref: "content", markdown: "Bottom." },
    ]);
    const texts = textsOf(data.content);

    expect(texts[0]).toBe("Top.");
    expect(texts.at(-1)).toBe("Bottom.");
    expect(texts).toHaveLength(4);
  });

  it("refuses a fragment that two parts hold", async () => {
    const { out } = await edit([
      { type: "insertText", ref: "content", markdown: "New.", after: "paragraph about" },
    ]);

    expect(out.error).toContain("is in 2 parts");
  });

  it("replaces one whole part", async () => {
    const { data } = await edit([
      {
        type: "replacePart",
        ref: "content",
        match: "about dogs",
        markdown: "The second paragraph, now about birds.",
      },
    ]);

    expect(textsOf(data.content)[1]).toBe("The second paragraph, now about birds.");
  });

  it("adds a block with its rows and its rich text in one operation", async () => {
    const { data, out } = await edit([
      {
        type: "insertItem",
        path: "layout",
        blockType: "hero",
        afterId: "b1",
        fields: { heading: "Third", body: "Body text.", items: [{ label: "x" }] },
      },
    ]);

    expect(out.error).toBeUndefined();
    expect(out.status).toBe("saved");
    expect(data.layout.map((block: any) => block.heading)).toEqual(["Welcome", "Third", "Second"]);
    expect(data.layout[1]).toMatchObject({ blockType: "hero", items: [{ label: "x" }] });
    expect(textsOf(data.layout[1].body)).toEqual(["Body text."]);
    expect(data.layout[1].id).toBeUndefined();
  });

  it("refuses a new block that is an empty shell", async () => {
    const { req, out } = await edit([
      { type: "insertItem", path: "layout", blockType: "hero", fields: { heading: "Empty" } },
    ]);

    expect(out.error).toContain("empty shells");
    expect(req.payload.update).not.toHaveBeenCalled();
  });

  it("moves a block", async () => {
    const { data } = await edit([{ type: "moveItem", path: "layout", id: "b2", toIndex: 0 }]);

    expect(data.layout.map((block: any) => block.id)).toEqual(["b2", "b1"]);
  });

  it("refuses an edit that empties a field and sends the person to the admin", async () => {
    const { req, out } = await edit([{ type: "set", ref: "summary", value: "" }]);

    expect(out.error).toContain("would be emptied");
    expect(out.error).not.toMatch(/endpoint/iu);
    expect(out.error).toContain("admin panel");
    expect(req.payload.update).not.toHaveBeenCalled();
  });

  it("writes nothing on a preview", async () => {
    const { req, out } = await edit([{ type: "set", ref: "title", value: "New" }], {
      args: { preview: true },
    });

    expect(out).toMatchObject({ preview: true, written: false });
    expect(out.changes.length).toBeGreaterThan(0);
    expect(req.payload.update).not.toHaveBeenCalled();
  });

  it("reports an unchanged document and saves nothing", async () => {
    const { req, out } = await edit([{ type: "set", ref: "title", value: "Home" }]);

    expect(out.status).toBe("unchanged");
    expect(req.payload.update).not.toHaveBeenCalled();
  });

  it("refuses a key without the update permission and a collection without drafts", async () => {
    const noFlag = await edit([{ type: "set", ref: "title", value: "New" }], {
      flags: { pages: { find: true } },
    });

    expect(noFlag.out.error).toContain("cannot update");
    const noDrafts = await edit([{ type: "set", ref: "total", value: 2 }], {
      args: { collection: "orders" },
    });

    expect(noDrafts.out.error).toContain("has no drafts");
    expect(noDrafts.out.error).toMatch(/content agent tool/u);
    expect(noDrafts.out.error).not.toMatch(/endpoint|every one of them|another write tool/iu);
  });
});
