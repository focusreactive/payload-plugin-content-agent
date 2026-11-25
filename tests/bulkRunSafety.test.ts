import { describe, it, expect, vi } from "vitest";

import { runBulk } from "../src/agent/content/bulk.js";
import { createTurnApprovals, decideApproval } from "../src/agent/approvals.js";
import { bodyHint, proseLength } from "../src/agent/content/bodyHint.js";
import { capMcpToolOutput } from "../src/agent/tools/outputCap.js";
import type { SchemaField } from "../src/types.js";
import { parseApprovalRequest } from "../src/approvalRequest.js";

describe("runBulk: per-request time budget", () => {
  it("stops STARTING documents at the deadline, finishes the ones in flight, returns the rest as remaining in order", async () => {
    let now = 1_000_000;

    vi.spyOn(Date, "now").mockImplementation(() => now);
    const started: (string | number)[] = [];
    const worker = vi.fn(async (id: string | number) => {
      started.push(id);
      now += 100;

      return { id, status: "done" as const };
    });
    const r = await runBulk([1, 2, 3, 4, 5, 6, 7, 8], worker, {
      op: "bulkEditContent",
      collection: "posts",
      concurrency: 1,
      deadline: 1_000_000 + 350,
    });

    vi.restoreAllMocks();
    expect(started).toEqual([1, 2, 3, 4]);
    expect(r.done).toBe(4);
    expect(r.remaining).toEqual([5, 6, 7, 8]);
    expect(r.results.map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(r.skipped).toBe(0);
  });

  it("runs everything when there is no deadline", async () => {
    const r = await runBulk([1, 2, 3], async (id) => ({ id, status: "done" as const }), {
      op: "x",
      collection: "posts",
      concurrency: 2,
    });

    expect(r.done).toBe(3);
    expect(r.remaining).toEqual([]);
  });
});

describe("listDocuments output: ids survive the size cap", () => {
  it("trims docs rows but keeps every id", () => {
    const docs = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      title: `Post ${i + 1}`,
      excerpt: "x".repeat(600),
    }));
    const out = capMcpToolOutput({
      collection: "posts",
      page: 1,
      totalPages: 2,
      totalDocs: 153,
      returned: 100,
      docs,
      ids: docs.map((d) => d.id),
    });
    const parsed = typeof out === "string" ? JSON.parse(out) : out;

    expect(parsed.docs.length).toBeLessThan(100);
    expect(parsed.ids).toHaveLength(100);
    expect(parsed.ids[99]).toBe(100);
  });
});

describe("bodyHint: the body is the field that holds the prose", () => {
  const fields: SchemaField[] = [
    { name: "title", type: "text" },
    { name: "content", type: "richText", editor: "lexical" },
    { name: "contentMarkdown", type: "textarea" },
    { name: "excerpt", type: "textarea" },
  ] as SchemaField[];
  const heading = {
    root: {
      type: "root",
      children: [
        {
          type: "heading",
          children: [{ type: "text", text: "Storyblok CMS: Content Control, Unlocked" }],
        },
      ],
    },
  };

  it("points at the Markdown field when the rich text field holds one heading", () => {
    const hint = bodyHint(fields, {
      title: "t",
      content: heading,
      contentMarkdown: "## TL;DR\n\n" + "prose ".repeat(400),
      excerpt: "short",
    });

    expect(hint?.ref).toBe("contentMarkdown");
    expect(hint?.others.map((o) => o.ref)).toEqual(["content", "excerpt"]);
    expect(hint?.note).toMatch(/not the one whose name sounds like it/u);
    expect(proseLength(heading)).toBe(40);
  });

  it("points at the rich text field when that is where the article is", () => {
    const rich = {
      root: {
        type: "root",
        children: Array.from({ length: 30 }, () => ({
          type: "paragraph",
          children: [{ type: "text", text: "A paragraph of real article text. " }],
        })),
      },
    };
    const hint = bodyHint(fields, { content: rich, contentMarkdown: "", excerpt: "short" });

    expect(hint?.ref).toBe("content");
  });

  it("counts the prose inside embedded blocks of the rich text field", () => {
    const nested = {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "A paragraph inside the block. ".repeat(27) }],
          },
        ],
      },
    };
    const blocky = {
      root: {
        type: "root",
        children: [
          {
            type: "block",
            fields: { id: "b1", blockType: "section", heading: "Why it matters", content: nested },
          },
        ],
      },
    };

    expect(proseLength(blocky)).toBe(
      "Why it matters".length + "A paragraph inside the block. ".repeat(27).length
    );
    expect(
      bodyHint(fields, { content: blocky, contentMarkdown: "", excerpt: "x".repeat(600) })?.ref
    ).toBe("content");
  });

  it("stays silent when there is nothing to disambiguate", () => {
    expect(
      bodyHint([{ name: "content", type: "richText" }] as SchemaField[], { content: heading })
    ).toBeNull();
    expect(bodyHint(fields, { content: heading, contentMarkdown: "tiny", excerpt: "" })).toBeNull();
  });
});

