import { describe, expect, it, vi } from "vitest";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { createTools } from "../src/agent/tools/index.js";
import { wrapMcpTools } from "../src/agent/tools/mcp/wrapTools.js";
import type { SchemaContext } from "../src/types.js";
import { pluginOptions } from "./harness.js";

const schema: SchemaContext = {
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
  globals: [],
};

function wrap(names: string[]) {
  const executes = Object.fromEntries(names.map((name) => [name, vi.fn(async () => "ran")]));
  const mcpTools: any = Object.fromEntries(
    names.map((name) => [name, { description: `Original ${name}`, execute: executes[name] }])
  );
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const wrapped = wrapMcpTools(mcpTools, {
    schema,
    documentIo: () => createDocumentIO({ mcpTools, schema }),
    recordEdits: vi.fn(),
  });
  const warnings = warn.mock.calls.map(([text]) => String(text));
  const modelTools: Record<string, any> = createTools(mcpTools, schema, pluginOptions());

  warn.mockRestore();
  log.mockRestore();

  return { executes, wrapped, modelTools, warnings };
}

const options: any = { toolCallId: "call-1", messages: [] };

describe("the agent never deletes", () => {
  it("gives the model no delete tool of a known collection and never runs it", async () => {
    const { executes, wrapped, modelTools } = wrap(["deletePosts", "findPosts", "updatePosts"]);

    expect(Object.keys(modelTools)).not.toContain("deletePosts");
    expect(Object.keys(wrapped.safeMcpTools)).not.toContain("deletePosts");
    expect(wrapped.refusedDeleteTools).toEqual(["deletePosts"]);

    await modelTools.updateDocument.execute(
      { collection: "posts", id: 1, data: { title: "" } },
      options
    );
    await modelTools.listDocuments.execute({ collection: "posts" }, options);
    expect(executes.deletePosts).not.toHaveBeenCalled();
  });

  it("gives the model no delete tool of a collection outside the agent's schema, in any letter case", () => {
    const names = ["deleteMedia", "DELETEorders", "delete_all"];
    const { executes, wrapped, modelTools } = wrap(names);

    for (const name of names) {
      expect(Object.keys(modelTools)).not.toContain(name);
      expect(Object.keys(wrapped.safeMcpTools)).not.toContain(name);
      expect(wrapped.passthroughTools).not.toContain(name);
      expect(executes[name]).not.toHaveBeenCalled();
    }

    expect(wrapped.refusedDeleteTools).toEqual(names);
  });

  it("holds no tool whose name starts with delete, whatever the site gives", () => {
    const { modelTools } = wrap(["deletePosts", "deleteMedia", "DELETEorders", "delete_all"]);

    expect(Object.keys(modelTools).filter((name) => /^delete/iu.test(name))).toEqual([]);
  });

  it("reports the delete tools the site gives in a server warning", () => {
    const { wrapped, warnings } = wrap(["deleteRedirects", "findPosts"]);

    expect(wrapped.refusedDeleteTools).toEqual(["deleteRedirects"]);
    expect(wrapped.passthroughTools).not.toContain("deleteRedirects");
    expect(warnings.some((text) => /never deletes documents.*deleteRedirects/u.test(text))).toBe(
      true
    );
  });

  it("leaves the other tools as they were", async () => {
    const { executes, wrapped, modelTools } = wrap(["findPosts", "purgeCache"]);

    await (wrapped.safeMcpTools as any).purgeCache.execute({}, options);
    await modelTools.purgeCache.execute({}, options);
    expect(executes.purgeCache).toHaveBeenCalledTimes(2);
    expect(wrapped.refusedDeleteTools).toEqual([]);
  });
});
