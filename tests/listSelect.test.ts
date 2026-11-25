import { describe, expect, it, vi } from "vitest";
import { decideApproval, createTurnApprovals } from "../src/agent/approvals.js";
import { shownDocuments } from "../src/agent/content/approvalDocuments.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import type { DocumentIO, ListOptions } from "../src/agent/content/documentIo.js";
import { emptySelectionNote, resolveBulkWhere } from "../src/agent/content/editorBulk.js";
import { createLookupTools } from "../src/agent/content/lookupTools.js";
import { resolveLinkTargets } from "../src/agent/content/linkTargets.js";
import { listDocuments } from "../src/agent/tools/documents/listDocuments.js";
import { findDocuments } from "../src/agent/tools/findDocuments.js";
import { labelSelect } from "../src/schema/docLabel.js";
import type { SchemaContext } from "../src/types.js";

const posts = {
  slug: "posts",
  useAsTitle: "title",
  fields: [
    { name: "title", type: "text" },
    { name: "body", type: "richText" },
  ],
};
const untitled = { slug: "events", fields: [{ name: "starts", type: "date" }] };
const schema = { collections: [posts, untitled], globals: [] } as unknown as SchemaContext;

/** A list of `total` documents in pages of 100 that records every call. */
const pagedIo = (total: number) => {
  const calls: ListOptions[] = [];

  const list = async (_collection: string, opts: ListOptions = {}) => {
    calls.push(opts);
    const page = opts.page ?? 1;
    const ids = Array.from({ length: total }, (_, index) => index + 1);

    return {
      docs: ids.slice((page - 1) * 100, page * 100).map((id) => ({ id })),
      totalDocs: total,
      totalPages: Math.ceil(total / 100),
    };
  };

  return { calls, io: { list } as unknown as DocumentIO };
};

describe("a bulk selection reads ids, not whole documents", () => {
  it("asks every page for the id only and keeps every id", async () => {
    const { calls, io } = pagedIo(191);
    const resolved = await resolveBulkWhere({ io, schema } as never, "posts", "{}");

    expect(resolved).toMatchObject({ total: 191 });
    expect("ids" in resolved && resolved.ids).toHaveLength(191);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.select).toEqual({ id: true });
  });

  it("stops before the next page when the request is stopped", async () => {
    const { calls, io } = pagedIo(191);
    const controller = new AbortController();
    const list = io.list;

    io.list = async (collection, opts) => {
      controller.abort();

      return list(collection, opts);
    };

    const resolved = await resolveBulkWhere({ io, schema } as never, "posts", "{}", {
      signal: controller.signal,
    });

    expect(resolved).toEqual({
      error: "The request was stopped before the documents were selected.",
    });
    expect(calls).toHaveLength(1);
  });

  it("counts the collection with ids only when the selection is empty", async () => {
    const { calls, io } = pagedIo(3);

    await emptySelectionNote({ io, schema } as never, "posts", undefined);
    expect(calls[0]?.select).toEqual({ id: true });
  });
});

describe("the confirmation card reads titles only", () => {
  it("selects the title field of the collection", async () => {
    const { calls, io } = pagedIo(2);

    await shownDocuments({ io, schema, collection: "posts", ids: [1, 2] });
    expect(calls[0]?.select).toEqual({ title: true });
  });

  it("selects the id when the collection has no title field", async () => {
    const { calls, io } = pagedIo(2);

    await shownDocuments({ io, schema, collection: "events", ids: [1, 2] });
    expect(calls[0]?.select).toEqual({ id: true });
  });
});

describe("list passes select to the transport", () => {
  const page = { content: [{ type: "text", text: JSON.stringify([{ id: 1 }]) }] };
  const findTool = (properties: Record<string, unknown>) => ({
    inputSchema: { jsonSchema: { type: "object", properties } },
    execute: vi.fn(async (_input: Record<string, unknown>) => page),
  });

  it("sends it to a site find tool that declares it", async () => {
    const findPosts = findTool({ where: {}, limit: {}, page: {}, draft: {}, select: {} });
    const io = createDocumentIO({ mcpTools: { findPosts } as never, schema });

    await io.list("posts", { select: { id: true } });
    expect(findPosts.execute.mock.calls[0]?.[0]).toMatchObject({ select: { id: true } });
  });

  it("leaves it out for a find tool without it, and the list still answers", async () => {
    const findPosts = findTool({ where: {}, limit: {}, page: {}, draft: {} });
    const io = createDocumentIO({ mcpTools: { findPosts } as never, schema });
    const listed = await io.list("posts", { select: { id: true } });

    expect(findPosts.execute.mock.calls[0]?.[0]).not.toHaveProperty("select");
    expect(listed.error).toBeUndefined();
    expect(listed.docs).toEqual([{ id: 1 }]);
  });

  it("sends it to the Local API", async () => {
    const find = vi.fn(async (_args: Record<string, unknown>) => ({
      docs: [],
      totalDocs: 0,
      totalPages: 1,
    }));
    const io = createDocumentIO({
      mcpTools: {},
      schema,
      payload: { find } as never,
      user: { id: 1 } as never,
    });

    await io.list("posts", { select: { title: true } });
    expect(find.mock.calls[0]?.[0]).toMatchObject({ select: { title: true } });
  });
});

