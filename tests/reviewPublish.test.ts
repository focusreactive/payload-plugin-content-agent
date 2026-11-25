import { describe, expect, it } from "vitest";
import { chosenRefs } from "../src/ui/useReviewPanel.js";
import { keyOf } from "../src/ui/reviewUtils.js";

const refs = [1, 2, 3].map((id) => ({ collection: "posts", id }));
const keys = (...ids: number[]) => new Set(ids.map((id) => keyOf({ collection: "posts", id })));

describe("the documents Publish sends", () => {
  it("leaves out a discarded document that is still selected, and one already published", () => {
    const chosen = chosenRefs(refs, {
      selected: keys(1, 2, 3),
      publishedKeys: keys(2),
      discardedKeys: keys(1),
    });

    expect(chosen.map((ref) => ref.id)).toEqual([3]);
  });

  it("leaves out a document the person did not select", () => {
    const chosen = chosenRefs(refs, {
      selected: keys(1, 3),
      publishedKeys: keys(),
      discardedKeys: keys(),
    });

    expect(chosen.map((ref) => ref.id)).toEqual([1, 3]);
  });
});
