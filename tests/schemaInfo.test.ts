import { describe, it, expect } from "vitest";
import { createSchemaInfoTool } from "../src/agent/tools/schemaInfo.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const opts = { toolCallId: "t", messages: [] } as any;

function bigFieldList(n: number): SchemaField[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `field${i}`,
    type: "text",
    description: "x".repeat(500),
  })) as SchemaField[];
}

describe("getSchemaInfo: output size discipline", () => {
  it("returns a block definition unchanged when small", async () => {
    const schema: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "pages",
          fields: [
            { name: "title", type: "text" },
            {
              name: "sections",
              type: "blocks",
              blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }],
            } as SchemaField,
          ] as SchemaField[],
          hasVersions: true,
          hasDrafts: true,
          hasAuth: false,
          timestamps: true,
        },
      ],
    };
    const t = createSchemaInfoTool(schema);
    const r: any = await t.execute!({ target: "hero" }, opts);

    expect(r.type).toBe("block");
    expect(r.slug).toBe("hero");
  });

  it("a block that itself nests a `blocks` field referencing many sibling block types is slimmed/capped, not returned as an unbounded fully-expanded tree", async () => {
    const siblings = Array.from({ length: 30 }, (_, i) => ({
      slug: `sibling-${i}`,
      fields: bigFieldList(20),
    }));
    const container = {
      slug: "container",
      fields: [{ name: "columns", type: "blocks", blocks: siblings } as SchemaField],
    };
    const schema: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "pages",
          fields: [
            { name: "sections", type: "blocks", blocks: [container] } as SchemaField,
          ] as SchemaField[],
          hasVersions: true,
          hasDrafts: true,
          hasAuth: false,
          timestamps: true,
        },
      ],
    };
    const t = createSchemaInfoTool(schema);
    const r: any = await t.execute!({ target: "container" }, opts);

    expect(JSON.stringify(r).length).toBeLessThan(25_000);
  });

  it("a collection whose bloat comes from many ORDINARY fields (not blocks) still gets capped by the outer backstop after slimming does nothing", async () => {
    const schema: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "wide",
          fields: bigFieldList(200),
          hasVersions: true,
          hasDrafts: true,
          hasAuth: false,
          timestamps: true,
        },
      ],
    };
    const t = createSchemaInfoTool(schema);
    const r: any = await t.execute!({ target: "wide" }, opts);

    expect(JSON.stringify(r).length).toBeLessThan(60_000);
  });
});
