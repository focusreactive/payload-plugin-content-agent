import { afterEach, describe, expect, it, vi } from "vitest";
import { createTurnApprovals, decideApproval } from "../src/agent/approvals.js";
import { storedLengthsNote } from "../src/agent/tools/documents/updateDocument.js";
import { createTools } from "../src/agent/tools/index.js";
import type { SchemaContext } from "../src/types.js";
import { pluginOptions } from "./harness.js";

afterEach(() => vi.restoreAllMocks());

const schema: SchemaContext = {
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
        { name: "layout", type: "blocks", blocks: [{ slug: "hero", fields: [] }] },
        { name: "content", type: "richText", editor: "lexical" },
      ],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "tags",
      fields: [{ name: "label", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
  globals: [
    {
      slug: "site-settings",
      fields: [{ name: "tagline", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
    },
    {
      slug: "footer",
      fields: [{ name: "note", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
    },
  ],
};

const post = { id: "1", title: "A", tags: [1, 2, 3] };
const settings = { id: "site-settings", tagline: "Old" };
const resource = (doc: unknown) => ({
  content: [{ text: `Resource:\n${JSON.stringify(doc)}` }],
});
const updated = (doc: unknown) => ({
  content: [{ text: `Document updated successfully\n${JSON.stringify(doc)}` }],
});

// The site gives update tools for "posts" and "site-settings" only:
// "tags" and "footer" are in the schema with no update tool.
function makeToolset() {
  const mcpTools = {
    findPosts: { execute: vi.fn(async (_params: any, _options: any) => resource(post)) },
    updatePosts: {
      execute: vi.fn(async (params: any, _options: any) => updated({ ...post, ...params })),
    },
    updateSiteSettings: {
      execute: vi.fn(async (params: any, _options: any) => updated({ ...settings, ...params })),
    },
  };
  // DocumentIO reads a global through the Local API only.
  const payload = { findGlobal: vi.fn(async (_args: any) => settings) };
  const approvals = createTurnApprovals();

  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const tools: Record<string, any> = createTools(mcpTools, schema, pluginOptions(), {
    approvals,
    payload: payload as any,
    user: { id: 1 } as any,
  });
  const written = () => [
    ...mcpTools.updatePosts.execute.mock.calls,
    ...mcpTools.updateSiteSettings.execute.mock.calls,
  ];

  return { tools, mcpTools, payload, approvals, written };
}

const opts: any = { toolCallId: "t", messages: [] };
const declares = (properties: Record<string, unknown>) => ({
  inputSchema: { jsonSchema: { type: "object", properties } },
});

describe("updateDocument: the target", () => {
  it("refuses a collection outside the schema and lists the valid ones", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "orders", id: "1", data: { title: "B" } },
      opts
    );

    expect(res.error).toBe(
      'Unknown collection "orders". Collections: "posts". Globals: "site-settings".'
    );
    expect(written()).toEqual([]);
  });

  it("refuses a global outside the schema and lists the valid ones", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { global: "navigation", data: { tagline: "B" } },
      opts
    );

    expect(res.error).toBe(
      'Unknown global "navigation". Collections: "posts". Globals: "site-settings".'
    );
    expect(written()).toEqual([]);
  });

  it("names editContent for a collection of the schema the site gives no update tool for", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "tags", id: "4", data: { label: "B" } },
      opts
    );

    expect(res.error).toMatch(/no direct update of "tags"/u);
    expect(res.error).toContain("editContent({ collection, id, instruction })");
    expect(written()).toEqual([]);
  });

  it("names editContent for a global of the schema the site gives no update tool for", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { global: "footer", data: { note: "B" } },
      opts
    );

    expect(res.error).toMatch(/no direct update of "footer"/u);
    expect(res.error).toContain("editContent({ global, instruction })");
    expect(written()).toEqual([]);
  });

  it("refuses a collection without `id`, also with an empty one", async () => {
    const { tools, written, mcpTools } = makeToolset();

    for (const input of [
      { collection: "posts", data: { title: "B" } },
      { collection: "posts", id: "", data: { title: "B" } },
    ]) {
      const res: any = await tools.updateDocument.execute(input, opts);

      expect(res.error).toMatch(/^Pass the `id` of the document in "posts"\. Take it from/u);
    }

    expect(written()).toEqual([]);
    expect(mcpTools.findPosts.execute).not.toHaveBeenCalled();
  });

  it("refuses `collection` and `global` together", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", global: "site-settings", id: "1", data: { title: "B" } },
      opts
    );

    expect(res.error).toMatch(/^Pass either `collection` with `id`, or `global`\./u);
    expect(res.error).toContain('Collections: "posts". Globals: "site-settings".');
    expect(written()).toEqual([]);
  });

  it("refuses a call with neither `collection` nor `global`", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute({ id: "1", data: { title: "B" } }, opts);

    expect(res.error).toMatch(/^Pass either `collection` with `id`, or `global`\./u);
    expect(written()).toEqual([]);
  });
});

