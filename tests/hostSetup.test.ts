import { describe, it, expect, vi } from "vitest";

import { McpUnreachableError, resolveMcpUrl, siteAddress } from "../src/agent/mcpUrl.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { adminBase, adminDocHref } from "../src/ui/lib/adminHref.js";
import type { SchemaContext } from "../src/types.js";

describe("resolveMcpUrl", () => {
  it("follows the API route of the host", () => {
    const config = { serverURL: "https://site.test/", routes: { api: "/cms-api" } };

    expect(resolveMcpUrl(undefined, config)).toBe("https://site.test/cms-api/mcp");
  });

  it("falls back to localhost, never to an address that the request names", () => {
    const resolve = resolveMcpUrl as (...parts: unknown[]) => string;

    expect(resolveMcpUrl(undefined, {})).toMatch(/^http:\/\/localhost:\d+\/api\/mcp$/u);
    expect(resolve(undefined, {}, "https://other.test")).not.toContain("other.test");
  });

  it("keeps a path or a full URL the host set", () => {
    const config = { serverURL: "https://site.test", routes: { api: "/cms-api" } };

    expect(resolveMcpUrl("/custom/mcp", config)).toBe("https://site.test/custom/mcp");
    expect(resolveMcpUrl("https://other.test/mcp", config)).toBe("https://other.test/mcp");
  });

  it("an unreachable endpoint is an error that names the URL and what to check", () => {
    const error = new McpUnreachableError("https://site.test/api/mcp", new Error("fetch failed"));

    expect(error.message).toContain("https://site.test/api/mcp");
    expect(error.message).toContain("fetch failed");
    expect(error.message).toContain("`mcpUrl`");
    expect(error.message).toContain("`serverURL`");
  });
});

describe("siteAddress", () => {
  it("is the serverURL of the Payload config when it has one", () => {
    expect(siteAddress("http://localhost:4001/api/mcp", { serverURL: "https://site.test/" })).toBe(
      "https://site.test/"
    );
  });

  it("is the origin of the full mcpUrl when the config has no serverURL", () => {
    expect(siteAddress("http://localhost:4001/api/mcp", {})).toBe("http://localhost:4001");
  });

  it("falls back to localhost like the MCP address, and never to the request", () => {
    expect(siteAddress(undefined, {})).toMatch(/^http:\/\/localhost:\d+$/u);
  });
});

describe("admin links", () => {
  it("start with one slash when the admin is mounted at the root", () => {
    expect(adminDocHref("notes", 7, adminBase("/"))).toBe("/collections/notes/7");
    expect(adminDocHref("global:settings", undefined, adminBase("/"))).toBe("/globals/settings");
    expect(adminBase(undefined)).toBe("/admin");
  });
});

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "notes",
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
      fields: [{ name: "text", type: "text" }],
    },
  ],
};

const fenced = (docs: unknown[]) => docs.map((doc) => `\`\`\`json\n${JSON.stringify(doc)}\n\`\`\``);

function ioWith(pages: Record<number, string>) {
  const execute = vi.fn(async ({ page }: { page: number }) => ({
    content: [{ type: "text", text: pages[page] ?? "" }],
  }));

  return createDocumentIO({ mcpTools: { findnotes: { execute } } as any, schema });
}

describe("MCP paging without the totals line", () => {
  const two = fenced([{ id: 1 }, { id: 2 }]).join("\n");
  const one = fenced([{ id: 3 }]).join("\n");

  it("a full page means one more page may follow", async () => {
    const result = await ioWith({ 1: two }).list("notes", { page: 1, limit: 2 });

    expect(result).toMatchObject({ totalPages: 2, totalDocs: 2, moreMayExist: true });
  });

  it("a short page is the last one", async () => {
    const result = await ioWith({ 2: one }).list("notes", { page: 2, limit: 2 });

    expect(result.totalPages).toBe(2);
    expect(result.totalDocs).toBe(3);
    expect(result.moreMayExist).toBeUndefined();
  });

  it("a stated total without a page line gives the page count", async () => {
    const io = ioWith({ 1: `Total: 5 documents\n${two}` });
    const result = await io.list("notes", { page: 1, limit: 2 });

    expect(result).toMatchObject({ totalPages: 3, totalDocs: 5 });
    expect(result.moreMayExist).toBeUndefined();
  });

  it("stated totals are used as they are", async () => {
    const io = ioWith({ 1: `Total: 9 documents\nPage: 1 of 5\n${two}` });
    const result = await io.list("notes", { page: 1, limit: 2 });

    expect(result).toMatchObject({ totalPages: 5, totalDocs: 9 });
  });
});
