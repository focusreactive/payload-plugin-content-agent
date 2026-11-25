import { describe, it, expect } from "vitest";
import { assessUpdateRisk } from "../src/agent/tools/review.js";
import type { SchemaField } from "../src/types.js";

const fields: SchemaField[] = [
  { name: "rang", type: "select", options: ["gast", "leitung"] },
  { name: "anzeige", type: "text" },
];
const before = { rang: "gast", anzeige: "Mia" };

describe("a write to a document of an auth collection", () => {
  it("needs review for every changed field, whatever the field is called", () => {
    const risks = assessUpdateRisk(fields, before, { rang: "leitung", anzeige: "Mia K." }, true);

    expect(risks.map((risk) => [risk.field, risk.kind])).toEqual([
      ["rang", "reviewable"],
      ["anzeige", "reviewable"],
    ]);
  });

  it("does not flag a value that stays the same", () => {
    expect(assessUpdateRisk(fields, before, { rang: "gast" }, true)).toEqual([]);
  });

  it("does not apply to a collection without auth", () => {
    expect(assessUpdateRisk(fields, before, { rang: "leitung" })).toEqual([]);
  });
});
