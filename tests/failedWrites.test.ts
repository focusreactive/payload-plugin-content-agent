import { describe, expect, it } from "vitest";

import {
  countFailedWrites,
  isWriteTool,
  reportsFailedWrite,
} from "../src/agent/runAgent/failedWrites.js";
import { writeCheck, writeWarning, wroteNothingAfterTrying } from "../src/agent/runAgent/finish.js";

const tracker = () => ({ count: 0, reports: 0, failed: 0 });

describe("a write that saved nothing is read from the tool results, not from the reply", () => {
  it("knows the write tools by name", () => {
    expect(isWriteTool("editContent")).toBe(true);
    expect(isWriteTool("updatePosts")).toBe(true);
    expect(isWriteTool("createPages")).toBe(true);
    expect(isWriteTool("findPosts")).toBe(false);
    expect(isWriteTool("searchContent")).toBe(false);
  });

  it("takes a refusal, an error and a bulk run with no document done as a failed write", () => {
    expect(reportsFailedWrite({ error: "Refused" })).toBe(true);
    expect(reportsFailedWrite({ isError: true, content: [] })).toBe(true);
    expect(reportsFailedWrite({ id: 1, status: "rejected" })).toBe(true);
    expect(reportsFailedWrite({ total: 3, done: 0, rejected: 1, errors: 2 })).toBe(true);
  });

  it("does not take a saved edit or an empty selection as one", () => {
    expect(reportsFailedWrite({ id: 1, status: "done" })).toBe(false);
    expect(reportsFailedWrite({ total: 0, done: 0, rejected: 0, errors: 0 })).toBe(false);
    expect(reportsFailedWrite({ total: 3, done: 2, rejected: 1, errors: 0 })).toBe(false);
  });

  it("writes no check line while a card waits for the person", () => {
    const failed = { count: 0, reports: 0, failed: 1 };
    const asked = [{ content: [{ type: "tool-approval-request", approvalId: "a" }] }];

    expect(writeCheck(failed, asked)).toBe("");
    expect(writeCheck(failed, [{ content: [] }])).toBe(writeWarning(failed));
  });

  it("counts a write tool that throws, and passes the error on", async () => {
    const writeTracker = tracker();
    const tools = countFailedWrites(
      {
        updateDocument: {
          execute: async () => {
            throw new Error("502 Bad Gateway");
          },
        },
      },
      writeTracker
    );

    await expect((tools.updateDocument as any).execute()).rejects.toThrow("502 Bad Gateway");
    expect(writeTracker.failed).toBe(1);
  });

  it("counts the failed calls of write tools only", async () => {
    const writeTracker = tracker();
    const tools = countFailedWrites(
      {
        editContent: { execute: async () => ({ status: "error", error: "locked" }) },
        updatePosts: { execute: async () => ({ id: 1 }) },
        findPosts: { execute: async () => ({ error: "no such field" }) },
      },
      writeTracker
    );

    await tools.editContent.execute();
    await tools.updatePosts.execute();
    await tools.findPosts.execute();

    expect(writeTracker.failed).toBe(1);
  });

  it("warns only when a write was tried and no document changed", () => {
    expect(wroteNothingAfterTrying({ count: 0, reports: 0, failed: 2 })).toBe(true);
    expect(wroteNothingAfterTrying({ count: 1, reports: 0, failed: 2 })).toBe(false);
    expect(wroteNothingAfterTrying(tracker())).toBe(false);
    expect(writeWarning({ count: 0, reports: 0, failed: 2 })).toContain("2 time(s)");
  });
});
