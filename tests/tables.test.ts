import { describe, it, expect } from "vitest";

import { findTableIssuesOfEdit, findTableIssuesInText } from "../src/agent/content/tables.js";
import type { SchemaField } from "../src/types.js";

const GOOD = `Intro.

| | **Traditional CMS** | **Headless CMS** |
|---|---|---|
| **Architecture** | Monolithic | Decoupled |
| **Deployment** | One | Two or more |
| **Content reuse** | Difficult | Built-in |

After.`;

const BROKEN = GOOD.replace("|---|---|---|", "|---|---|")
  .replace("| One | Two or more |", "| One Two or more |")
  .replace("| Built-in |", "| Built-in | |");

const HALF = GOOD.replace("|---|---|---|", "|---|---|");

describe("findTableIssuesInText", () => {
  it("reports nothing for a well-formed table", () => {
    expect(findTableIssuesInText(GOOD, "body")).toEqual([]);
  });

  it("names all three breakages with their line numbers", () => {
    const issues = findTableIssuesInText(BROKEN, "body");

    expect(issues.map((i) => [i.line, i.problem])).toEqual([
      [
        4,
        "the delimiter row has 2 column(s) but the header has 3 - the table does not render until they match",
      ],
      [6, "row has 2 cell(s), the header has 3 - a pipe between two cells is missing"],
      [7, "row has 4 cell(s), the header has 3 - a stray trailing pipe adds an empty cell"],
    ]);
  });

  it("still fails a table whose only remaining defect is the delimiter row", () => {
    const issues = findTableIssuesInText(HALF, "body");

    expect(issues).toHaveLength(1);
    expect(issues[0].problem).toMatch(/delimiter row has 2/u);
  });

  it("ignores pipes that are not a table, escaped pipes inside a cell, and alignment colons", () => {
    expect(findTableIssuesInText("Use a | b in prose.\nNo table here | either.", "body")).toEqual(
      []
    );
    expect(findTableIssuesInText("| a | b |\n|:--|--:|\n| x \\| y | z |", "body")).toEqual([]);
  });
});

describe("findTableIssuesOfEdit across a new document", () => {
  const fields: SchemaField[] = [
    { name: "title", type: "text" },
    { name: "contentMarkdown", type: "textarea" },
    { name: "faq", type: "array", fields: [{ name: "a", type: "textarea" }] as SchemaField[] },
  ] as SchemaField[];

  it("walks every text field, nested rows included, and skips rich text", () => {
    const doc = { title: "T", contentMarkdown: HALF, faq: [{ id: "r1", a: BROKEN }] };
    const issues = findTableIssuesOfEdit(fields, {}, doc);

    expect(issues.map((i) => i.fieldRef)).toEqual([
      "contentMarkdown",
      "faq[r1].a",
      "faq[r1].a",
      "faq[r1].a",
    ]);
  });
});

describe("findTableIssuesOfEdit: the tables the edit wrote or changed", () => {
  const fields: SchemaField[] = [
    { name: "title", type: "text" },
    { name: "contentMarkdown", type: "textarea" },
  ] as SchemaField[];
  const refs = (before: unknown, after: unknown) =>
    findTableIssuesOfEdit(fields, before, after).map((issue) => issue.fieldRef);

  it("leaves out a malformed table the edit did not touch", () => {
    const before = { title: "T", contentMarkdown: `Intro.\n\n${BROKEN}` };
    const after = { title: "T2", contentMarkdown: `A new intro, one line longer.\n\n${BROKEN}` };

    expect(refs(before, after)).toEqual([]);
  });

  it("reports the rows still malformed in a table the edit changed", () => {
    const before = { contentMarkdown: BROKEN };
    const after = { contentMarkdown: BROKEN.replace("|", "| ") };

    expect(findTableIssuesOfEdit(fields, {}, after).length).toBeGreaterThan(0);
    expect(refs(before, after)).toContain("contentMarkdown");
  });

  it("reports a malformed table the edit added", () => {
    expect(refs({ contentMarkdown: "No table." }, { contentMarkdown: BROKEN })).toContain(
      "contentMarkdown"
    );
  });
});
