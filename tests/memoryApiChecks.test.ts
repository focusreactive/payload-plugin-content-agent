import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();

  return { ...actual, generateText: vi.fn() };
});

vi.mock("../src/agent/index.js", () => ({
  runAgent: vi.fn(async () => new Response("ok", { status: 200 })),
}));

vi.mock("../src/agent/tools/web.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/agent/tools/web.js")>();

  return { ...actual, safeFetch: vi.fn() };
});

import { generateText } from "ai";
import { runAgent } from "../src/agent/index.js";
import { safeFetch } from "../src/agent/tools/web.js";
import { createImportArticleTool } from "../src/agent/tools/importArticle.js";
import { createChatHandler } from "../src/api/chatEndpoint.js";
import { createReviewHandlers } from "../src/api/reviewEndpoint.js";
import { DEFAULT_CONTEXT_BUDGET } from "../src/memory/contextAssembler.js";
import { runDistillation } from "../src/memory/distillation.js";
import { runLtmCuration } from "../src/memory/ltmCurator.js";
import { PendingBulkStorage } from "../src/memory/storage/pendingBulk.js";
import { introspectSchema } from "../src/schema/introspector.js";
import type { ResolvedPluginOptions, SchemaContext } from "../src/types.js";

const workers = () => ({
  startWorkerIfNotRunning: vi.fn(async () => ({ id: "w1" })),
  completeWorker: vi.fn(async () => {}),
  failWorker: vi.fn(async () => {}),
  addReport: vi.fn(async () => {}),
});

const message = (id: string, tokenEstimate = 100) => ({
  id,
  conversationId: "c",
  type: "user" as const,
  content: `msg ${id}`,
  tokenEstimate,
  createdAt: new Date(),
});

beforeEach(() => {
  vi.mocked(generateText).mockReset();
  vi.mocked(runAgent).mockClear();
});

describe("distillation with no recency buffer", () => {
  it("distills every uncovered message when recencyBufferMessages is 0", async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: { narrative: "a summary", keyObservations: [], tags: [] },
    } as any);
    const messages = ["01", "02", "03", "04", "05"].map((id) => message(id));
    const addSummary = vi.fn(async (params: any) => ({ id: "s1", ...params }));
    const memory: any = {
      backgroundReports: workers(),
      temporal: {
        getMessages: vi.fn(async () => messages),
        getSummaries: vi.fn(async () => []),
        getMaxOrderNum: vi.fn(async () => 0),
        addSummary,
      },
      embeddings: null,
    };

    await runDistillation("c", memory, {} as any, {
      ...DEFAULT_CONTEXT_BUDGET,
      recencyBufferMessages: 0,
    });

    expect(addSummary).toHaveBeenCalledTimes(1);
    expect(addSummary.mock.calls[0][0]).toMatchObject({ startId: "01", endId: "05" });
  });
});

const curate = async (action: Record<string, unknown>) => {
  vi.mocked(generateText).mockResolvedValue({ output: { actions: [action] } } as any);
  const embedLtmEntry = vi.fn(async () => {});
  const memory: any = {
    backgroundReports: workers(),
    temporal: {
      getMessages: vi.fn(async () => ["1", "2", "3", "4", "5"].map((id) => message(id, 300))),
    },
    ltm: {
      listAllWithShared: vi.fn(async () => []),
      update: vi.fn(async () => ({ slug: "tone", title: "Stored title", body: "Stored body" })),
    },
    embeddings: { embedLtmEntry },
  };

  await runLtmCuration("c", "user-1", memory, {} as any);

  return embedLtmEntry;
};

describe("curator update", () => {
  it("embeds the stored entry again when only the body changed", async () => {
    const embedLtmEntry = await curate({ type: "update", slug: "tone", body: "Stored body" });

    expect(embedLtmEntry).toHaveBeenCalledWith("user-1", "tone", "Stored title\nStored body");
  });

  it("embeds the stored entry again when only the title changed", async () => {
    const embedLtmEntry = await curate({ type: "update", slug: "tone", title: "Stored title" });

    expect(embedLtmEntry).toHaveBeenCalledWith("user-1", "tone", "Stored title\nStored body");
  });

  it("does not embed when the update changes no text", async () => {
    const embedLtmEntry = await curate({ type: "update", slug: "tone" });

    expect(embedLtmEntry).not.toHaveBeenCalled();
  });
});

const request = (body: unknown, json?: () => Promise<unknown>) => {
  const payload = { update: vi.fn(async () => ({})), updateGlobal: vi.fn(async () => ({})) };

  return { req: { user: { id: "u1" }, data: body, json, payload } as any, payload };
};

