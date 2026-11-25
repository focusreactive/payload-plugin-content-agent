import { describe, it, expect, vi } from "vitest";
import { readWhere, sortError, WHERE_OPERATORS } from "../src/agent/content/whereClause.js";
import { listDocuments } from "../src/agent/tools/documents/listDocuments.js";
import type { SchemaCollection, SchemaContext } from "../src/types.js";
import type { DocumentIO } from "../src/agent/content/documentIo.js";

const reviews: SchemaCollection = {
  slug: "reviews",
  fields: [
    { name: "person", type: "text" },
    { name: "rating", type: "number" },
    { name: "meta", type: "group", fields: [{ name: "source", type: "text" }] },
  ],
  hasVersions: true,
  hasDrafts: true,
  hasAuth: false,
  timestamps: true,
};

describe("readWhere", () => {
  it("accepts fields of the collection, built-in fields, paths and and/or", () => {
    const json =
      '{"and":[{"person":{"like":"a b"}},{"or":[{"meta.source":{"exists":true}},{"_status":{"equals":"published"}}]},{"id":{"in":[1,2]}}]}';

    expect(readWhere(json, reviews)).toEqual({ where: JSON.parse(json) });
    expect(readWhere("{}", reviews)).toEqual({ where: {} });
  });

  it("refuses text that is not a JSON object and names the format and the fields", () => {
    for (const json of ["person=Anna", "person equals Anna", "Anna", '"Anna"', "[1]", "4"]) {
      const result = readWhere(json, reviews) as { error: string };

      expect(result.error).toMatch(/JSON object/u);
      expect(result.error).toMatch(/The fields of "reviews": person, rating, meta, id/u);
      for (const operator of WHERE_OPERATORS) expect(result.error).toContain(operator);
    }
  });

  it("refuses a field that the collection does not have, at any depth", () => {
    for (const json of [
      '{"name":{"contains":"Anna"}}',
      '{"or":[{"person":{"contains":"Anna"}},{"and":[{"name.first":{"contains":"Anna"}}]}]}',
    ]) {
      const result = readWhere(json, reviews) as { error: string };

      expect(result.error).toMatch(/"reviews" has no field name/u);
      expect(result.error).toMatch(/The fields of "reviews": person/u);
    }
  });

  it("refuses an unknown operator and a condition of the wrong shape", () => {
    expect((readWhere('{"person":{"startsWith":"A"}}', reviews) as any).error).toMatch(
      /startsWith is not an operator/u
    );
    expect((readWhere('{"person":"Anna"}', reviews) as any).error).toMatch(
      /the value under person has the wrong shape/u
    );
    expect((readWhere('{"and":{"person":{"equals":"A"}}}', reviews) as any).error).toMatch(
      /the value under and has the wrong shape/u
    );
  });

  it("checks the shape and the operators also when the collection is not known", () => {
    expect(readWhere('{"anything":{"equals":1}}', undefined)).toEqual({
      where: { anything: { equals: 1 } },
    });
    expect((readWhere('{"anything":{"is":1}}', undefined) as any).error).toMatch(
      /is is not an operator/u
    );
  });
});

describe("sortError", () => {
  it("accepts a field, a descending field and a list, and refuses an unknown field", () => {
    expect(sortError("rating", reviews)).toBeNull();
    expect(sortError("-updatedAt", reviews)).toBeNull();
    expect(sortError("-rating, meta.source", reviews)).toBeNull();
    expect(sortError("-date", reviews)).toMatch(
      /`sort` names date: "reviews" has no such field\. The fields of "reviews": person/u
    );
  });
});

describe("listDocuments", () => {
  const schema: SchemaContext = { globals: [], collections: [reviews] };

  it("does not call the site for a where or a sort on a field the collection does not have", async () => {
    const list = vi.fn(async () => ({ docs: [], totalPages: 1, totalDocs: 0 }));
    const io = { list } as unknown as DocumentIO;

    const where: any = await listDocuments(io, schema, {
      collection: "reviews",
      where: '{"name":{"equals":"Anna"}}',
    });
    const sort: any = await listDocuments(io, schema, { collection: "reviews", sort: "-date" });

    expect(where.error).toMatch(/"reviews" has no field name/u);
    expect(sort.error).toMatch(/`sort` names date/u);
    expect(list).not.toHaveBeenCalled();

    await listDocuments(io, schema, {
      collection: "reviews",
      where: '{"rating":{"greater_than":3}}',
      sort: "-rating",
    });
    expect((list.mock.calls[0] as any[])[1]).toMatchObject({
      where: { rating: { greater_than: 3 } },
      sort: "-rating",
    });
  });
});
