import { describe, it, expect, vi, afterEach } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import * as mcpClient from "../src/agent/mcpClient.js";
import {
  askPerson,
  awaitsPerson,
  createTurnApprovals,
  decideApproval,
  personApproved,
} from "../src/agent/approvals.js";
import { askedScope, keepAskedScope } from "../src/agent/content/editorBulk.js";
import type { ContentEditorDeps } from "../src/agent/content/editorDeps.js";
import type { PendingBulk } from "../src/memory/storage/pendingBulk.js";
import type { SchemaContext } from "../src/types.js";
import { fakeMemory, streamEvents, turnBody } from "./harness.js";
import { parseApprovalRequest } from "../src/approvalRequest.js";

afterEach(() => vi.restoreAllMocks());

describe("the person's click, per tool call", () => {
  it("a tool without a policy is not asked about", async () => {
    const approvals = createTurnApprovals();
    const call = { toolName: "readDocument", toolCallId: "c1", input: {} };

    expect(await decideApproval(approvals, call)).toBeUndefined();
    expect(personApproved(approvals, "c1")).toBe(false);
  });

  it("a call counts as approved only when the chat asked about that same call", async () => {
    const approvals = createTurnApprovals();

    approvals.policies.set("editContent", () => askPerson("Edit 7 documents"));
    await decideApproval(approvals, { toolName: "editContent", toolCallId: "c1", input: {} });

    expect(personApproved(approvals, "c2")).toBe(false);
    expect(personApproved(undefined, "c1")).toBe(false);
    expect(personApproved(approvals, "c1")).toBe(true);
  });

  it("the turn waits for the person only when its last step asks about a tool call", () => {
    const asks = { type: "tool-approval-request", approvalId: "a1", toolCallId: "c1" };
    const automatic = { ...asks, isAutomatic: true };
    const result = { type: "tool-result", toolCallId: "c1" };

    expect(awaitsPerson([{ content: [result] }, { content: [asks] }])).toBe(true);
    expect(awaitsPerson([{ content: [asks] }, { content: [result] }])).toBe(false);
    expect(awaitsPerson([{ content: [automatic] }])).toBe(false);
    expect(awaitsPerson(undefined)).toBe(false);
  });

  it("a policy that throws asks nothing: the tool then refuses by itself", async () => {
    const approvals = createTurnApprovals();

    vi.spyOn(console, "warn").mockImplementation(() => {});
    approvals.policies.set("editContent", () => {
      throw new Error("the list failed");
    });
    const call = { toolName: "editContent", toolCallId: "c1", input: {} };

    expect(await decideApproval(approvals, call)).toBeUndefined();
    expect(personApproved(approvals, "c1")).toBe(false);
  });
});

const key = (...parts: string[]) => parts.join("|");

function store() {
  const rows = new Map<string, PendingBulk>();

  return {
    get: async (conversationId: string, tool: string, collection: string) =>
      rows.get(key(conversationId, tool, collection)) ?? null,
    set: async (
      conversationId: string,
      tool: string,
      collection: string,
      value: PendingBulk | null
    ) => {
      if (value) rows.set(key(conversationId, tool, collection), value);
      else rows.delete(key(conversationId, tool, collection));
    },
  };
}

const depsOf = (pendingStore: ReturnType<typeof store>, conversationId: string) =>
  ({ conversationId, pendingStore, approvals: createTurnApprovals() }) as ContentEditorDeps;

