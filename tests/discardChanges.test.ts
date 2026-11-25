import { describe, expect, it, vi } from "vitest";
import { planRestore } from "../src/agent/content/restorePlan.js";
import { localeStateBeforeWrite } from "../src/agent/content/localeState.js";
import { createEditRecorder } from "../src/agent/tools/index.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { createDiscardHandler } from "../src/api/reviewDiscard.js";
import type { StoredChange } from "../src/memory/storage/changesets.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const fields = [
  { name: "summary", type: "textarea", localized: true },
  { name: "owner", type: "relationship", relationTo: "people" },
  { name: "rows", type: "array", fields: [{ name: "label", type: "text" }] },
  { name: "stamp", type: "text", readOnly: true },
] as SchemaField[];

const schema: SchemaContext = {
  globals: [{ slug: "settings", fields: [{ name: "motto", type: "text" }], hasDrafts: true }],
  collections: [
    {
      slug: "notes",
      fields,
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
  locales: ["en", "de"],
  defaultLocale: "en",
} as SchemaContext;

const before = { id: 7, summary: "old", owner: 1, rows: [{ id: "a", label: "one" }], stamp: "x" };
const after = { ...before, summary: "new", rows: [...before.rows, { label: "two" }], stamp: "y" };

describe("what a discard writes", () => {
  it("brings back the fields the change set and leaves the rest", () => {
    const plan = planRestore(fields, { restore: before, after, current: after });

    expect(plan.restored).toEqual(["summary", "rows"]);
    expect(plan.patch).toEqual({ summary: "old", rows: before.rows });
    expect(plan.changedSince).toEqual([]);
  });

  it("keeps a field someone changed after the agent, until the person insists", () => {
    const current = { ...after, summary: "a person wrote this" };
    const plan = planRestore(fields, { restore: before, after, current });

    expect(plan.restored).toEqual(["rows"]);
    expect(plan.changedSince).toEqual(["summary"]);
    expect(planRestore(fields, { restore: before, after, current }, true).patch.summary).toBe(
      "old"
    );
  });

  it("reads a stored version in any key order and with the row ids the CMS gave at the save", () => {
    const current = {
      rows: [
        { label: "one", id: "a" },
        { label: "two", id: "given-at-save" },
      ],
      owner: 1,
      summary: "new",
      id: 7,
    };
    const plan = planRestore(fields, { restore: before, after, current });

    expect(plan.changedSince).toEqual([]);
    expect(plan.restored).toEqual(["summary", "rows"]);
  });

  it("reads an empty value the same as a missing key", () => {
    const restore = { id: 7, rows: [{ id: "a" }] };
    const current = { id: 7, summary: null, rows: [{ id: "a", label: null }] };
    const plan = planRestore(fields, { restore, after, current });

    expect(plan).toEqual({ patch: {}, restored: [], changedSince: [] });
  });

  it("writes nothing when the document is already as before", () => {
    const plan = planRestore(fields, { restore: before, after, current: before });

    expect(plan).toEqual({ patch: {}, restored: [], changedSince: [] });
  });

  it("asks before it restores from a change whose result was not stored", () => {
    const plan = planRestore(fields, { restore: before, after: null, current: after });

    expect(plan.restored).toEqual([]);
    expect(plan.changedSince).toEqual(["summary", "rows"]);
  });

  it("writes null for a value the stored version does not have", () => {
    const plan = planRestore(
      fields,
      { restore: { id: 7 }, after: { id: 7, summary: "neu" }, current: { id: 7, summary: "neu" } },
      false
    );

    expect(plan.patch).toEqual({ summary: null });
  });
});

describe("the state a discard brings back for a locale", () => {
  const io = { read: vi.fn(async () => ({ doc: { id: 7, summary: null } })) };

  it("is read without values of another locale, before a write to a locale that is not the default", async () => {
    const state = await localeStateBeforeWrite(
      io as never,
      schema,
      { collection: "notes" },
      { id: 7, locale: "de" }
    );

    expect(state).toEqual({ id: 7, summary: null });
    expect(io.read).toHaveBeenCalledWith(
      { collection: "notes" },
      expect.objectContaining({ id: 7, locale: "de", fallbackLocale: false })
    );
  });

  it("is the document as read for the default locale and without locales", async () => {
    io.read.mockClear();
    const target = { collection: "notes" };

    expect(await localeStateBeforeWrite(io as never, schema, target, { id: 7 })).toBeUndefined();
    expect(
      await localeStateBeforeWrite(io as never, schema, target, { id: 7, locale: "en" })
    ).toBeUndefined();
    expect(
      await localeStateBeforeWrite(io as never, { ...schema, defaultLocale: undefined }, target, {
        id: 7,
        locale: "de",
      })
    ).toBeUndefined();
    expect(io.read).not.toHaveBeenCalled();
  });
});

describe("a read without values of another locale, through MCP", () => {
  it("asks the find tool in the text form it accepts", async () => {
    const execute = vi.fn(async (_input: Record<string, unknown>) => ({
      content: [{ type: "text", text: JSON.stringify({ id: 7, summary: null }) }],
    }));
    const io = createDocumentIO({ mcpTools: { findNotes: { execute } } as never, schema });

    await io.read({ collection: "notes" }, { id: 7, locale: "de", fallbackLocale: false });
    expect(execute.mock.calls[0][0]).toMatchObject({ locale: "de", fallbackLocale: "none" });
    await io.read({ collection: "notes" }, { id: 7, locale: "de" });
    expect(execute.mock.calls[1][0]).not.toHaveProperty("fallbackLocale");
  });
});

describe("the recorded change keeps its locale", () => {
  const record = vi.fn(async (_conversationId: string, _refs: { locale?: string }[]) => {});
  const memory = { changesets: { record }, db: null } as never;

  it("stores a write without a locale under the default one, and the restore state with it", () => {
    createEditRecorder({ memory, conversationId: "c1", schema })([
      { collection: "notes", id: 7, before, after },
      { collection: "notes", id: 7, before, after, locale: "de", restore: { id: 7 } },
    ]);

    expect(record).toHaveBeenCalledWith("c1", [
      expect.objectContaining({ id: 7, locale: "en" }),
      expect.objectContaining({ id: 7, locale: "de", restore: { id: 7 } }),
    ]);
  });

  it("stores the records of two writes in the order of the writes, the slow first one too", async () => {
    const events: string[] = [];

    const gate: { open?: () => void } = {};
    const slow = new Promise<void>((resolve) => {
      gate.open = resolve;
    });
    const ordered = vi.fn(async (_conversation: string, refs: any[]) => {
      events.push(`start ${refs[0].after.summary}`);
      if (refs[0].after.summary === "one") await slow;
      events.push(`end ${refs[0].after.summary}`);
    });
    const recordEdits = createEditRecorder({
      memory: { changesets: { record: ordered }, db: null } as never,
      conversationId: "c1",
      schema,
    });

    recordEdits([{ collection: "notes", id: 7, before, after: { ...after, summary: "one" } }]);
    recordEdits([
      { collection: "notes", id: 7, before: after, after: { ...after, summary: "two" } },
    ]);
    await Promise.resolve();
    expect(events).toEqual(["start one"]);
    gate.open?.();
    await vi.waitFor(() =>
      expect(events).toEqual(["start one", "end one", "start two", "end two"])
    );
  });

  it("stores no locale for a project without locales", () => {
    record.mockClear();
    createEditRecorder({
      memory,
      conversationId: "c1",
      schema: { ...schema, defaultLocale: undefined },
    })([{ collection: "notes", id: 7, before, after }]);

    expect(record.mock.calls[0][1][0].locale).toBeUndefined();
  });
});

function setUp(changes: StoredChange[], current: Record<string, unknown> = after) {
  const settle = vi.fn(async (_conversationId: string, _change: unknown, _outcome: unknown) => {});
  const memory = {
    conversations: { findById: vi.fn(async () => ({ userId: "u1" })) },
    changesets: { listForDocument: vi.fn(async () => changes), settle },
  };
  const payload = {
    config: { admin: { user: "users" } },
    findByID: vi.fn(async () => current),
    findGlobal: vi.fn(async () => current),
    update: vi.fn(async ({ data }) => ({ ...current, ...data })),
    updateGlobal: vi.fn(async ({ data }) => ({ ...current, ...data })),
  };
  const handler = createDiscardHandler(
    async () => schema,
    async () => memory as never
  );

  const call = async (body: unknown, user: unknown = { id: "u1" }) => {
    const response = await handler({ user, payload, json: async () => body } as never);

    return { status: response.status, body: await response.json() };
  };

  return { call, payload, settle, memory };
}

const stored = (change: Partial<StoredChange>): StoredChange => ({
  collection: "notes",
  id: "7",
  op: "edit",
  before,
  after,
  restore: before,
  report: null,
  ...change,
});

const request = { conversationId: "c1", documents: [{ collection: "notes", id: 7 }] };

describe("the discard endpoint", () => {
  it("writes the stored state as the person, as a draft, and marks the change as discarded", async () => {
    const { call, payload, settle } = setUp([stored({})]);
    const { body } = await call(request);

    expect(body.results).toEqual([
      { collection: "notes", id: "7", status: "restored", restored: ["summary", "rows"] },
    ]);
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "notes",
        id: "7",
        data: { summary: "old", rows: before.rows, _status: "draft" },
        draft: true,
        overrideAccess: false,
        overrideLock: false,
        user: { id: "u1" },
      })
    );
    expect(settle).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ id: "7" }),
      expect.objectContaining({ discarded: true })
    );
  });

  it("restores each written locale from its own state, without borrowed values", async () => {
    const german = stored({
      locale: "de",
      before,
      restore: { id: 7, summary: null, owner: 1, rows: before.rows },
      after: { ...before, summary: "neu" },
    });
    const { call, payload } = setUp([german], { ...before, summary: "neu" });
    const { body } = await call(request);

    expect(body.results[0]).toMatchObject({ locale: "de", status: "restored" });
    expect(payload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "de", fallbackLocale: false })
    );
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "de", data: { summary: null, _status: "draft" } })
    );
  });

  it("keeps what someone changed after the agent and says so", async () => {
    const { call, payload, settle } = setUp([stored({})], { ...after, summary: "by a person" });
    const first = await call(request);

    expect(first.body.results[0]).toMatchObject({
      status: "changed-since",
      restored: ["rows"],
      changedSince: ["summary"],
    });
    expect(settle.mock.calls[0][2]).toMatchObject({ discarded: false });
    await call({ ...request, force: true });
    expect(payload.update.mock.calls.at(-1)![0].data.summary).toBe("old");
  });

  it("a second discard still keeps what someone changed, also in fields the agent never touched", async () => {
    const change = stored({ after: { ...before, summary: "new" } });
    const { call, payload, settle } = setUp([change], {
      ...before,
      summary: "by a person",
      owner: 2,
    });

    settle.mockImplementation(async (_conversationId, _change, outcome: any) => {
      change.after = outcome.after;
    });
    const first = await call(request);
    const second = await call(request);

    for (const { body } of [first, second])
      expect(body.results[0]).toMatchObject({
        status: "changed-since",
        changedSince: ["summary"],
      });
    expect(second.body.results[0].restored).toBeUndefined();
    expect(payload.update).not.toHaveBeenCalled();
  });

  it("does not remove a document the conversation created", async () => {
    const { call, payload } = setUp([stored({ op: "create", before: {}, restore: {} })]);
    const { body } = await call(request);

    expect(body.results[0].status).toBe("created");
    expect(payload.update).not.toHaveBeenCalled();
  });

  it("restores a global through the global calls", async () => {
    const change = stored({
      collection: "global:settings",
      id: "settings",
      before: { motto: "old" },
      restore: { motto: "old" },
      after: { motto: "new" },
    });
    const { call, payload } = setUp([change], { motto: "new" });
    const { body } = await call({
      conversationId: "c1",
      documents: [{ collection: "global:settings", id: "settings" }],
    });

    expect(body.results[0].status).toBe("restored");
    expect(payload.updateGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "settings", data: { motto: "old", _status: "draft" } })
    );
  });

  it("reports a failed write and leaves the stored change as it is", async () => {
    const { call, payload, settle } = setUp([stored({})]);

    payload.update.mockRejectedValueOnce(new Error("locked by another person"));
    const { body } = await call(request);

    expect(body.results[0]).toMatchObject({ status: "failed", error: "locked by another person" });
    expect(settle).not.toHaveBeenCalled();
  });

  it("answers only the person who owns the conversation", async () => {
    const { call, payload } = setUp([stored({})]);

    expect((await call(request, null)).status).toBe(401);
    expect((await call(request, { id: "someone-else" })).status).toBe(404);
    expect((await call({ conversationId: "c1", documents: [] })).status).toBe(400);
    expect(payload.update).not.toHaveBeenCalled();
  });
});
