import { describe, expect, it } from "vitest";
import { unapprovedBulkRefusal } from "../src/agent/content/bulk.js";
import { doneEvent } from "../src/agent/content/editor/shared.js";
import { countFailedWrites } from "../src/agent/runAgent/failedWrites.js";
import { wrapMcpTools } from "../src/agent/tools/mcp/wrapTools.js";
import { withWriteStatus, writeStatusOf } from "../src/agent/writeStatus.js";

describe("the status of a write, read from the result", () => {
  it("one document", () => {
    expect(writeStatusOf({ id: 1, status: "done" })).toBe("done");
    expect(writeStatusOf({ id: 1, status: "needsInput", question: "Which one?" })).toBe(
      "needs-input"
    );
    expect(writeStatusOf({ id: 1, status: "unchanged", summary: "not there" })).toBe(
      "nothing-changed"
    );
    expect(writeStatusOf({ id: 1, status: "rejected" })).toBe("failed");
    expect(writeStatusOf({ id: 1, status: "error", error: "locked" })).toBe("failed");
  });

  it("many documents", () => {
    expect(writeStatusOf({ total: 3, done: 2, rejected: 1, errors: 0 })).toBe("done");
    expect(writeStatusOf({ total: 3, done: 0, rejected: 1, errors: 2 })).toBe("failed");
    expect(writeStatusOf({ total: 0, done: 0, rejected: 0, errors: 0 })).toBe("nothing-changed");
    expect(writeStatusOf({ total: 2, done: 0, unchanged: 2, rejected: 0, errors: 0 })).toBe(
      "nothing-changed"
    );
    expect(writeStatusOf({ changedDocs: 0, errors: 0 })).toBe("nothing-changed");
    expect(writeStatusOf({ changedDocs: 0, errors: 2 })).toBe("failed");
    expect(writeStatusOf({ changedDocs: 4, errors: 1 })).toBe("done");
  });

  it("a write the site's tool refused in its text, with no error flag", () => {
    const refused = {
      content: [
        {
          type: "text",
          text: 'Error updating resource in collection "posts": The following field is invalid: slug',
        },
      ],
    };
    const saved = { content: [{ type: "text", text: 'Document updated successfully\n{"id":3}' }] };

    expect(writeStatusOf(refused)).toBe("failed");
    expect(withWriteStatus(refused)).toMatchObject({ writeStatus: "failed" });
    expect(writeStatusOf(saved)).toBe("done");
  });

  it("a tool that knows its status wins over the shape of the result", () => {
    expect(writeStatusOf(unapprovedBulkRefusal(7, false, "editContent"))).toBe(
      "needs-confirmation"
    );
    expect(writeStatusOf({ error: "already has this value", writeStatus: "nothing-changed" })).toBe(
      "nothing-changed"
    );
  });

  it("a result that is not an object has no status and stays as it is", () => {
    expect(writeStatusOf("ran")).toBeUndefined();
    expect(withWriteStatus("ran")).toBe("ran");
  });
});

const params = (...names: string[]) => ({
  jsonSchema: { type: "object", properties: Object.fromEntries(names.map((n) => [n, {}])) },
});

describe("every write tool result carries the status", () => {
  it("adds it to the result and counts only a failed call", async () => {
    const writeTracker = { count: 0, reports: 0, failed: 0 };
    const tools = countFailedWrites(
      {
        updatePosts: { execute: async () => ({ id: 1 }) },
        editContent: { execute: async () => unapprovedBulkRefusal(7, false, "editContent") },
        createPosts: { execute: async () => ({ error: "validation failed" }) },
        findPosts: { execute: async () => ({ docs: [] }) },
      },
      writeTracker
    );

    expect(await tools.updatePosts.execute()).toMatchObject({ writeStatus: "done" });
    expect(await tools.editContent.execute()).toMatchObject({
      writeStatus: "needs-confirmation",
    });
    expect(await tools.createPosts.execute()).toMatchObject({ writeStatus: "failed" });
    expect(await tools.findPosts.execute()).toEqual({ docs: [] });
    expect(writeTracker.failed).toBe(1);
  });

  it("a write through a tool with no `draft` parameter is a live write", async () => {
    const schema = { collections: [], globals: [] };
    const context = { schema, documentIo: () => ({}) as never, recordEdits: () => {} };
    const tools = (inputSchema: unknown) =>
      wrapMcpTools(
        { updateOrders: { execute: async () => ({ content: [] }), inputSchema } },
        context
      ).safeMcpTools as Record<string, { execute: (...args: unknown[]) => Promise<unknown> }>;
    const options = { toolCallId: "c1", messages: [] };

    expect(await tools(params("id")).updateOrders.execute({ id: 1 }, options)).toMatchObject({
      writeStatus: "live-write",
    });
    expect(
      await tools(params("id", "draft")).updateOrders.execute({ id: 1 }, options)
    ).not.toHaveProperty("writeStatus");
  });
});

describe("the last event of an edit", () => {
  it("carries the status and the facts for the card", () => {
    const changes = Array.from({ length: 25 }, (_, i) => `fact ${i}`);
    const event = doneEvent(
      { op: "editContent", collection: "posts", id: 1 },
      { id: 1, status: "done", changes, issues: ["a link returns 404"] }
    );

    expect(event).toMatchObject({
      phase: "done",
      writeStatus: "done",
      changesTotal: 25,
      issues: ["a link returns 404"],
    });
    expect(event.changes).toHaveLength(20);
  });

  it("carries the question of an edit that stopped to ask", () => {
    const event = doneEvent(
      { op: "editContent", collection: "posts", id: 1 },
      { id: 1, status: "needsInput", question: "Which date?" }
    );

    expect(event).toMatchObject({ writeStatus: "needs-input", question: "Which date?" });
    expect(event).not.toHaveProperty("changes");
  });
});
