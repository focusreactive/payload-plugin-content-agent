import { describe, expect, it, vi } from "vitest";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { readDocument } from "../src/agent/tools/documents/readDocument.js";
import type { SchemaContext } from "../src/types.js";

const collection = (slug: string, hasVersions: boolean) => ({
  slug,
  fields: [
    { name: "title", type: "text" },
    { name: "slug", type: "text" },
  ],
  hasVersions,
  hasDrafts: hasVersions,
  hasAuth: false,
  timestamps: true,
});
const schema: SchemaContext = {
  collections: [collection("pages", true), collection("tags", false)],
  globals: [],
};
const version = (createdAt: string, fields: object) => ({
  id: createdAt,
  createdAt,
  version: fields,
});
const saved = [
  version("2023-01-29T16:01:00.000Z", { title: "Austria", slug: "agency-at", _status: "draft" }),
  version("2023-02-02T10:00:00.000Z", {
    title: "Austria",
    slug: "agency-at",
    _status: "published",
  }),
  version("2023-07-17T19:01:00.000Z", {
    title: "Austria",
    slug: "agency-austria",
    layout: [{ blockType: "hero" }],
    _status: "published",
  }),
];

function ioWith(payload?: object) {
  return createDocumentIO({
    mcpTools: {},
    schema,
    ...(payload ? { payload: payload as any, user: { id: 7 } as any } : {}),
  });
}

describe('readDocument, view "history"', () => {
  it("lists the saves with their dates, the first published one and what each changed", async () => {
    const findVersions = vi.fn(async () => ({ docs: saved, totalDocs: 3 }));
    const result: any = await readDocument(ioWith({ findVersions }), schema, {
      collection: "pages",
      id: 13,
      view: "history",
    });

    expect(findVersions).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "pages",
        where: { parent: { equals: 13 } },
        sort: "createdAt",
        overrideAccess: false,
      })
    );
    expect(result.totalVersions).toBe(3);
    expect(result.firstSavedAt).toBe("2023-01-29T16:01:00.000Z");
    expect(result.firstPublishedAt).toBe("2023-02-02T10:00:00.000Z");
    expect(result.versions).toEqual([
      { savedAt: "2023-01-29T16:01:00.000Z", status: "draft", first: true },
      { savedAt: "2023-02-02T10:00:00.000Z", status: "published", changed: {}, alsoChanged: [] },
      {
        savedAt: "2023-07-17T19:01:00.000Z",
        status: "published",
        changed: { slug: { from: "agency-at", to: "agency-austria" } },
        alsoChanged: ["layout"],
      },
    ]);
  });

  it("says why there is no history: no versions, or no Local API", async () => {
    const noVersions: any = await readDocument(ioWith({}), schema, {
      collection: "tags",
      id: 1,
      view: "history",
    });
    const noLocal: any = await readDocument(ioWith(), schema, {
      collection: "pages",
      id: 13,
      view: "history",
    });

    expect(noVersions.error).toMatch(/keeps no versions/u);
    expect(noLocal.error).toMatch(/through the Local API/u);
  });
});