describe("the documents the person confirmed", () => {
  it("stay the same set in the request after the click, on another instance", async () => {
    const pendingStore = store();
    const first = depsOf(pendingStore, "conv-a");
    const asked = await askedScope(first, "editContent", "call-1", async () => ({
      ids: [1, 2, 3, 4, 5, 6],
    }));

    expect(asked).toEqual({ ids: [1, 2, 3, 4, 5, 6] });
    await keepAskedScope(first, "editContent", "call-1", [1, 2, 3, 4, 5, 6]);

    const grown = vi.fn(async () => ({ ids: [1, 2, 3, 4, 5, 6, 7, 8] }));
    const afterClick = depsOf(pendingStore, "conv-a");

    expect(await askedScope(afterClick, "editContent", "call-1", grown)).toEqual({
      ids: [1, 2, 3, 4, 5, 6],
    });
    expect(grown).not.toHaveBeenCalled();
  });

  it("are read once per request for a call that needs no click", async () => {
    const deps = depsOf(store(), "conv-b");
    const resolve = vi.fn(async () => ({ ids: [1, 2] }));

    await askedScope(deps, "editContent", "call-1", resolve);
    await askedScope(deps, "editContent", "call-1", resolve);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("are not shared between conversations", async () => {
    const pendingStore = store();

    await keepAskedScope(depsOf(pendingStore, "conv-c"), "editContent", "call-1", [1, 2, 3]);
    const other = await askedScope(depsOf(pendingStore, "conv-d"), "editContent", "call-1", () =>
      Promise.resolve({ ids: [9] })
    );

    expect(other).toEqual({ ids: [9] });
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
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const IDS = ["1", "2", "3", "4", "5", "6"];
const TOOL_INPUT = { collection: "posts", find: "2025", replace: "2026", ids: IDS };

/** Calls the bulk tool in the first step of a conversation and answers in words after it. */
function bulkModel(toolAlreadyCalled: boolean) {
  let calls = toolAlreadyCalled ? 1 : 0;

  return new MockLanguageModelV3({
    doStream: async () => {
      calls += 1;
      const chunks =
        calls === 1
          ? [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "findReplaceContent",
                input: JSON.stringify(TOOL_INPUT),
              },
              { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "Replaced in six documents." },
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

        return { content: [{ text: "{}" }] };
      },
    },
  } as any);

  return saved;
}

async function runTurn(messages: any[], mem: any = fakeMemory()) {
  const body = await turnBody({
    messages,
    schema,
    memory: mem,
    options: { model: bulkModel(messages.length > 1) },
  });

  return { events: streamEvents(body), mem };
}

const person = { id: "u1", role: "user", parts: [{ type: "text", text: "Replace 2025 by 2026" }] };

const answered = (request: any, approval: Record<string, unknown>) => ({
  id: "a1",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "tool-findReplaceContent",
      toolCallId: "call-1",
      state: "approval-responded",
      input: TOOL_INPUT,
      approval: {
        id: request.approvalId,
        ...(request.signature ? { signature: request.signature } : {}),
        ...approval,
      },
    },
  ],
});

async function askedTurn() {
  const saved = site();
  const { events, mem } = await runTurn([person]);
  const request = events.find((event) => event.type === "tool-approval-request");

  return { saved, request, mem };
}

describe("a run on more than five documents, through the whole turn", () => {
  it("stops at a signed request to the person and writes nothing", async () => {
    const { saved, request, mem } = await askedTurn();

    expect(request).toMatchObject({ toolCallId: "call-1" });
    expect(parseApprovalRequest(request.reason)).toMatchObject({
      kind: "replace",
      collection: "posts",
      count: 6,
      find: "2025",
      replace: "2026",
    });
    expect(typeof request.signature).toBe("string");
    expect(Object.keys(saved)).toHaveLength(0);
    expect(mem.saveMessage.mock.calls.map(([, type]: unknown[]) => type)).toEqual(["user"]);
  });

  it("runs after the click and stores one reply, with no second copy of the request", async () => {
    const { saved, request } = await askedTurn();
    const { events, mem } = await runTurn([person, answered(request, { approved: true })]);

    expect(Object.keys(saved).sort()).toEqual(IDS);
    expect(saved["1"].title).toBe("Plans for 2026");
    expect(events.some((event) => event.type === "tool-output-available")).toBe(true);
    await vi.waitFor(() =>
      expect(mem.saveMessage.mock.calls.map(([, type]: unknown[]) => type)).toEqual(["assistant"])
    );
    expect(mem.saveMessage.mock.calls[0][2]).toBe("Replaced in six documents.");
  });

  it("goes on in the message that asked, not in a second one", async () => {
    const { request } = await askedTurn();
    const { events } = await runTurn([person, answered(request, { approved: true })]);

    expect(events.find((event) => event.type === "start")).toMatchObject({ messageId: "a1" });
  });

  it("writes nothing when the person declines", async () => {
    const { saved, request } = await askedTurn();
    const { events } = await runTurn([
      person,
      answered(request, { approved: false, reason: "The person declined." }),
    ]);

    expect(Object.keys(saved)).toHaveLength(0);
    expect(events.some((event) => event.type === "tool-output-denied")).toBe(true);
  });

  it("refuses an approval the server did not sign", async () => {
    const { saved, request } = await askedTurn();

    await runTurn([person, answered({ approvalId: request.approvalId }, { approved: true })]);
    await runTurn([
      person,
      answered({ ...request, signature: `${request.signature}0` }, { approved: true }),
    ]);

    expect(Object.keys(saved)).toHaveLength(0);
  });

  it("stores the reply with a note when the person writes instead of clicking", async () => {
    const { saved, request } = await askedTurn();
    const pending = answered(request, {});

    pending.parts[1].state = "approval-requested";
    const next = { id: "u2", role: "user", parts: [{ type: "text", text: "Never mind." }] };
    const { mem } = await runTurn([person, pending, next]);

    expect(Object.keys(saved)).toHaveLength(0);
    const stored = mem.saveMessage.mock.calls.map(([, type]: unknown[]) => type);

    expect(stored.slice(0, 2)).toEqual(["assistant", "user"]);
    expect(mem.saveMessage.mock.calls[0][2]).toContain("the change in the card was not made");
  });
});
