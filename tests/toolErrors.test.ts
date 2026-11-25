import { describe, it, expect } from "vitest";

import {
  documentNotFoundError,
  itemNotFoundError,
  unknownTargetError,
} from "../src/agent/toolErrors.js";
import type { SchemaContext } from "../src/types.js";

const schema = {
  collections: [{ slug: "ledgers" }, { slug: "voices" }],
  globals: [{ slug: "masthead" }],
} as SchemaContext;

describe("a tool error names the valid values or the next call", () => {
  it("an unknown collection or global lists the ones the project has", () => {
    expect(unknownTargetError(schema, { collection: "notes" })).toBe(
      'Unknown collection "notes". Collections: ledgers, voices. Globals: masthead.'
    );
    expect(unknownTargetError(schema, { global: "top" })).toContain('Unknown global "top".');
  });

  it("a project without globals gets no empty list", () => {
    const text = unknownTargetError({ ...schema, globals: [] }, { collection: "notes" });

    expect(text).toBe('Unknown collection "notes". Collections: ledgers, voices.');
  });

  it("a missing document names the calls that give an id", () => {
    expect(documentNotFoundError("ledgers/9")).toBe(
      "ledgers/9 not found. Take the id from a listDocuments or findDocuments result."
    );
  });

  it("a missing item lists the ids the array has", () => {
    expect(itemNotFoundError("x", "frame.rows", [{ id: "s1" }, { id: "q1" }])).toBe(
      'No item with id "x" at "frame.rows". The ids there: s1, q1.'
    );
    expect(itemNotFoundError("x", "frame.rows", [])).toBe(
      'No item with id "x" at "frame.rows": it has no items.'
    );
  });

  it("a long array is cut with a count of the rest", () => {
    const rows = Array.from({ length: 45 }, (_, index) => ({ id: `r${index}` }));

    expect(itemNotFoundError("x", "rows", rows)).toContain("r39 and 5 more.");
  });
});
