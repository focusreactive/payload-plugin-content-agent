import { describe, it, expect, vi, afterEach } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import * as mcpClient from "../src/agent/mcpClient.js";
import { createTurnApprovals, liveKey } from "../src/agent/approvals.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import {
  bulkCount,
  confirmDocuments,
  documentsAfter,
  manyDocumentsRefusal,
  requestApprovals,
} from "../src/agent/content/manyDocuments.js";
import { BULK_CONFIRM_THRESHOLD, unapprovedBulkRefusal } from "../src/agent/content/bulk.js";
import type { SchemaContext } from "../src/types.js";
import { fakeMemory, streamEvents, turnBody } from "./harness.js";
import { parseApprovalRequest } from "../src/approvalRequest.js";

afterEach(() => vi.restoreAllMocks());

const posts = { collection: "posts" };
const IDS = ["1", "2", "3", "4", "5", "6", "7"];

function approvalsWith(written: string[]) {
  const approvals = createTurnApprovals();

  for (const id of written) manyDocumentsRefusal(posts, { approvals, ids: [id] });

  return approvals;
}

describe("the documents a request changes without the person", () => {
  it("counts each document one time", () => {
    const approvals = approvalsWith(["1", "2", "2", "1"]);

    expect(approvals.written.size).toBe(2);
    expect(documentsAfter(approvals, posts, ["2"])).toBe(0);
    expect(documentsAfter(approvals, posts, ["2", "3"])).toBe(3);
  });

  it("lets the limit through and refuses one document more", () => {
    const approvals = approvalsWith(["1", "2", "3", "4"]);

    expect(manyDocumentsRefusal(posts, { approvals, ids: ["5"] })).toBeNull();
    expect(approvals.written.size).toBe(BULK_CONFIRM_THRESHOLD);
    expect(manyDocumentsRefusal(posts, { approvals, ids: ["3"] })).toBeNull();
    expect(manyDocumentsRefusal(posts, { approvals, ids: ["6"] })).toMatch(
      /already wrote or tried to write 5 documents.*updateDocument, editContent or translateContent/u
    );
    expect(manyDocumentsRefusal({ global: "footer" }, { approvals })).toMatch(
      /already wrote or tried to write 5/u
    );
  });

  it("opens the documents of the tool call the person confirmed, and no other", () => {
    const approvals = approvalsWith(["1", "2", "3", "4", "5"]);

    approvals.asked.add("call-6");
    expect(manyDocumentsRefusal(posts, { approvals, toolCallId: "call-7", ids: ["6"] })).toMatch(
      /Nothing was written/u
    );
    expect(manyDocumentsRefusal(posts, { approvals, toolCallId: "call-6", ids: ["6"] })).toBeNull();
    expect(approvals.written.size).toBe(5);
    expect(manyDocumentsRefusal(posts, { approvals, ids: ["6"] })).toBeNull();
    expect(manyDocumentsRefusal(posts, { approvals, ids: ["7"] })).toMatch(/Nothing was written/u);
  });

  it("has no limit where no person can be asked", () => {
    expect(manyDocumentsRefusal(posts, { ids: ["6"] })).toBeNull();
    expect(bulkCount(undefined, "posts", ["1", "2"])).toBe(2);
  });

  it("counts a run on a few documents together with the documents changed before it", () => {
    const approvals = approvalsWith(["1", "2", "3", "4"]);

    expect(bulkCount(approvals, "posts", ["5"])).toBe(5);
    expect(bulkCount(approvals, "posts", ["5", "6"])).toBe(6);
    expect(unapprovedBulkRefusal(6, false, "editContent")?.error).toMatch(
      /the request changes 6 documents.*Call editContent again/u
    );
    expect(unapprovedBulkRefusal(6, true, "editContent")).toBeNull();
  });

  it("asks again for a second run on documents the person confirmed", () => {
    const approvals = createTurnApprovals();

    confirmDocuments(approvals, posts, IDS);
    expect(documentsAfter(approvals, posts, IDS)).toBe(0);
    expect(bulkCount(approvals, "posts", IDS)).toBe(7);
  });
});

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