describe("updateDocument: the data", () => {
  it("refuses a field the target does not have and names its fields", async () => {
    const { tools, written, mcpTools } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { headline: "B" } },
      opts
    );

    expect(res.error).toMatch(/"posts" has no field "headline"/u);
    expect(res.error).toMatch(/Its fields: .*title/u);
    expect(written()).toEqual([]);
    expect(mcpTools.findPosts.execute).not.toHaveBeenCalled();
  });

  it("refuses an empty `data`", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: {} },
      opts
    );

    expect(res.error).toMatch(/`data` is empty and there is no `add` or `remove`/u);
    expect(written()).toEqual([]);
  });

  it.each(["id", "draft", "_status", "where", "locale", "depth", "overrideLock", "autosave"])(
    "refuses the control key `%s` inside `data`",
    async (key) => {
      const { tools, written, mcpTools } = makeToolset();
      const res: any = await tools.updateDocument.execute(
        { collection: "posts", id: "1", data: { title: "B", [key]: "2" } },
        opts
      );

      expect(res.error).toContain(`remove "${key}" from it`);
      expect(res.error).toMatch(/id goes in `id`/u);
      expect(written()).toEqual([]);
      expect(mcpTools.findPosts.execute).not.toHaveBeenCalled();
    }
  );

  it("names the edit tool for a schema field that has the name of a control key", async () => {
    const pages: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "pages",
          fields: [
            { name: "title", type: "text" },
            { name: "locale", type: "select", options: ["en", "es"] },
          ],
          hasVersions: true,
          hasDrafts: true,
          hasAuth: false,
          timestamps: true,
        },
      ],
    } as SchemaContext;
    const updatePages = { execute: vi.fn(async (params: any) => updated(params)) };
    const tools: Record<string, any> = createTools(
      { findPages: { execute: vi.fn(async () => resource({ id: "4", title: "A" })) }, updatePages },
      pages,
      pluginOptions(),
      { approvals: createTurnApprovals() }
    );
    const res: any = await tools.updateDocument.execute(
      { collection: "pages", id: "4", data: { locale: "es" } },
      opts
    );

    expect(res.error).toMatch(/cannot set the field\(s\) "locale"[\s\S]*editContent/u);
    expect(res.error).not.toMatch(/locale in `locale`/u);
    expect(updatePages.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["locale", { id: {}, title: {}, draft: {}, _status: {} }, /takes no `locale`/u],
    ["draft", { id: {}, title: {}, locale: {} }, /takes no `draft`/u],
  ])(
    "does not send a write to a site tool that would drop its %s",
    async (_name, properties, error) => {
      const localized = {
        ...schema,
        locales: ["en", "es"],
        defaultLocale: "en",
        collections: [
          {
            ...schema.collections[0],
            fields: [{ name: "title", type: "text", localized: true }],
          },
        ],
      } as SchemaContext;
      const updatePosts = {
        inputSchema: { jsonSchema: { type: "object", properties } },
        execute: vi.fn(async (params: any) => updated(params)),
      };
      const findPosts = {
        inputSchema: {
          jsonSchema: {
            type: "object",
            properties: { id: {}, draft: {}, locale: {}, depth: {}, fallbackLocale: {} },
          },
        },
        execute: vi.fn(async () => resource({ id: "7", title: "Payload CMS" })),
      };
      const tools: Record<string, any> = createTools(
        { findPosts, updatePosts },
        localized,
        pluginOptions(),
        { approvals: createTurnApprovals() }
      );
      const res: any = await tools.updateDocument.execute(
        { collection: "posts", id: "7", locale: "es", data: { title: "Hola" } },
        opts
      );

      expect(JSON.stringify(res)).toMatch(error);
      expect(updatePosts.execute).not.toHaveBeenCalled();
    }
  );

  it("writes a translation equal to the default text into a locale that has none of its own", async () => {
    const localized = {
      ...schema,
      locales: ["en", "es"],
      defaultLocale: "en",
      collections: [
        {
          ...schema.collections[0],
          fields: [{ name: "title", type: "text", localized: true }],
        },
      ],
    } as SchemaContext;
    const findPosts = {
      ...declares({ id: {}, draft: {}, locale: {}, depth: {}, fallbackLocale: {} }),
      execute: vi.fn(async ({ locale, fallbackLocale }: any) =>
        resource({
          id: "7",
          title: locale === "es" && fallbackLocale === "none" ? null : "Payload CMS",
        })
      ),
    };
    const updatePosts = {
      ...declares({ id: {}, title: {}, draft: {}, locale: {}, _status: {} }),
      execute: vi.fn(async (params: any) => updated(params)),
    };
    const tools: Record<string, any> = createTools(
      { findPosts, updatePosts },
      localized,
      pluginOptions(),
      { approvals: createTurnApprovals() }
    );
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "7", locale: "es", data: { title: "Payload CMS" } },
      opts
    );

    expect(JSON.stringify(res)).not.toMatch(/nothing-changed/u);
    expect(updatePosts.execute).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Payload CMS", locale: "es" }),
      expect.anything()
    );
  });

  it("names every control key of `data` in one error", async () => {
    const { tools } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { title: "B", draft: false, _status: "published" } },
      opts
    );

    expect(res.error).toContain('remove "draft", "_status" from it');
  });

  it("refuses a blocks array inside `data` and names editContent", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { title: "B", layout: [{ blockType: "hero" }] } },
      opts
    );

    expect(res.error).toMatch(
      /Refusing to write the "layout" blocks field through updateDocument/u
    );
    expect(res.error).toContain("editContent");
    expect(written()).toEqual([]);
  });

  it("refuses a rich text field inside `data` and names editContent", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      {
        collection: "posts",
        id: "1",
        data: { title: "B", content: { root: { type: "root", children: [] } } },
      },
      opts
    );

    expect(res.error).toMatch(/"content" rich text field/u);
    expect(res.error).toContain("editContent");
    expect(written()).toEqual([]);
  });

  it("refuses a blocks array nested deeper in `data`", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { global: "site-settings", data: { hero: { rows: [{ blockType: "hero" }] } } },
      opts
    );

    expect(res.error).toMatch(/"hero" blocks field/u);
    expect(written()).toEqual([]);
  });
});

