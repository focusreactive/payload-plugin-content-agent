import { describe, it, expect } from "vitest";
import { dedupMerge, extractEditedRefs, standingRefs } from "../src/ui/reviewUtils.js";

describe("dedupMerge", () => {
  it("adds new refs not already in base", () => {
    const base = [{ collection: "posts", id: 1 }];
    const result = dedupMerge(base, [{ collection: "posts", id: 2 }]);

    expect(result).toEqual([
      { collection: "posts", id: 1 },
      { collection: "posts", id: 2 },
    ]);
  });

  it("drops a ref already present in base", () => {
    const base = [{ collection: "posts", id: 1 }];
    const result = dedupMerge(base, [{ collection: "posts", id: 1 }]);

    expect(result).toBe(base);
  });

  it("dedupes within the incoming batch too", () => {
    const base: { collection: string; id: string | number }[] = [];
    const extra = [
      { collection: "posts", id: 301 },
      { collection: "posts", id: 301 },
    ];
    const result = dedupMerge(base, extra);

    expect(result).toEqual([{ collection: "posts", id: 301 }]);
  });

  it("keeps the FIRST occurrence when the batch has duplicates mixed with unique refs", () => {
    const result = dedupMerge(
      [],
      [
        { collection: "posts", id: 1 },
        { collection: "authors", id: 5 },
        { collection: "posts", id: 1 },
      ]
    );

    expect(result).toEqual([
      { collection: "posts", id: 1 },
      { collection: "authors", id: 5 },
    ]);
  });

  it("ignores refs missing collection or id", () => {
    const result = dedupMerge(
      [],
      [
        { collection: "", id: 1 },
        { collection: "posts", id: null as any },
      ]
    );

    expect(result).toEqual([]);
  });

  it("ignores an empty or blank id", () => {
    const result = dedupMerge(
      [],
      [
        { collection: "posts", id: "" },
        { collection: "posts", id: "   " },
      ]
    );

    expect(result).toEqual([]);
  });
});

describe("extractEditedRefs", () => {
  it("extracts a single-op done ref", () => {
    expect(
      extractEditedRefs({ collection: "posts", id: "1", phase: "done", status: "done" })
    ).toEqual([{ collection: "posts", id: "1" }]);
  });

  it("extracts every done result from a bulk op", () => {
    const refs = extractEditedRefs({
      collection: "posts",
      results: [
        { id: 1, status: "done" },
        { id: 2, status: "error" },
        { id: 3, status: "done" },
      ],
    });

    expect(refs).toEqual([
      { collection: "posts", id: 1 },
      { collection: "posts", id: 3 },
    ]);
  });

  it("ignores a rejected/errored single op", () => {
    expect(
      extractEditedRefs({ collection: "posts", id: "1", phase: "done", status: "rejected" })
    ).toEqual([]);
  });

  it("ignores a done single op with a blank id", () => {
    expect(
      extractEditedRefs({ collection: "posts", id: "", phase: "done", status: "done" })
    ).toEqual([]);
  });

  it("ignores a done bulk result with a blank id", () => {
    const refs = extractEditedRefs({
      collection: "posts",
      results: [
        { id: "", status: "done" },
        { id: 4, status: "done" },
      ],
    });

    expect(refs).toEqual([{ collection: "posts", id: 4 }]);
  });
});

describe("standingRefs", () => {
  it("leaves out the documents whose changes were discarded", () => {
    const refs = [
      { collection: "notes", id: 1 },
      { collection: "notes", id: 2 },
    ];

    expect(standingRefs(refs, new Set(["notes:2"]))).toEqual([{ collection: "notes", id: 1 }]);
    expect(standingRefs(refs, new Set(["notes:1", "notes:2"]))).toEqual([]);
  });
});
