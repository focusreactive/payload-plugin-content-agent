import { describe, it, expect, vi } from "vitest";
import {
  runBulk,
  unapprovedBulkRefusal,
  BULK_CONFIRM_THRESHOLD,
} from "../src/agent/content/bulk.js";
import type { BulkDocResult } from "../src/agent/content/bulk.js";
import { bulkResult } from "../src/agent/content/editor/shared.js";

describe("runBulk: shared bulk layer", () => {
  it("applies the worker to every id, preserves input order, tallies statuses", async () => {
    const { results, done, skipped, errors } = await runBulk(
      [1, 2, 3, 4],
      async (id): Promise<BulkDocResult> => ({
        id,
        status: Number(id) % 2 === 0 ? "done" : "skipped",
      }),
      { op: "test", collection: "posts", concurrency: 2 }
    );

    expect(results.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(done).toBe(2);
    expect(skipped).toBe(2);
    expect(errors).toBe(0);
  });

  it("counts a document the editor left unchanged apart from done and from errors", async () => {
    const { done, unchanged, errors, rejected } = await runBulk(
      [1, 2, 3],
      async (id): Promise<BulkDocResult> => ({ id, status: id === 2 ? "done" : "unchanged" }),
      { op: "test", collection: "posts", concurrency: 2 }
    );

    expect({ done, unchanged, errors, rejected }).toEqual({
      done: 1,
      unchanged: 2,
      errors: 0,
      rejected: 0,
    });
  });

  it("isolates a throwing worker as an error result - the batch survives", async () => {
    const { results, done, errors } = await runBulk(
      [1, 2, 3],
      async (id): Promise<BulkDocResult> => {
        if (id === 2) throw new Error("boom");

        return { id, status: "done" };
      },
      { op: "test", collection: "posts", concurrency: 3 }
    );

    expect(done).toBe(2);
    expect(errors).toBe(1);
    expect(results.find((r) => r.id === 2)).toMatchObject({
      status: "error",
      error: expect.stringContaining("boom"),
    });
  });

  it("emits started → processing (with currentId) → done", async () => {
    const events: any[] = [];

    await runBulk([1, 2], async (id): Promise<BulkDocResult> => ({ id, status: "done" }), {
      op: "bulkEditContent",
      collection: "posts",
      concurrency: 1,
      emit: (d) => events.push(d),
    });
    expect(events[0]).toMatchObject({ op: "bulkEditContent", phase: "started", total: 2 });
    expect(events.some((e) => e.phase === "processing" && e.currentId !== undefined)).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ phase: "done", total: 2, completed: 2 });
  });

  it("never runs more than `concurrency` workers at once", async () => {
    let inFlight = 0;
    let peak = 0;

    await runBulk(
      [1, 2, 3, 4, 5, 6],
      async (id): Promise<BulkDocResult> => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;

        return { id, status: "done" };
      },
      { op: "test", collection: "posts", concurrency: 2 }
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("merges meta into every progress event (e.g. find/replace)", async () => {
    const events: any[] = [];

    await runBulk([1], async (id): Promise<BulkDocResult> => ({ id, status: "done" }), {
      op: "findReplace",
      collection: "posts",
      concurrency: 1,
      emit: (d) => events.push(d),
      meta: { find: "2027", replace: "2030" },
    });
    expect(events.every((e) => e.find === "2027" && e.replace === "2030")).toBe(true);
  });
});

describe("runBulk: de-dupe is type-insensitive (String(id) identity)", () => {
  it('treats numeric 1 and string "1" as the SAME document - processed once', async () => {
    const seen: (string | number)[] = [];
    const { results, done } = await runBulk(
      [1, "1", 2],
      async (id): Promise<BulkDocResult> => {
        seen.push(id);

        return { id, status: "done" };
      },
      { op: "test", collection: "posts", concurrency: 3 }
    );

    expect(results).toHaveLength(2);
    expect(done).toBe(2);
    expect(seen).toEqual([1, 2]);
  });
});

describe("runBulk abort signal", () => {
  it("skips not-yet-started documents once the signal is aborted", async () => {
    const worker = vi.fn(async (id: string | number) => ({ id, status: "done" as const }));
    const ac = new AbortController();

    ac.abort();
    const summary = await runBulk(["a", "b", "c"], worker, {
      op: "bulkEditContent",
      collection: "posts",
      concurrency: 2,
      signal: ac.signal,
    });

    expect(worker).not.toHaveBeenCalled();
    expect(summary.errors).toBe(3);
    expect(summary.results.every((r) => r.error === "aborted by user")).toBe(true);
  });

  it("runs everything normally when the signal never fires", async () => {
    const ac = new AbortController();
    const summary = await runBulk(["a", "b"], async (id) => ({ id, status: "done" as const }), {
      op: "bulkEditContent",
      collection: "posts",
      concurrency: 2,
      signal: ac.signal,
    });

    expect(summary.done).toBe(2);
  });
});

describe("unapprovedBulkRefusal", () => {
  it("lets a small batch through (at threshold)", () => {
    expect(unapprovedBulkRefusal(BULK_CONFIRM_THRESHOLD, false, "editContent")).toBeNull();
  });

  it("refuses a run above the threshold that the person did not confirm", () => {
    const refusal = unapprovedBulkRefusal(BULK_CONFIRM_THRESHOLD + 1, false, "editContent");

    expect(refusal?.error).toContain(`${BULK_CONFIRM_THRESHOLD + 1} documents`);
    expect(refusal?.error).toContain("Call editContent again");
  });

  it("runs once the person confirmed, whatever the size", () => {
    expect(unapprovedBulkRefusal(1000, true, "editContent")).toBeNull();
  });
});

const output = (results: Record<string, unknown>[]) => ({
  done: results.filter((result) => result.status === "done").length,
  unchanged: results.filter((result) => result.status === "unchanged").length,
  rejected: 0,
  errors: 0,
  total: results.length,
  results,
});

describe("bulkResult: the text the main agent reads after a bulk run", () => {
  it("gives the editors' own accounts for the unchanged documents and no reason of its own", () => {
    const text = bulkResult(
      "editContent",
      output([
        { id: 1, status: "done", summary: "Added the line." },
        { id: 2, status: "unchanged", summary: "The line is already\nthe last paragraph." },
        { id: 3, status: "unchanged", summary: "Nothing to add: the text ends with this line." },
      ])
    );

    expect(text).toContain("2 document(s) were left unchanged");
    expect(text).toContain("- 2: The line is already the last paragraph.");
    expect(text).toContain("- 3: Nothing to add: the text ends with this line.");
    expect(text).not.toContain("Added the line.");
    expect(text).not.toContain("found nothing in them");
  });

  it("shows at most five accounts and says how many of the unchanged they are", () => {
    const text = bulkResult(
      "editContent",
      output(
        Array.from({ length: 8 }, (_, index) => ({
          id: index + 1,
          status: "unchanged",
          summary: `account ${index + 1}`,
        }))
      )
    );

    expect(text).toContain("(5 of 8)");
    expect(text).toContain("- 5: account 5");
    expect(text).not.toContain("account 6");
  });

  it("says the reason is not known when no editor gave an account", () => {
    const text = bulkResult(
      "editContent",
      output([
        { id: 1, status: "unchanged", summary: "  " },
        { id: 2, status: "unchanged" },
      ])
    );

    expect(text).toContain("the reason is not known");
    expect(text).not.toContain("own accounts");
  });

  it("passes on the note of an empty selection, so the model learns why and what to call next", () => {
    const text = bulkResult("editContent", {
      ...output([]),
      note: "No document matched the filter. Pass ids or '{}' for every document.",
    });

    expect(text).toContain("0 done, 0 rejected, 0 errors out of 0 documents");
    expect(text).toContain("No document matched the filter. Pass ids or '{}' for every document.");
  });

  it("says nothing about unchanged documents when there are none", () => {
    expect(bulkResult("editContent", output([{ id: 1, status: "done" }]))).not.toContain(
      "unchanged"
    );
  });
});