describe("the write layer", () => {
  it("refuses the sixth document on the Local API path, also for writes that start together", async () => {
    const approvals = createTurnApprovals();
    const update = vi.fn(async ({ id }: any) => {
      if (id === "2") throw new Error("validation failed");

      return { id };
    });
    const io = createDocumentIO({
      mcpTools: {},
      schema,
      payload: { update, find: async () => ({ docs: [] }) } as any,
      user: { id: 1, collection: "users" } as any,
      approvals,
    });
    const results = await Promise.all(
      IDS.map((id) => io.write(posts, { id, patch: { title: "New" } }))
    );

    expect(results.map((result) => (result.error ? "error" : "saved"))).toEqual([
      "saved",
      "error",
      "saved",
      "saved",
      "saved",
      "error",
      "error",
    ]);
    expect(results[1].error).toBe("validation failed");
    expect(results[5].error).toMatch(/already wrote or tried to write 5 documents/u);
    expect(results[6].error).toMatch(/already wrote or tried to write 5 documents/u);
    expect(update).toHaveBeenCalledTimes(5);
  });
});

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const inputOf = (id: string) => ({ collection: "posts", id, data: { title: "Plans for 2026" } });

const callOf = (id: string) => ({
  type: "tool-call",
  toolCallId: `call-${id}`,
  toolName: "updateDocument",
  input: JSON.stringify(inputOf(id)),
});