describe("publish endpoint", () => {
  const { publish } = createReviewHandlers(
    async () => ({ globals: [], collections: [] }),
    async () => null
  );

  it("publishes a global once and reports every id sent for it", async () => {
    const { req, payload } = request({ collection: "global:settings", ids: ["a", "b", "c"] });
    const res = (await publish(req)) as Response;
    const body = await res.json();

    expect(payload.updateGlobal).toHaveBeenCalledTimes(1);
    expect(payload.update).not.toHaveBeenCalled();
    expect(body.published).toBe(3);
    expect(body.results.map((result: any) => result.id)).toEqual(["a", "b", "c"]);
  });

  it("reports the one failure of a global for every id", async () => {
    const { req, payload } = request({ collection: "global:settings", ids: ["a", "b"] });

    payload.updateGlobal.mockRejectedValue(new Error("Forbidden"));
    const body = await ((await publish(req)) as Response).json();

    expect(payload.updateGlobal).toHaveBeenCalledTimes(1);
    expect(body.failed).toBe(2);
    expect(body.results[1]).toEqual({ id: "b", ok: false, error: "Forbidden" });
  });

  it("still publishes each document of a collection", async () => {
    const { req, payload } = request({ collection: "posts", ids: [1, 2] });

    await publish(req);

    expect(payload.update).toHaveBeenCalledTimes(2);
  });

  it("keeps the lock of a person who has the document or the global open", async () => {
    for (const collection of ["posts", "global:settings"]) {
      const { req, payload } = request({ collection, ids: [1] });

      await publish(req);
      const [call] = [...payload.update.mock.calls, ...payload.updateGlobal.mock.calls] as any[];

      expect(call[0]).toMatchObject({ overrideLock: false });
    }
  });

  it.each([
    ["an id that is an object", { collection: "posts", ids: [{ id: 1 }] }],
    ["a collection that is not text", { collection: 5, ids: [1] }],
    ["a body that is a list", [1, 2]],
  ])("answers 400 to %s", async (_label, body) => {
    const { req, payload } = request(body);
    const res = (await publish(req)) as Response;

    expect(res.status).toBe(400);
    expect(payload.update).not.toHaveBeenCalled();
  });

  it("answers 400 to broken JSON", async () => {
    const { req } = request(undefined, async () => {
      throw new SyntaxError("Unexpected token");
    });

    expect(((await publish(req)) as Response).status).toBe(400);
  });
});

describe("chat endpoint body", () => {
  const schema: SchemaContext = { globals: [], collections: [] };
  const handler = createChatHandler(schema, { schemaPromptMode: "auto" } as ResolvedPluginOptions);
  const validMessage = { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] };
  let seq = 0;

  const send = (body: unknown) => {
    seq++;

    return handler({
      user: { id: `body-user-${seq}`, collection: "users" },
      json: async () => body,
    } as any) as Promise<Response>;
  };

  it.each([
    ["no parts", { id: "m1", role: "user", content: "hi" }],
    ["a part with no type", { id: "m1", role: "user", parts: ["hi"] }],
    ["a system role", { id: "m1", role: "system", parts: [] }],
  ])("refuses a message with %s", async (_label, badMessage) => {
    const res = await send({ messages: [badMessage] });

    expect(res.status).toBe(400);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("refuses a conversation id that is not text", async () => {
    const res = await send({ messages: [validMessage], conversationId: { $ne: null } });

    expect(res.status).toBe(400);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("passes only the text fields of the page context", async () => {
    await send({
      messages: [validMessage],
      conversationId: "conv-1",
      pageContext: { collection: "posts", documentId: 7, global: ["x"], extra: "y" },
    });

    expect(vi.mocked(runAgent).mock.calls[0][0]).toMatchObject({
      conversationId: "conv-1",
      pageContext: { collection: "posts", documentId: undefined, global: undefined },
    });
  });

  it("drops a page context that is not an object", async () => {
    await send({ messages: [validMessage], pageContext: "posts" });

    expect(vi.mocked(runAgent).mock.calls[0][0].pageContext).toBeUndefined();
  });
});

const stored = (state: unknown) =>
  new PendingBulkStorage({ query: vi.fn(async () => ({ rows: [{ state }] })) } as any).get(
    "conv-1",
    "editContent",
    "posts"
  );

describe("pending bulk storage", () => {
  it("returns a stored state of the known shape", async () => {
    const state = { ids: [1, "two"], instruction: "shorten", at: 1, locale: "en" };

    expect(await stored(state)).toEqual(state);
  });

  it.each([
    ["ids that are not a list", { ids: "1,2", instruction: "x", at: 1 }],
    ["no instruction", { ids: [1], at: 1 }],
    ["a locale that is not text", { ids: [1], instruction: "x", at: 1, locale: 5 }],
    ["text", "{}"],
  ])("reads a state with %s as nothing pending", async (_label, state) => {
    expect(await stored(state)).toBeNull();
  });
});

describe("block entries in the schema", () => {
  it("skips a block entry that has no field list", () => {
    const schema = introspectSchema({
      globals: [],
      collections: [
        {
          slug: "pages",
          fields: [
            {
              name: "layout",
              type: "blocks",
              blocks: [
                { slug: "hero", fields: [{ name: "heading", type: "text" }] },
                { slug: "broken" },
              ],
            },
          ],
        },
      ],
    } as any);
    const layout = schema.collections[0].fields.find((field) => field.name === "layout");

    expect(layout?.blocks?.map((block) => block.slug)).toEqual(["hero"]);
  });
});

describe("import of a page with no HTML", () => {
  const schema: SchemaContext = {
    globals: [],
    collections: [
      {
        slug: "posts",
        hasVersions: true,
        hasDrafts: true,
        hasAuth: false,
        timestamps: true,
        fields: [
          { name: "title", type: "text" },
          { name: "content", type: "richText" },
        ],
      },
    ],
  };

  const importFrom = async (body: string) => {
    vi.mocked(safeFetch).mockResolvedValue({
      res: new Response(body, { status: 200 }),
      finalUrl: "https://example.com/a",
    });
    const io = { create: vi.fn(), transports: vi.fn(() => ({ create: "local" })) };
    const tool = createImportArticleTool(io as any, schema);
    const result: any = await tool.execute!({ url: "https://example.com/a", collection: "posts" }, {
      toolCallId: "t1",
      messages: [],
    } as any);

    return { result, io };
  };

  it.each([
    ["an empty body", ""],
    ["plain text", "not html"],
  ])("returns an error that names the next call for %s", async (_label, body) => {
    const { result, io } = await importFrom(body);

    expect(result.error).toContain('web with action "fetch"');
    expect(io.create).not.toHaveBeenCalled();
  });
});