describe("updateDocument: the write", () => {
  it("writes a harmless update as a draft, the fields flattened next to `id`", async () => {
    const { tools, mcpTools } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { title: "B" } },
      opts
    );

    expect(res.error).toBeUndefined();
    expect(mcpTools.updatePosts.execute.mock.calls).toEqual([
      [{ id: "1", title: "B", draft: true, _status: "draft" }, opts],
    ]);
    expect(mcpTools.updateSiteSettings.execute).not.toHaveBeenCalled();
  });

  it("writes a global through the update tool of that global, and refuses an `id` with it", async () => {
    const { tools, mcpTools } = makeToolset();
    const withId: any = await tools.updateDocument.execute(
      { global: "site-settings", id: "7", data: { tagline: "New" } },
      opts
    );

    expect(withId.error).toContain("A global has no `id`");
    expect(mcpTools.updateSiteSettings.execute).not.toHaveBeenCalled();
    const res: any = await tools.updateDocument.execute(
      { global: "site-settings", data: { tagline: "New" } },
      opts
    );

    expect(res.error).toBeUndefined();
    expect(mcpTools.updateSiteSettings.execute.mock.calls).toEqual([
      [{ tagline: "New", draft: true, _status: "draft" }, opts],
    ]);
    expect(mcpTools.updatePosts.execute).not.toHaveBeenCalled();
  });

  it("passes `locale` to the write and to the read before it", async () => {
    const { tools, mcpTools } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { title: "B" }, locale: "xx" },
      opts
    );

    expect(res.error).toBeUndefined();
    expect(mcpTools.updatePosts.execute.mock.calls[0][0]).toEqual({
      id: "1",
      title: "B",
      locale: "xx",
      draft: true,
      _status: "draft",
    });
    expect(mcpTools.findPosts.execute.mock.calls[0][0]).toMatchObject({ id: "1", locale: "xx" });
  });

  it("passes `locale` to the write of a global and to the read before it", async () => {
    const { tools, mcpTools, payload } = makeToolset();

    await tools.updateDocument.execute(
      { global: "site-settings", data: { tagline: "New" }, locale: "xx" },
      opts
    );
    expect(mcpTools.updateSiteSettings.execute.mock.calls[0][0]).toEqual({
      tagline: "New",
      locale: "xx",
      draft: true,
      _status: "draft",
    });
    expect(payload.findGlobal.mock.calls[0][0]).toMatchObject({
      slug: "site-settings",
      locale: "xx",
    });
  });

  it("writes nothing when the fields already hold the value", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { title: "A" } },
      opts
    );

    expect(res.writeStatus).toBe("nothing-changed");
    expect(written()).toEqual([]);
  });

  it("gives the model the saved document as text", async () => {
    const { tools } = makeToolset();
    const output = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { title: "B" } },
      opts
    );
    const shown = tools.updateDocument.toModelOutput({ output });

    expect(shown.type).toBe("text");
    expect(JSON.parse(shown.value)).toMatchObject({ id: "1", title: "B" });
  });

  it("names the length of each text value it stored, read from the saved document", async () => {
    const { tools, mcpTools } = makeToolset();

    mcpTools.updatePosts.execute.mockImplementation(async (params: any) =>
      updated({ ...post, ...params, title: `${params.title} ` })
    );
    const input = { collection: "posts", id: "1", data: { title: "Twelve chars" } };
    const output = await tools.updateDocument.execute(input, opts);
    const shown = tools.updateDocument.toModelOutput({ input, output });
    const [document, note] = shown.value.split("\nLength in characters");

    expect(JSON.parse(document)).toMatchObject({ id: "1" });
    expect(note).toContain("this update stored: title 13.");
  });

  it("names the path of a text value inside a group or a row", () => {
    const data = { seo: { description: "abc" }, rows: [{ label: "four" }], empty: "", count: 2 };

    expect(storedLengthsNote(data, updated({ id: 1, ...data }))).toContain(
      "this update stored: seo.description 3, rows.0.label 4."
    );
  });

  it("names no length when nothing was written", async () => {
    const { tools } = makeToolset();
    const input = { collection: "posts", id: "1", data: { title: "A" } };
    const output = await tools.updateDocument.execute(input, opts);

    expect(tools.updateDocument.toModelOutput({ input, output }).value).not.toContain(
      "Length in characters"
    );
    expect(storedLengthsNote({ title: "A" }, { error: "refused" })).toBe("");
  });
});

