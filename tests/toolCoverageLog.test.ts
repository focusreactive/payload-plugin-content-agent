import { describe, expect, it, vi } from "vitest";
import { describeToolCoverage } from "../src/agent/runAgent/assemble.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "authors",
      fields: [{ name: "name", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

describe("the server log of collections without MCP tools", () => {
  it("names the Local API only when the agent may fall back on it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const logged = (mcpOnly: boolean, url: string) => {
      warn.mockClear();
      describeToolCoverage({ schema, options: { mcpOnly } } as any, {}, url);

      return warn.mock.calls.map(([text]) => String(text)).join("\n");
    };

    expect(logged(true, "http://only.test/api/mcp")).toContain("cannot read or write it");
    expect(logged(false, "http://local.test/api/mcp")).toContain(
      "fall back to the Payload Local API"
    );
    warn.mockRestore();
  });
});
