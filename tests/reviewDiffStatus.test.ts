import { describe, it, expect, vi } from "vitest";
import { createDiffHandler } from "../src/api/reviewDiff.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "notes",
      fields: [{ name: "heading", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const memory = {
  conversations: { findById: async () => ({ userId: "1" }) },
  changesets: {
    getSnapshots: async () => ({
      before: { id: 7, _status: "published", heading: "Old" },
      after: { id: 7, _status: "published", heading: "New" },
    }),
  },
};

async function rowOf(findByID: (args: any) => Promise<unknown>) {
  const handler = createDiffHandler(
    async () => schema,
    async () => memory as any
  );
  const response = await handler({
    url: "http://localhost/api/content-agent/diff?collection=notes&id=7&conversationId=c-1",
    user: { id: 1, collection: "users" },
    payload: { findByID, config: { admin: { user: "users" } } },
  } as any);

  return (await response.json()).diff;
}

describe("the status of a row in the review panel", () => {
  it("is the status the document has now, not the one it was read with", async () => {
    const findByID = vi.fn(async () => ({ id: 7, _status: "draft", heading: "New" }));
    const diff = await rowOf(findByID);

    expect(diff.status).toBe("draft");
    expect(diff.fields.map((field: any) => field.name)).toEqual(["heading"]);
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "notes", id: "7", draft: true, overrideAccess: false })
    );
  });

  it("is left out when the person cannot read the document", async () => {
    const diff = await rowOf(async () => {
      throw new Error("Forbidden");
    });

    expect(diff.status).toBeUndefined();
  });
});