const ask = (approvals: ReturnType<typeof createTurnApprovals>, input: unknown) =>
  decideApproval(approvals, { toolName: "updateDocument", toolCallId: "t", input });

describe("updateDocument: `add` and `remove` on a field with many values", () => {
  it("takes `add` or `remove` without `data` as valid input", () => {
    const inputSchema = makeToolset().tools.updateDocument.inputSchema;

    expect(inputSchema.safeParse({ collection: "posts", id: 1, add: { tags: [4] } }).success).toBe(
      true
    );
    expect(
      inputSchema.safeParse({ collection: "posts", id: 1, remove: { tags: [2] } }).success
    ).toBe(true);
  });

  it("adds entries at the end and keeps every entry the list holds", async () => {
    const { tools, mcpTools } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", add: { tags: [4, "2"] } },
      opts
    );

    expect(res.error).toBeUndefined();
    expect(mcpTools.updatePosts.execute.mock.calls[0][0]).toEqual({
      id: "1",
      tags: [1, 2, 3, 4],
      draft: true,
      _status: "draft",
    });
  });

  it("writes `add` together with other fields of `data`, in the locale of the call", async () => {
    const { tools, mcpTools } = makeToolset();

    await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { title: "B" }, add: { tags: [4] }, locale: "xx" },
      opts
    );
    expect(mcpTools.findPosts.execute.mock.calls[0][0]).toMatchObject({ id: "1", locale: "xx" });
    expect(mcpTools.updatePosts.execute.mock.calls[0][0]).toMatchObject({
      title: "B",
      tags: [1, 2, 3, 4],
      locale: "xx",
    });
  });

  it("writes nothing when the list holds every entry to add", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", add: { tags: [2] } },
      opts
    );

    expect(res.writeStatus).toBe("nothing-changed");
    expect(written()).toEqual([]);
  });

  it("asks the person before `remove` takes entries out, and keeps the others", async () => {
    const { tools, approvals, mcpTools, written } = makeToolset();
    const input = { collection: "posts", id: "1", remove: { tags: [2] }, add: { tags: [5] } };
    const blocked: any = await tools.updateDocument.execute(input, opts);

    expect(blocked.writeStatus).toBe("needs-confirmation");
    expect(written()).toEqual([]);
    const asked = await ask(approvals, input);

    expect(JSON.parse(asked?.reason ?? "").effects).toEqual(['"tags" loses 1 of its 3 items.']);
    await tools.updateDocument.execute(input, opts);
    expect(mcpTools.updatePosts.execute.mock.calls[0][0]).toMatchObject({ tags: [1, 3, 5] });
  });

  it("refuses an entry to remove that the list does not hold, and names what it holds", async () => {
    const { tools, approvals, written } = makeToolset();
    const input = { collection: "posts", id: "1", remove: { tags: [9] } };
    const res: any = await tools.updateDocument.execute(input, opts);

    expect(res.error).toBe('"tags" holds no [9] to remove. It holds [1,2,3].');
    expect(await ask(approvals, input)).toBeUndefined();
    expect(written()).toEqual([]);
  });

  it("refuses a field without many values, and names the fields that have them", async () => {
    const { tools, mcpTools } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", add: { title: ["B"], topics: [1] } },
      opts
    );

    expect(res.error).toContain('no field with many values named "title", "topics"');
    expect(res.error).toContain('("tags")');
    expect(mcpTools.findPosts.execute).not.toHaveBeenCalled();
  });

  it("refuses a field in `data` and in `add` at once", async () => {
    const { tools, mcpTools } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { tags: [1] }, add: { tags: [4] } },
      opts
    );

    expect(res.error).toContain('"tags" is in `data` and in `add`/`remove`');
    expect(mcpTools.findPosts.execute).not.toHaveBeenCalled();
  });

  it("refuses entries that are not an array", async () => {
    const { tools } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", add: { tags: 4 } },
      opts
    );

    expect(res.error).toContain('`add` maps a field name to an array of entries, e.g. { "tags"');
  });

  it("names the document an `add` cannot read", async () => {
    const { tools, mcpTools, written } = makeToolset();

    mcpTools.findPosts.execute.mockImplementation(async () => resource(null));
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "7", add: { tags: [4] } },
      opts
    );

    expect(res.error).toContain("not found");
    expect(written()).toEqual([]);
  });

  it("previews the whole new list", async () => {
    const { tools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", add: { tags: [4] }, preview: true },
      opts
    );

    expect(res).toMatchObject({ fieldsChanged: ["tags"], safe: true });
    expect(res.diff.tags.after).toBe("[4 items]");
    expect(written()).toEqual([]);
  });
});

