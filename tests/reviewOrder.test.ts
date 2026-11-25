import { describe, expect, it, vi } from "vitest";

vi.mock("@payloadcms/ui", () => ({
  useConfig: () => ({ config: {} }),
  useAuth: () => ({}),
  getHTMLDiffComponents: undefined,
}));
const { inSummaryOrder } = await import("../src/ui/ReviewPanel.js");

describe("the order of the review panel", () => {
  it("puts a document the summary leaves out after the documents with open issues", () => {
    const refs: any[] = [
      { collection: "posts", id: "discarded" },
      { collection: "posts", id: "issues" },
      { collection: "posts", id: "differs" },
    ];
    const summary: any = {
      documents: [
        { collection: "posts", id: "issues", issues: ["x"] },
        { collection: "posts", id: "differs", issues: [] },
      ],
    };

    expect(inSummaryOrder(refs, summary).ordered.map((ref) => ref.id)).toEqual([
      "issues",
      "differs",
      "discarded",
    ]);
  });
});