describe("editContent on many: `where` lets the tool count the documents", () => {
  it("pages through the whole collection and puts the exact total in the confirmation", async () => {
    const { createContentEditorTools } = await import("../src/agent/content/contentEditor.js");
    const schema = {
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
    } as any;
    const pages: Record<number, any[]> = {
      1: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })),
      2: Array.from({ length: 57 }, (_, i) => ({ id: 101 + i })),
    };
    const io = {
      list: vi.fn(async (_c: string, o: any) => ({
        docs: pages[o.page] ?? [],
        totalDocs: 157,
        totalPages: 2,
      })),
      read: vi.fn(),
      write: vi.fn(),
      transports: () => ({ read: "local", write: "local", create: "local" }),
    } as any;
    const approvals = createTurnApprovals();

    createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 5,
      approvals,
    });
    const asked = await decideApproval(approvals, {
      toolName: "editContent",
      toolCallId: "t",
      input: {
        collection: "posts",
        where: '{"_status":{"equals":"published"}}',
        instruction: "append the note",
      },
    });

    expect(parseApprovalRequest(asked?.reason)).toMatchObject({
      kind: "edit",
      collection: "posts",
      count: 157,
      instruction: "append the note",
    });
    expect(approvals.scopes.get("t")).toHaveLength(157);
    expect(io.list).toHaveBeenCalledTimes(3);
    expect(io.list.mock.calls[0][1].where).toEqual({ _status: { equals: "published" } });
    expect(io.list.mock.calls[0][1].draft).toBe(false);
  });

  it("lists latest versions for any other filter", async () => {
    const { createContentEditorTools } = await import("../src/agent/content/contentEditor.js");
    const schema = {
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
    } as any;
    const io = {
      list: vi.fn(async () => ({ docs: [{ id: 1 }], totalDocs: 1, totalPages: 1 })),
    } as any;
    const tools = createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 5,
    });

    await (
      tools.editContent.execute!(
        { collection: "posts", where: '{"title":{"like":"Sanity"}}', instruction: "x" } as any,
        { toolCallId: "t", messages: [] } as any
      ) as Promise<unknown>
    ).catch(() => {});
    expect(io.list.mock.calls[0][1].draft).toBeUndefined();
  });

  it("refuses a malformed where and an empty call", async () => {
    const { createContentEditorTools } = await import("../src/agent/content/contentEditor.js");
    const schema = {
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
    } as any;
    const tools = createContentEditorTools({
      io: { list: vi.fn() } as any,
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const ctx = { toolCallId: "t", messages: [] } as any;

    expect(
      (
        (await tools.editContent.execute!(
          { collection: "posts", where: "nope", instruction: "x" } as any,
          ctx
        )) as any
      ).error
    ).toMatch(/JSON object/u);
    expect(
      (
        (await tools.editContent.execute!(
          { collection: "posts", instruction: "x" } as any,
          ctx
        )) as any
      ).error
    ).toMatch(/where/u);
  });
});
