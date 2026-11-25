import { describe, expect, it, vi } from "vitest";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { fitNulls } from "../src/agent/mcpNulls.js";
import { createTools } from "../src/agent/tools/index.js";
import type { SchemaContext } from "../src/types.js";

const nullable = (type: string) => ({ type: [type, "null"] });
const row = {
  type: "object",
  properties: {
    value: { type: "number" },
    unit: { type: "string", enum: ["%", "x"] },
    label: nullable("string"),
    id: nullable("string"),
  },
};
const block = (blockType: string, properties: Record<string, unknown>) => ({
  type: "object",
  properties: { ...properties, blockType: { type: "string", const: blockType } },
});
const inputSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    draft: { type: "boolean" },
    status: { type: "string", enum: ["open", "closed"] },
    note: nullable("string"),
    meta: { type: "object", properties: { tone: { type: "string", enum: ["warm"] } } },
    layout: {
      anyOf: [
        {
          type: "array",
          items: {
            anyOf: [
              block("stats", {
                items: { anyOf: [{ type: "array", items: row }, { type: "null" }] },
              }),
              block("text", { body: {} }),
            ],
          },
        },
        { type: "null" },
      ],
    },
  },
};
const tool = { inputSchema: { jsonSchema: inputSchema } };

describe("fitNulls", () => {
  it("drops a null that the tool refuses inside a row of a block, and nothing else", () => {
    const layout = [
      {
        blockType: "stats",
        items: [
          { id: "a", value: 9, unit: "%", label: "one" },
          { id: "b", value: 4.9, unit: null, label: null },
        ],
      },
      { blockType: "text", body: null },
    ];
    const fit = fitNulls(tool, { id: "1", note: null, layout });

    expect(fit.refused).toBe(true);
    expect(fit.input).toEqual({
      id: "1",
      note: null,
      layout: [
        {
          blockType: "stats",
          items: [
            { id: "a", value: 9, unit: "%", label: "one" },
            { id: "b", value: 4.9, label: null },
          ],
        },
        { blockType: "text", body: null },
      ],
    });
  });

  it("drops a refused null inside a group", () => {
    expect(fitNulls(tool, { meta: { tone: null } })).toEqual({
      input: { meta: {} },
      refused: true,
    });
  });

  it("keeps a refused null of the first level and reports it", () => {
    expect(fitNulls(tool, { status: null })).toEqual({ input: { status: null }, refused: true });
  });

  it("changes nothing when the tool takes every null, or declares no schema", () => {
    const input = { note: null, layout: null, other: null };

    expect(fitNulls(tool, input)).toEqual({ input, refused: false });
    expect(fitNulls({}, { status: null })).toEqual({ input: { status: null }, refused: false });
    expect(fitNulls(undefined, { status: null }).refused).toBe(false);
  });
});

describe("a write of a document with an empty optional field", () => {
  const schema: SchemaContext = {
    collections: [
      {
        slug: "pages",
        fields: [{ name: "layout", type: "blocks" }],
        hasVersions: true,
        hasDrafts: true,
        hasAuth: false,
        timestamps: true,
      },
    ],
    globals: [],
  };
  const patch = { layout: [{ blockType: "stats", items: [{ value: 1, unit: null }] }] };
  const answer = {
    content: [{ text: `Resource from collection "pages":\n${JSON.stringify({ id: 1 })}` }],
  };

  it("goes through the Local API, which takes the null", async () => {
    const execute = vi.fn(async () => answer);
    const payload: any = { update: vi.fn(async ({ id, data }: any) => ({ id, ...data })) };
    const io = createDocumentIO({
      mcpTools: { updatePages: { ...tool, execute } } as any,
      schema,
      payload,
      user: { id: 7 } as any,
    });
    const { error } = await io.write({ collection: "pages" }, { id: 1, patch });

    expect(error).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ...patch, _status: "draft" }, draft: true })
    );
  });

  it("goes to the tool without the null when there is no Local API", async () => {
    const execute = vi.fn(async () => answer);
    const io = createDocumentIO({ mcpTools: { updatePages: { ...tool, execute } } as any, schema });
    const { error } = await io.write({ collection: "pages" }, { id: 1, patch });

    expect(error).toBeUndefined();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ layout: [{ blockType: "stats", items: [{ value: 1 }] }] }),
      expect.anything()
    );
  });

  it("stays on the tool when the tool takes the document as it is", async () => {
    const execute = vi.fn(async () => answer);
    const payload: any = { update: vi.fn() };
    const io = createDocumentIO({
      mcpTools: { updatePages: { ...tool, execute } } as any,
      schema,
      payload,
      user: { id: 7 } as any,
    });

    await io.write({ collection: "pages" }, { id: 1, patch: { layout: [{ blockType: "text" }] } });
    expect(execute).toHaveBeenCalled();
    expect(payload.update).not.toHaveBeenCalled();
  });
});

const read = (tools: any, input: object) =>
  tools.readDocument.execute(input, { toolCallId: "call-1", messages: [] });

describe("the mcpOnly option", () => {
  const schema: SchemaContext = {
    collections: [
      {
        slug: "pages",
        fields: [{ name: "title", type: "text" }],
        hasVersions: true,
        hasDrafts: true,
        hasAuth: false,
        timestamps: true,
      },
      {
        slug: "notes",
        fields: [{ name: "title", type: "text" }],
        hasVersions: true,
        hasDrafts: true,
        hasAuth: false,
        timestamps: true,
      },
    ],
    globals: [{ slug: "footer", fields: [], hasVersions: true, hasDrafts: true }],
  };
  const answer = {
    content: [{ text: `Resource from collection "pages":\n${JSON.stringify({ id: 1 })}` }],
  };

  function toolsFor(mcpOnly: boolean) {
    const payload: any = {
      update: vi.fn(async ({ id, data }: any) => ({ id, ...data })),
      updateGlobal: vi.fn(async ({ data }: any) => ({ ...data })),
      findGlobal: vi.fn(async () => ({})),
      findByID: vi.fn(async () => ({ id: 1 })),
    };
    const execute = vi.fn(async () => answer);
    const tools: any = createTools(
      { updatePages: { execute, inputSchema: { jsonSchema: { type: "object", properties: {} } } } },
      schema,
      { mcpOnly, bulkConcurrency: 1, findReplaceConcurrency: 1 } as any,
      { payload, user: { id: 7 } as any }
    );

    return { payload, execute, tools };
  }

  it("leaves a collection without an MCP tool and every global out of reach", async () => {
    const { payload, tools } = toolsFor(true);
    const note = await read(tools, { collection: "notes", id: 1 });
    const footer = await read(tools, { global: "footer" });

    expect(JSON.stringify(note)).toMatch(/no MCP find tool and no Local API/u);
    expect(JSON.stringify(footer)).toMatch(/globals require the Local API/u);
    expect(payload.findByID).not.toHaveBeenCalled();
    expect(payload.findGlobal).not.toHaveBeenCalled();
  });

  it("is off by default: the Local API takes what has no MCP tool", async () => {
    const { payload, tools } = toolsFor(false);

    await read(tools, { collection: "notes", id: 1 });
    await read(tools, { global: "footer" });
    expect(payload.findByID).toHaveBeenCalled();
    expect(payload.findGlobal).toHaveBeenCalled();
  });
});