describe("the approval check gets the request's signal", () => {
  it("passes it to the policy of the tool", async () => {
    const approvals = createTurnApprovals();
    const policy = vi.fn(() => undefined);
    const { signal } = new AbortController();

    approvals.policies.set("editContent", policy);
    await decideApproval(
      approvals,
      { toolName: "editContent", toolCallId: "c1", input: {} },
      signal
    );
    expect(policy).toHaveBeenCalledWith({}, "c1", signal);
  });
});

const articles = {
  slug: "articles",
  useAsTitle: "title",
  hasDrafts: true,
  fields: [
    { name: "title", type: "text" },
    { name: "slug", type: "text", unique: true },
    { name: "body", type: "richText" },
    { name: "meta", type: "group", fields: [{ name: "summary", type: "textarea" }] },
  ],
};
const notes = { slug: "notes", hasDrafts: false, fields: [{ name: "title", type: "text" }] };
const labelled = { collections: [articles, notes], globals: [] } as unknown as SchemaContext;

const recordingIo = () => {
  const calls: ListOptions[] = [];
  const io = {
    transports: () => ({ read: "local", write: "local", create: "local" }),
    list: async (_collection: string, opts: ListOptions = {}) => {
      calls.push(opts);

      return {
        docs: [{ id: 5, title: "Intro", slug: "intro", _status: "draft" }],
        totalDocs: 1,
        totalPages: 1,
      };
    },
  } as unknown as DocumentIO;

  return { calls, io };
};

const ARTICLE_LABEL = { id: true, title: true, slug: true, _status: true };

describe("a list row reads its label fields only", () => {
  it("selects the title, the key fields and the draft status", () => {
    expect(labelSelect(articles as never)).toEqual(ARTICLE_LABEL);
    expect(labelSelect(notes as never)).toEqual({ id: true, title: true });
  });

  it("findDocuments asks for them", async () => {
    const { calls, io } = recordingIo();

    await findDocuments(
      { io, schema: labelled, searchable: [articles] as never },
      { query: "intro" }
    );
    expect(calls[0]?.select).toEqual(ARTICLE_LABEL);
  });

  it("lookupDocuments asks for them", async () => {
    const { calls, io } = recordingIo();
    const { lookupDocuments } = createLookupTools(io, labelled) as any;

    await lookupDocuments.execute(
      { collection: "articles", query: "intro" },
      { toolCallId: "t", messages: [] }
    );
    expect(calls[0]?.select).toEqual(ARTICLE_LABEL);
  });

  it("the link check asks for them on every read", async () => {
    const { calls, io } = recordingIo();

    await resolveLinkTargets({ io, schema: labelled }, [
      {
        fieldRef: "body",
        linkType: "internal",
        doc: { relationTo: "articles", value: 5 },
        text: "a",
      },
      { fieldRef: "body", linkType: "custom", url: "https://example.test/blog/intro", text: "b" },
    ]);
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) expect(call.select).toEqual(ARTICLE_LABEL);
  });
});

describe("listDocuments reads the fields a call keeps", () => {
  it("selects the top-level field of each path, and ids only for the published check", async () => {
    const { calls, io } = recordingIo();

    await listDocuments(io, labelled, {
      collection: "articles",
      fields: ["title", "meta.summary"],
    });
    expect(calls[0]?.select).toEqual({ id: true, title: true, meta: true, _status: true });
    expect(calls[1]?.select).toEqual({ id: true });
  });

  it("reads whole rows when no fields are named", async () => {
    const { calls, io } = recordingIo();

    await listDocuments(io, labelled, { collection: "articles" });
    expect(calls[0]).not.toHaveProperty("select");
  });
});
