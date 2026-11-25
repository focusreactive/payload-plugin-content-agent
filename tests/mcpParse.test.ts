import { describe, it, expect } from "vitest";
import { parseMcpFind, parseMcpDoc, mcpText, mcpWriteError } from "../src/agent/mcpParse.js";

const wrap = (text: string, isError = false) => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});

describe("mcpWriteError: detect a silently-rejected plugin-mcp write", () => {
  it("returns null for a success response", () => {
    expect(
      mcpWriteError(
        wrap('Document updated successfully in collection "pages"!\n```json\n{"id":4}\n```')
      )
    ).toBeNull();
  });
  it("flags an error response (rejected write that did NOT throw)", () => {
    expect(
      mcpWriteError(wrap('Error updating resource in collection "pages": invalid block'))
    ).toContain("Error updating");
    expect(mcpWriteError(wrap("Error: Invalid JSON data provided"))).toContain("Invalid JSON");
    expect(mcpWriteError(wrap("❌ **Error**: something"))).toContain("Error");
  });
  it("honors the MCP isError flag", () => {
    expect(mcpWriteError(wrap("whatever", true))).toBe("whatever");
  });
  it("does not false-positive on failure keywords inside the echoed document content", () => {
    const res = wrap(
      'Document updated successfully in collection "posts"!\n```json\n' +
        '{"id":280,"title":"Sanity vs Storyblok","body":"This section covers schema validation and error handling in headless CMS setups."}\n```'
    );

    expect(mcpWriteError(res)).toBeNull();
  });
});

// Mirrors the find response text of @payloadcms/plugin-mcp: a header, then one json fence per document.
function buildFindResponse(
  slug: string,
  docs: any[],
  opts: { totalDocs?: number; page?: number; totalPages?: number } = {}
) {
  const totalDocs = opts.totalDocs ?? docs.length;
  const page = opts.page ?? 1;
  const totalPages = opts.totalPages ?? 1;
  let text = `Collection: "${slug}"\nTotal: ${totalDocs} documents\nPage: ${page} of ${totalPages}\n`;

  for (const d of docs) text += `\n\`\`\`json\n${JSON.stringify(d)}\n\`\`\``;

  return { content: [{ type: "text", text }] };
}

function buildSingleResponse(slug: string, doc: any) {
  return {
    content: [
      { type: "text", text: `Resource from collection "${slug}":\n${JSON.stringify(doc)}` },
    ],
  };
}

describe("parseMcpFind", () => {
  it("extracts every document from a multi-doc fenced list response", () => {
    const docs = [
      { id: 1, title: "First" },
      { id: 2, title: "Second" },
      { id: 3, title: "Third" },
    ];
    const res = parseMcpFind(
      buildFindResponse("posts", docs, { totalDocs: 50, page: 1, totalPages: 1 })
    );

    expect(res.docs.map((d) => d.id)).toEqual([1, 2, 3]);
    expect(res.totalDocs).toBe(50);
  });

  it("does not break when a string field contains JSON braces (the original failure mode)", () => {
    const docs = [
      { id: 1, title: "Trends for {2026}" },
      { id: 2, title: "Plain" },
    ];
    const res = parseMcpFind(buildFindResponse("posts", docs));

    expect(res.docs).toHaveLength(2);
    expect(res.docs[0].title).toBe("Trends for {2026}");
  });

  it("reads pagination metadata", () => {
    const res = parseMcpFind(
      buildFindResponse("posts", [{ id: 1 }], { totalDocs: 250, page: 2, totalPages: 3 })
    );

    expect(res.page).toBe(2);
    expect(res.totalPages).toBe(3);
    expect(res.totalDocs).toBe(250);
  });

  it("handles a single bare-object response (findById / create / update)", () => {
    const res = parseMcpFind(buildSingleResponse("posts", { id: 99, title: "Single" }));

    expect(res.docs).toHaveLength(1);
    expect(res.docs[0].id).toBe(99);
  });

  it("handles a legacy { docs: [...] } object response", () => {
    const res = parseMcpFind({
      content: [{ type: "text", text: JSON.stringify({ docs: [{ id: 7 }], totalDocs: 1 }) }],
    });

    expect(res.docs.map((d) => d.id)).toEqual([7]);
  });

  it("returns no docs for an empty result", () => {
    const res = parseMcpFind(
      buildFindResponse("posts", [], { totalDocs: 0, page: 1, totalPages: 0 })
    );

    expect(res.docs).toHaveLength(0);
    expect(res.totalDocs).toBe(0);
  });

  it("returns no docs for an error response (no throw)", () => {
    const res = parseMcpFind({
      content: [{ type: "text", text: "❌ **Error reading resources:** something failed" }],
    });

    expect(res.docs).toHaveLength(0);
  });

  it("skips an unparseable fence but keeps the valid ones", () => {
    const text =
      'Collection: "posts"\nTotal: 2 documents\nPage: 1 of 1\n' +
      "\n```json\n{ not valid json ]\n```" +
      '\n```json\n{"id":2}\n```';
    const res = parseMcpFind({ content: [{ type: "text", text }] });

    expect(res.docs.map((d) => d.id)).toEqual([2]);
  });
});

describe("parseMcpDoc", () => {
  it("returns the first document of a response", () => {
    expect(parseMcpDoc(buildSingleResponse("posts", { id: 5 }))?.id).toBe(5);
    expect(parseMcpDoc(buildFindResponse("posts", [{ id: 1 }, { id: 2 }]))?.id).toBe(1);
  });

  it("returns null when there are no documents", () => {
    expect(parseMcpDoc(buildFindResponse("posts", []))).toBeNull();
  });

  it("reads a document with a field named docs as the document, not as a page of a list", () => {
    expect(parseMcpDoc(buildSingleResponse("posts", { id: 7, docs: [3, 4] }))?.id).toBe(7);
    expect(parseMcpDoc(buildSingleResponse("posts", { id: 8, docs: [{ id: "r1" }] }))?.id).toBe(8);
  });
});

describe("mcpText", () => {
  it("reads the text payload, falling back to stringification", () => {
    expect(mcpText({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
    expect(mcpText("raw string")).toBe("raw string");
    expect(mcpText({ foo: "bar" })).toContain("foo");
  });
});

describe("MCP fence parsing vs fences inside document text", () => {
  it('a findById doc whose text contains "```json" still parses as a bare object', () => {
    const doc = { id: 7, title: "Markdown guide", note: "use ```json fences for examples" };
    const result = {
      content: [{ text: `Resource from collection "posts":\n${JSON.stringify(doc)}` }],
    };

    expect(parseMcpDoc(result)).toEqual(doc);
  });

  it("a list doc containing the fence substring is not dropped", () => {
    const d1 = { id: 1, body: "about ```json blocks" };
    const d2 = { id: 2, body: "plain" };
    const text = `Collection: "posts"\nTotal: 2 documents\nPage: 1 of 1\n\`\`\`json\n${JSON.stringify(d1)}\n\`\`\`\n\`\`\`json\n${JSON.stringify(d2)}\n\`\`\``;
    const parsed = parseMcpFind({ content: [{ text }] });

    expect(parsed.docs).toHaveLength(2);
    expect(parsed.docs[0].id).toBe(1);
    expect(parsed.docs[1].id).toBe(2);
  });
});