describe("updateDocument: the approval of a destructive update", () => {
  const destructive = { collection: "posts", id: "1", data: { tags: [1] } };

  it("has one policy for every update, under its own name", () => {
    const { approvals } = makeToolset();

    expect([...approvals.policies.keys()].filter((name) => /^update/iu.test(name))).toEqual([
      "updateDocument",
    ]);
  });

  it("refuses a destructive update without the click and runs it after the click", async () => {
    const { tools, approvals, mcpTools, written } = makeToolset();
    const blocked: any = await tools.updateDocument.execute(destructive, opts);

    expect(blocked.writeStatus).toBe("needs-confirmation");
    expect(blocked.error).toContain("Call updateDocument again");
    expect(written()).toEqual([]);
    const asked = await ask(approvals, destructive);

    expect(asked?.type).toBe("user-approval");
    expect(JSON.parse(asked?.reason ?? "")).toEqual({
      kind: "risky-update",
      collection: "posts",
      document: { id: "1", title: "A" },
      effects: ['"tags" loses 2 of its 3 items.'],
    });
    const allowed: any = await tools.updateDocument.execute(destructive, opts);

    expect(allowed.error).toBeUndefined();
    expect(mcpTools.updatePosts.execute.mock.calls[0][0]).toMatchObject({ id: "1", tags: [1] });
  });

  it("asks about a destructive update of a global and names the global", async () => {
    const { tools, approvals, mcpTools, written } = makeToolset();
    const input = { global: "site-settings", data: { tagline: "" } };
    const blocked: any = await tools.updateDocument.execute(input, opts);

    expect(blocked.writeStatus).toBe("needs-confirmation");
    expect(written()).toEqual([]);
    const asked = await ask(approvals, input);

    expect(JSON.parse(asked?.reason ?? "")).toEqual({
      kind: "risky-update",
      global: "site-settings",
      effects: ['"tagline" has a value now. The update empties it.'],
    });
    const allowed: any = await tools.updateDocument.execute(input, opts);

    expect(allowed.error).toBeUndefined();
    expect(mcpTools.updateSiteSettings.execute.mock.calls[0][0]).toMatchObject({ tagline: "" });
  });

  it("does not ask for an input the tool refuses", async () => {
    const { approvals, mcpTools } = makeToolset();

    expect(await ask(approvals, { collection: "orders", id: "1", data: { tags: [] } })).toBe(
      undefined
    );
    expect(await ask(approvals, { collection: "posts", data: { tags: [] } })).toBeUndefined();
    expect(
      await ask(approvals, { collection: "posts", id: "1", data: { tags: [], where: "{}" } })
    ).toBeUndefined();
    expect(mcpTools.findPosts.execute).not.toHaveBeenCalled();
  });
});

