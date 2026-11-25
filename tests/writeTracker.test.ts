import { describe, it, expect, vi } from "vitest";
import { createTools } from "../src/agent/tools/index.js";
import type { SchemaContext } from "../src/types.js";
import { pluginOptions } from "./harness.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [{ name: "title", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const options = pluginOptions();

const makeMcp = () => ({
  findPosts: {
    execute: vi.fn(async () => ({
      content: [{ text: `Resource:\n${JSON.stringify({ id: "1", title: "A" })}` }],
    })),
  },
  updatePosts: {
    execute: vi.fn(async () => ({
      content: [
        { text: `Document updated successfully\n${JSON.stringify({ id: "1", title: "B" })}` },
      ],
    })),
  },
});

const call = { toolCallId: "t", messages: [] };
const update = { collection: "posts", id: "1", data: { title: "B" } };

describe("write tracker", () => {
  it("counts a write when memory is not configured", async () => {
    const writeTracker = { count: 0, reports: 0, failed: 0 };
    const mcp = makeMcp();
    const tools: Record<string, any> = createTools(mcp, schema, options, { writeTracker });
    const res: any = await tools.updateDocument.execute(update, call);

    expect(res.error).toBeUndefined();
    expect(mcp.updatePosts.execute).toHaveBeenCalledOnce();
    expect(writeTracker.count).toBe(1);
  });

  it("counts a write and persists it when memory is configured", async () => {
    const writeTracker = { count: 0, reports: 0, failed: 0 };
    const memory: any = {
      changesets: { record: vi.fn(async () => undefined) },
    };
    const tools: Record<string, any> = createTools(makeMcp(), schema, options, {
      memory,
      conversationId: "conv-1",
      userId: "user-1",
      writeTracker,
    });

    await tools.updateDocument.execute(update, call);
    expect(writeTracker.count).toBe(1);
    expect(memory.changesets.record).toHaveBeenCalledOnce();
  });

  it("does not count a write the server rejected", async () => {
    const writeTracker = { count: 0, reports: 0, failed: 0 };
    const mcp = makeMcp();

    mcp.updatePosts.execute = vi.fn(async () => ({
      isError: true,
      content: [{ text: "Error: validation failed" }],
    })) as any;
    const tools: Record<string, any> = createTools(mcp, schema, options, { writeTracker });

    await tools.updateDocument.execute(update, call);
    expect(mcp.updatePosts.execute).toHaveBeenCalledOnce();
    expect(writeTracker.count).toBe(0);
  });
});
