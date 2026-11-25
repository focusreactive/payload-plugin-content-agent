import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { executeMcpWrite, refusedRowIdPaths, withoutRowIds } from "../src/agent/mcpParse.js";
import { omitLocaleParam } from "../src/agent/content/discovery.js";
import { emptySelectionNote } from "../src/agent/content/editorBulk.js";
import { createTools } from "../src/agent/tools/index.js";
import type { SchemaContext } from "../src/types.js";
import { pluginOptions } from "./harness.js";

const CALL = { toolCallId: "test", messages: [], context: undefined };

const REFUSED = `MCP error -32602: Input validation error: Invalid arguments for tool updateArticles: [
  { "code": "unrecognized_keys", "keys": [ "id" ], "path": [ "steps", 0 ], "message": "Unrecognized key(s) in object: 'id'" },
  { "code": "unrecognized_keys", "keys": [ "id" ], "path": [ "steps", 1 ], "message": "Unrecognized key(s) in object: 'id'" },
  { "code": "unrecognized_keys", "keys": [ "colour" ], "path": [ "steps", 1 ], "message": "Unrecognized key(s) in object: 'colour'" }
]`;

describe("array rows whose id the MCP update tool refuses", () => {
  it("reads the refused row paths from the error, and only those about `id`", () => {
    expect(refusedRowIdPaths(REFUSED)).toEqual([
      ["steps", 0],
      ["steps", 1],
    ]);
    expect(refusedRowIdPaths("MCP error: document not found")).toEqual([]);
  });

  it("removes only the refused ids and leaves the caller's object alone", () => {
    const params = {
      id: "7",
      steps: [
        { id: "a", heading: "One" },
        { id: "b", heading: "Two" },
      ],
    };

    expect(
      withoutRowIds(params, [
        ["steps", 0],
        ["steps", 1],
      ])
    ).toEqual({ id: "7", steps: [{ heading: "One" }, { heading: "Two" }] });
    expect(params.steps[0].id).toBe("a");
  });

  it("sends the write again without the row ids when the tool throws on them", async () => {
    const execute = vi.fn(async (params: any) => {
      if (params.steps.some((row: any) => "id" in row)) throw new Error(REFUSED);

      return { content: [{ type: "text", text: "Document updated successfully" }] };
    });
    const res: any = await executeMcpWrite(
      execute,
      {
        id: "7",
        steps: [
          { id: "a", heading: "One" },
          { id: "b", heading: "Two" },
        ],
      },
      CALL
    );

    expect(res.content[0].text).toContain("successfully");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toEqual({
      id: "7",
      steps: [{ heading: "One" }, { heading: "Two" }],
    });
  });

  it("does the same when the refusal comes back as an error result", async () => {
    const execute = vi.fn(async (params: any) =>
      params.steps[0].id
        ? { isError: true, content: [{ type: "text", text: REFUSED }] }
        : { content: [{ type: "text", text: "ok" }] }
    );

    await executeMcpWrite(execute, { steps: [{ id: "a" }] }, CALL);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("passes any other failure through unchanged, without a retry", async () => {
    const execute = vi.fn(async () => {
      throw new Error("MCP error: document not found");
    });

    await expect(executeMcpWrite(execute, { id: "7" }, CALL)).rejects.toThrow("document not found");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

const tools = () => ({
  edit: {
    description: "x",
    inputSchema: z.object({ id: z.string(), locale: z.string().optional() }),
  },
  plain: { description: "y", inputSchema: z.object({ id: z.string() }) },
  foreign: { description: "z", inputSchema: { jsonSchema: { properties: { locale: {} } } } },
});

describe("the locale parameter on a project without locales", () => {
  it("is not offered", () => {
    const out = omitLocaleParam(tools(), { collections: [], globals: [] } as SchemaContext);

    expect(Object.keys((out.edit.inputSchema as any).shape)).toEqual(["id"]);
    expect(Object.keys((out.plain.inputSchema as any).shape)).toEqual(["id"]);
    expect(out.foreign.inputSchema).toEqual({ jsonSchema: { properties: { locale: {} } } });
  });

  it("stays on a localized project", () => {
    const out = omitLocaleParam(tools(), {
      collections: [],
      globals: [],
      locales: ["en", "de"],
      defaultLocale: "en",
    } as SchemaContext);

    expect(Object.keys((out.edit.inputSchema as any).shape)).toEqual(["id", "locale"]);
  });

  it("takes only the locales of the schema on a localized project", () => {
    const out = omitLocaleParam(tools(), {
      collections: [],
      globals: [],
      locales: ["en", "de"],
      defaultLocale: "en",
    } as SchemaContext);
    const input = out.edit.inputSchema as any;

    expect(input.safeParse({ id: "1", locale: "de" }).success).toBe(true);
    expect(input.safeParse({ id: "1" }).success).toBe(true);
    expect(input.safeParse({ id: "1", locale: "fr" }).success).toBe(false);
    expect(input.shape.locale.unwrap().options).toEqual(["en", "de"]);
    expect(input.shape.locale.description).not.toMatch(/en, de/u);
  });

  const options = pluginOptions();
  const collections = [
    {
      slug: "posts",
      fields: [{ name: "title", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ];
  const offering = (schema: SchemaContext) =>
    Object.entries(createTools({}, schema, options))
      .filter(([, t]) => "locale" in ((t as any).inputSchema?.shape ?? {}))
      .map(([name]) => name);

  it("no orchestrator tool offers it there, and several do on a localized project", () => {
    expect(offering({ collections, globals: [] } as SchemaContext)).toEqual([]);
    expect(
      offering({
        collections,
        globals: [],
        locales: ["en", "de"],
        defaultLocale: "en",
      } as SchemaContext).length
    ).toBeGreaterThan(3);
  });
});

describe("a bulk selection that matches nothing", () => {
  it("says how many documents there are and how to write a filter", async () => {
    const deps = { io: { list: async () => ({ docs: [], totalDocs: 9, totalPages: 1 }) } } as any;
    const note = await emptySelectionNote(deps, "posts", '{"title":{"like":"%Intro"}}');

    expect(note).toContain('"posts" has 9 document(s)');
    expect(note).toContain('{"title":{"like":"%Intro"}}');
    expect(note).toMatch(/contains/u);
    expect(note).toMatch(/no wildcards/u);
    expect(note).toContain('where "{}"');
  });

  it("still answers when the count cannot be read", async () => {
    const deps = {
      io: {
        list: async () => {
          throw new Error("no access");
        },
      },
    } as any;

    expect(await emptySelectionNote(deps, "posts", undefined)).toMatch(
      /^The selection matches no documents\. The format is/u
    );
  });
});

describe("array row ids: the wording of Payload MCP 3.91", () => {
  it("reads the refused rows from the plain-text form, nested paths included", () => {
    const text =
      "MCP error -32602: Input validation error: Invalid arguments for tool updateArticles: Unrecognized key(s) in object: 'id' at steps[0]\nUnrecognized key(s) in object: 'id' at layout[2].items[1]\nUnrecognized key(s) in object: 'colour' at steps[1]";

    expect(refusedRowIdPaths(text)).toEqual([
      ["steps", 0],
      ["layout", 2, "items", 1],
    ]);
  });
});

describe("two writes to one document in one step", () => {
  it("run one after the other, so the second starts from the result of the first", async () => {
    const { withDocumentLock, documentLockKey } =
      await import("../src/agent/content/documentLock.js");
    let stored = "Content managers and content managers";
    const replace = (find: string, to: string) =>
      withDocumentLock(documentLockKey({ collection: "posts" }, 1), async () => {
        const read = stored;

        await new Promise((r) => setTimeout(r, 5));
        stored = read.replaceAll(find, to);
      });

    await Promise.all([
      replace("Content managers", "Content editors"),
      replace("content managers", "content editors"),
    ]);
    expect(stored).toBe("Content editors and content editors");
  });

  it("does not hold back writes to other documents, and survives a failed write", async () => {
    const { withDocumentLock } = await import("../src/agent/content/documentLock.js");
    const order: string[] = [];

    await Promise.all([
      withDocumentLock("posts#1", async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push("1");
      }),
      withDocumentLock("posts#2", async () => {
        order.push("2");
      }),
    ]);
    expect(order).toEqual(["2", "1"]);
    await expect(
      withDocumentLock("posts#1", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await expect(withDocumentLock("posts#1", async () => "ok")).resolves.toBe("ok");
  });
});
