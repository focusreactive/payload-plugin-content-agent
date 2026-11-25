import { describe, it, expect, vi } from "vitest";

vi.mock("../src/agent/tools/web.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/agent/tools/web.js")>()),
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../src/agent/tools/web.js";
import { createImportArticleTool } from "../src/agent/tools/importArticle.js";
import type { SchemaCollection, SchemaField } from "../src/types.js";

const PAGE =
  "<html><head><title>Night trains</title></head><body><article><h1>Night trains</h1><p>They are back.</p></article></body></html>";

const collection = (fields: SchemaField[], extra: Partial<SchemaCollection> = {}) => ({
  slug: "entries",
  hasVersions: true,
  hasDrafts: true,
  hasAuth: false,
  timestamps: true,
  fields,
  ...extra,
});

async function importInto(target: SchemaCollection, input: Record<string, unknown> = {}) {
  vi.mocked(safeFetch).mockResolvedValue({
    res: new Response(PAGE, { status: 200 }),
    finalUrl: "https://example.com/a",
  });
  const io = {
    create: vi.fn(async (_target: unknown, { data }: { data: Record<string, unknown> }) => ({
      doc: { id: 5, ...data },
    })),
    transports: vi.fn(() => ({ create: "local" })),
  };
  const tool = createImportArticleTool(io as any, { globals: [], collections: [target] });
  const result: any = await tool.execute!(
    { url: "https://example.com/a", collection: "entries", ...input },
    { toolCallId: "t1", messages: [] } as any
  );

  return { result, data: io.create.mock.calls[0]?.[1].data };
}

describe("importArticle picks its fields from the schema, not from field names", () => {
  it("creates nothing from a page without text, and sets no made-up title", async () => {
    const io = {
      create: vi.fn(async (_target: unknown, { data }: any) => ({ doc: { id: 6, ...data } })),
      transports: vi.fn(() => ({ create: "local" })),
    };
    const target = collection([
      { name: "title", type: "text" },
      { name: "story", type: "richText", editor: "lexical" },
    ]);
    const tool = createImportArticleTool(io as any, { globals: [], collections: [target] });

    const run = async (page: string) => {
      vi.mocked(safeFetch).mockResolvedValue({
        res: new Response(page, { status: 200 }),
        finalUrl: "https://example.com/a",
      });

      return (await tool.execute!({ url: "https://example.com/a", collection: "entries" }, {
        toolCallId: "t1",
        messages: [],
      } as any)) as any;
    };

    const empty = await run("<html><body><article><img src='/a.png'></article></body></html>");

    expect(empty.error).toMatch(/empty content/u);
    expect(io.create).not.toHaveBeenCalled();
    const untitled = await run("<html><body><article><p>Text only.</p></article></body></html>");

    expect(io.create.mock.calls[0][1].data.title).toBeUndefined();
    expect(untitled.warnings.join(" ")).toMatch(/names no title/u);
  });

  it("asks the source for no fixed language", async () => {
    await importInto(collection([{ name: "story", type: "richText", editor: "lexical" }]));
    const [, init] = vi.mocked(safeFetch).mock.calls.at(-1)!;
    const headers = new Headers((init as RequestInit).headers);

    expect(headers.has("Accept-Language")).toBe(false);
  });

  it("writes the title to the title field and the article to the only rich text field", async () => {
    const { result, data } = await importInto(
      collection(
        [
          { name: "caption", type: "text" },
          { name: "headline", type: "text" },
          { name: "story", type: "richText", editor: "lexical" },
        ],
        { useAsTitle: "headline" }
      )
    );

    expect(result.created).toBe(true);
    expect(data.headline).toBe(result.title);
    expect(data.story).toBeDefined();
    expect(Object.keys(data).sort()).toEqual(["headline", "story"]);
  });

  it("asks for bodyField and names the valid values when there are several", async () => {
    const target = collection([
      { name: "headline", type: "text" },
      { name: "story", type: "richText", editor: "lexical" },
      { name: "aside", type: "richText", editor: "lexical" },
    ]);
    const refused = await importInto(target);

    expect(refused.result.error).toContain("`bodyField`");
    expect(refused.result.error).toContain("`story`, `aside`");
    expect(refused.data).toBeUndefined();
    const { data } = await importInto(target, { bodyField: "aside" });

    expect(data.aside).toBeDefined();
    expect(data.story).toBeUndefined();
  });

  it("passes `data` through, keeps a title the caller set and reports required fields left empty", async () => {
    const { result, data } = await importInto(
      collection([
        { name: "headline", type: "text" },
        { name: "code", type: "text", required: true, unique: true },
        { name: "owner", type: "relationship", relationTo: "people", required: true },
        { name: "story", type: "richText", editor: "lexical" },
      ]),
      { data: { headline: "Set by hand", code: "night-trains" } }
    );

    expect(data).toMatchObject({ headline: "Set by hand", code: "night-trains" });
    expect(result.requiredStillEmpty).toEqual(["owner"]);
  });

  it("names the required fields and the next call when the create fails", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      res: new Response(PAGE, { status: 200 }),
      finalUrl: "https://example.com/a",
    });
    const io = {
      create: vi.fn(async () => ({ error: "Required at key" })),
      transports: vi.fn(() => ({ create: "local" })),
    };
    const target = collection([
      { name: "headline", type: "text" },
      { name: "story", type: "richText", editor: "lexical" },
      { name: "key", type: "text", required: true },
    ]);
    const tool = createImportArticleTool(io as any, { globals: [], collections: [target] });
    const result: any = await tool.execute!(
      { url: "https://example.com/a", collection: "entries" },
      { toolCallId: "t1", messages: [] } as any
    );

    expect(result.error).toContain('Required and not sent: "key"');
    expect(result.error).toContain("Call importArticle again");
  });

  it("refuses a field the collection does not have and lists the real ones", async () => {
    const { result, data } = await importInto(
      collection([
        { name: "headline", type: "text" },
        { name: "story", type: "richText", editor: "lexical" },
      ]),
      { data: { slug: "x" } }
    );

    expect(result.error).toContain("no field `slug`");
    expect(result.error).toContain("`headline`, `story`");
    expect(data).toBeUndefined();
  });

  it("skips a rich text field the agent cannot write", async () => {
    const { result } = await importInto(
      collection([
        { name: "headline", type: "text" },
        { name: "legacy", type: "richText", editor: "slate", unsupported: true },
      ])
    );

    expect(result.error).toContain("no rich text field the agent can write");
  });
});
