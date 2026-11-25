import { describe, expect, it } from "vitest";
import { summarizeChanges } from "../src/agent/content/changeSummary.js";
import { standingChanges } from "../src/api/reviewEndpoint.js";
import type { ChangeInput } from "../src/agent/content/changeSummary.js";
import { reportCriteria } from "../src/agent/content/outcomeCriteria.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const schema: SchemaContext = {
  globals: [
    { slug: "settings", fields: [{ name: "motto", type: "text" }] as SchemaField[] } as never,
  ],
  collections: [
    {
      slug: "notes",
      fields: [
        { name: "summary", type: "textarea" },
        { name: "owner", type: "relationship", relationTo: "people" },
        { name: "rows", type: "array", fields: [{ name: "label", type: "text" }] },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

const note = (id: string, after: Record<string, unknown>, report?: unknown): ChangeInput => ({
  collection: "notes",
  id,
  before: { summary: "old", owner: 1, rows: [] },
  after: { summary: "old", owner: 1, rows: [], ...after },
  report,
});

describe("the broad view of what a conversation changed", () => {
  it("counts the documents by kind of change and names the common set of fields", () => {
    const summary = summarizeChanges(schema, [
      note("1", { summary: "new" }),
      note("2", { summary: "new" }),
      note("3", { summary: "new", owner: 2 }),
      { collection: "notes", id: "4", before: null, after: { summary: "made" }, report: null },
    ]);

    expect(summary.total).toBe(4);
    expect(summary.counts).toEqual({ text: 2, structure: 1, created: 1 });
    expect(summary.patterns).toEqual([
      { collection: "notes", fields: ["summary"], documents: 4, differ: 2 },
    ]);
  });

  it("puts a document with open issues first, then the ones that differ", () => {
    const summary = summarizeChanges(schema, [
      note("1", { summary: "new" }),
      note("2", { summary: "new", owner: 2 }),
      note("3", { summary: "new" }, { issues: ["a link returns 404"], criteria: [] }),
      note("4", { summary: "new" }),
    ]);

    expect(summary.documents.map((document) => document.id)).toEqual(["3", "2", "1", "4"]);
    expect(summary.withIssues).toBe(1);
    expect(summary.documents[1]).toMatchObject({ differs: true, kind: "structure" });
    expect(summary.documents[2].differs).toBe(false);
  });

  it("reads a global, and takes one document of a collection as no pattern", () => {
    const summary = summarizeChanges(schema, [
      {
        collection: "global:settings",
        id: "settings",
        before: { motto: "a" },
        after: { motto: "b" },
        report: {
          issues: [7, "kept"],
          criteria: [{ text: "present", result: "met" }, { text: 1 }],
        },
      },
    ]);

    expect(summary.patterns).toEqual([]);
    expect(summary.documents[0]).toMatchObject({
      kind: "text",
      fields: ["motto"],
      issues: ["kept"],
    });
    expect(summary.documents[0]).not.toHaveProperty("criteria");
  });
});

describe("the declared outcome, as the review panel shows it", () => {
  it("gives one line per criterion with its result", () => {
    const lines = reportCriteria([
      { ok: true, criterion: { path: "summary", check: { type: "present", text: "x" } } },
      {
        ok: false,
        detail: "the text is still there",
        criterion: { check: { type: "absent", text: "y" }, why: "the old name" },
      },
      {
        ok: true,
        deferred: true,
        criterion: { check: { type: "judgement", description: "the tone is formal" } },
      },
    ] as never);

    expect(lines).toEqual([
      { text: "present at summary", result: "met" },
      { text: "absent (the old name): the text is still there", result: "not-met" },
      { text: "the tone is formal", result: "not-checked" },
    ]);
  });
});

const row = (locale: string, op: string, summary: string) => ({
  collection: "notes",
  id: "7",
  op,
  locale,
  before: { summary: "old", owner: 1, rows: [] },
  after: { summary, owner: 1, rows: [] },
  restore: null,
  report: null,
});

describe("a document changed in several locales", () => {
  it("keeps the change of a locale that still stands when another locale was discarded last", () => {
    const standing = standingChanges([
      row("en", "discarded", "old"),
      row("de", "translate", "neu"),
      row("en", "edit", "new"),
    ]);

    expect(standing.map((change) => change.locale)).toEqual(["de"]);
    expect(summarizeChanges(schema, standing).total).toBe(1);
  });

  it("is one document in the summary, with the fields of every locale", () => {
    const summary = summarizeChanges(schema, [
      row("de", "translate", "neu"),
      { ...row("en", "edit", "new"), after: { summary: "new", owner: 2, rows: [] } },
    ]);

    expect(summary.total).toBe(1);
    expect(summary.documents[0].fields).toEqual(["summary", "owner"]);
    expect(summary.documents[0].kind).toBe("structure");
  });
});