describe("updateDocument({ preview: true }): what the update would change", () => {
  const destructive = { collection: "posts", id: "1", data: { tags: [1] } };

  it("returns the diff and the warnings of a collection document and writes nothing", async () => {
    const { tools, mcpTools, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      {
        collection: "posts",
        id: "1",
        data: { title: "B", tags: [1] },
        locale: "xx",
        preview: true,
      },
      opts
    );

    expect(res).toMatchObject({
      documentId: "1",
      collection: "posts",
      fieldsChanged: ["title", "tags"],
      fieldsUnchanged: [],
      diff: { title: { before: '"A"', after: '"B"' } },
      safe: false,
    });
    expect(res.warnings[0]).toContain("lose 2");
    expect(res.nextStep).toContain("asks them to confirm");
    expect(mcpTools.findPosts.execute.mock.calls[0][0]).toMatchObject({ id: "1", locale: "xx" });
    expect(written()).toEqual([]);
  });

  it("previews a global", async () => {
    const { tools, payload, written } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { global: "site-settings", data: { tagline: "" }, preview: true },
      opts
    );

    expect(res).toMatchObject({ global: "site-settings", fieldsChanged: ["tagline"], safe: false });
    expect(res.warnings[0]).toContain("would be emptied");
    expect(payload.findGlobal).toHaveBeenCalled();
    expect(written()).toEqual([]);
  });

  it("says a harmless change is safe", async () => {
    const { tools } = makeToolset();
    const res: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { title: "B" }, preview: true },
      opts
    );

    expect(res.safe).toBe(true);
    expect(res.warnings).toBeUndefined();
  });

  it("puts no approval card in the chat and unlocks nothing", async () => {
    const { tools, approvals, written } = makeToolset();

    expect(await ask(approvals, { ...destructive, preview: true })).toBeUndefined();
    expect(approvals.asked.size).toBe(0);
    await tools.updateDocument.execute({ ...destructive, preview: true }, opts);
    const blocked: any = await tools.updateDocument.execute(destructive, opts);

    expect(blocked.writeStatus).toBe("needs-confirmation");
    expect(blocked.error).toMatch(/DESTRUCTIVE/u);
    expect(blocked.error).toContain("Call updateDocument again");
    expect(written()).toEqual([]);
  });

  it("refuses what the update itself refuses, with the same error", async () => {
    const { tools, mcpTools } = makeToolset();
    const noTarget: any = await tools.updateDocument.execute(
      { collection: "tags", id: "1", data: { label: "x" }, preview: true },
      opts
    );
    const blocks: any = await tools.updateDocument.execute(
      { collection: "posts", id: "1", data: { layout: [{ blockType: "hero" }] }, preview: true },
      opts
    );

    expect(noTarget.error).toContain("editContent");
    expect(blocks.error).toContain("editContent");
    expect(mcpTools.findPosts.execute).not.toHaveBeenCalled();
  });

  it("gives the model the whole preview as text", async () => {
    const { tools } = makeToolset();
    const output = await tools.updateDocument.execute({ ...destructive, preview: true }, opts);
    const shown = tools.updateDocument.toModelOutput({ output });

    expect(JSON.parse(shown.value)).toEqual(output);
  });
});