/** Changes the seven documents in one step: the tool calls then run at the same time. */
function parallelModel() {
  return new MockLanguageModelV3({
    doStream: async ({ prompt }: any) => {
      const answered = prompt.some((message: any) => message.role === "tool");
      const chunks = answered
        ? [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Done." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
          ]
        : [
            { type: "stream-start", warnings: [] },
            ...IDS.map(callOf),
            { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
          ];

      return { stream: simulateReadableStream({ chunks: chunks as any[] }) };
    },
  });
}

/** Changes the seven documents one after another with a direct update, as a model may. */
function directModel() {
  return new MockLanguageModelV3({
    doStream: async ({ prompt }: any) => {
      const done = prompt
        .filter((message: any) => message.role === "tool")
        .flatMap((message: any) => message.content).length;
      const id = IDS[done];
      const chunks = id
        ? [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: `call-${id}`,
              toolName: "updateDocument",
              input: JSON.stringify(inputOf(id)),
            },
            { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
          ]
        : [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Changed seven documents." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
          ];

      return { stream: simulateReadableStream({ chunks: chunks as any[] }) };
    },
  });
}

function site() {
  const saved: Record<string, any> = {};

  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(mcpClient, "getMcpTools").mockResolvedValue({
    findPosts: {
      execute: async ({ id }: any) => ({
        content: [{ text: JSON.stringify({ id, title: "Plans for 2025" }) }],
      }),
    },
    updatePosts: {
      execute: async (args: any) => {
        saved[String(args.id)] = args;

        return { content: [{ text: JSON.stringify({ id: args.id, title: args.title }) }] };
      },
    },
  } as any);

  return saved;
}

async function runTurn(messages: any[], model = directModel(), stored = fakeMemory()) {
  return streamEvents(await turnBody({ messages, schema, memory: stored, options: { model } }));
}

const person = { id: "u1", role: "user", parts: [{ type: "text", text: "Change all seven" }] };

const answered = (request: any, approved: boolean) => ({
  id: "a1",
  role: "assistant",
  parts: [
    { type: "step-start" },
    ...IDS.slice(0, 5).map((id) => ({
      type: "tool-updateDocument",
      toolCallId: `call-${id}`,
      state: "output-available",
      input: inputOf(id),
      output: { id },
    })),
    {
      type: "tool-updateDocument",
      toolCallId: "call-6",
      state: "approval-responded",
      input: inputOf("6"),
      approval: { id: request.approvalId, signature: request.signature, approved },
    },
  ],
});

describe("seven direct updates in one request, through the whole turn", () => {
  it("writes five documents and stops at a question about the sixth", async () => {
    const saved = site();
    const events = await runTurn([person]);
    const request = events.find((event) => event.type === "tool-approval-request");

    expect(Object.keys(saved).sort()).toEqual(IDS.slice(0, 5));
    expect(request).toMatchObject({ toolCallId: "call-6" });
    expect(parseApprovalRequest(request.reason)).toEqual({
      kind: "more-documents",
      changed: 5,
      collection: "posts",
      document: { id: "6" },
    });
  });

  it("writes the sixth after the click and asks again about the seventh", async () => {
    const saved = site();
    const request = (await runTurn([person])).find(
      (event) => event.type === "tool-approval-request"
    );

    const events = await runTurn([person, answered(request, true)]);

    expect(Object.keys(saved).sort()).toEqual(IDS.slice(0, 6));
    expect(events.find((event) => event.type === "tool-approval-request")).toMatchObject({
      toolCallId: "call-7",
    });
  });

  it("asks about the sixth and the seventh when all seven calls come in one step", async () => {
    const saved = site();
    const events = await runTurn([person], parallelModel());
    const asked = events
      .filter((event) => event.type === "tool-approval-request")
      .map((event) => event.toolCallId);

    expect(Object.keys(saved).sort()).toEqual(IDS.slice(0, 5));
    expect(asked.sort()).toEqual(["call-6", "call-7"]);
  });

  it("leaves the sixth and the seventh alone when the person declines", async () => {
    const saved = site();
    const request = (await runTurn([person])).find(
      (event) => event.type === "tool-approval-request"
    );
    const events = await runTurn([person, answered(request, false)]);

    expect(Object.keys(saved).sort()).toEqual(IDS.slice(0, 5));
    expect(events.some((event) => event.type === "tool-output-denied")).toBe(true);
  });

  it("stores no reply while the chat waits for the click, and the reply that follows it", async () => {
    const saved = site();
    const waiting = fakeMemory();
    const requests = (await runTurn([person], parallelModel(), waiting)).filter(
      (event) => event.type === "tool-approval-request"
    );

    expect(waiting.saveMessage).not.toHaveBeenCalledWith(
      "c-1",
      "assistant",
      expect.anything(),
      expect.anything()
    );
    const stored = fakeMemory();
    const clicked = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        ...IDS.map((id) => {
          const request = requests.find((event) => event.toolCallId === `call-${id}`);

          return request
            ? {
                type: "tool-updateDocument",
                toolCallId: `call-${id}`,
                state: "approval-responded",
                input: inputOf(id),
                approval: { id: request.approvalId, signature: request.signature, approved: true },
              }
            : {
                type: "tool-updateDocument",
                toolCallId: `call-${id}`,
                state: "output-available",
                input: inputOf(id),
                output: { id },
              };
        }),
      ],
    };

    await runTurn([person, clicked], parallelModel(), stored);

    expect(Object.keys(saved).sort()).toEqual(IDS);
    expect(stored.saveMessage).toHaveBeenCalledWith("c-1", "assistant", "Done.", []);
  });
});

const run = (input: Record<string, unknown>, ids: number[]) => ({
  type: "tool-editContent",
  toolCallId: `run-${ids[0]}`,
  state: "output-available",
  input,
  output: {
    total: ids.length,
    results: [...ids.map((id) => ({ id, status: "done" })), { id: 99, status: "unchanged" }],
  },
});

describe("the request that goes on after a click", () => {
  it("counts the documents a run selected with where, or went on with, by the ids it wrote", () => {
    const approvals = requestApprovals([
      person,
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          run({ collection: "posts", where: '{"title":{"like":"x"}}', instruction: "y" }, [1, 2]),
          run({ collection: "posts", continue: true }, [3]),
          {
            type: "tool-updateDocument",
            toolCallId: "call-10",
            state: "output-available",
            input: inputOf("10"),
            output: { id: "10" },
          },
        ],
      },
    ] as any);

    expect([...approvals.written].sort()).toEqual(
      ["1", "10", "2", "3"].map((id) => liveKey({ collection: "posts" }, id))
    );
  });
});
