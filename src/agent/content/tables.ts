import type { SchemaField } from "../../types.js";
import { collectContentFields } from "./discovery.js";

export interface TableIssue {
  fieldRef: string;
  line: number;
  problem: string;
}

const DELIMITER_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/u;

function cells(line: string): string[] {
  const parts = line
    .replace(/\\\|/gu, "\u0000")
    .split("|")
    // oxlint-disable-next-line no-control-regex
    .map((cell) => cell.replace(/\u0000/gu, "\\|"));

  if (parts.length && parts[0].trim() === "") parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();

  return parts;
}

export function findTableIssuesInText(text: string, fieldRef: string): TableIssue[] {
  const out: TableIssue[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    if (
      !lines[i].includes("|") ||
      i + 1 >= lines.length ||
      !DELIMITER_ROW.test(lines[i + 1]) ||
      !lines[i + 1].includes("|")
    ) {
      i++;
      continue;
    }

    const headerCount = cells(lines[i]).length;
    const delimCount = cells(lines[i + 1]).length;

    if (delimCount !== headerCount) {
      out.push({
        fieldRef,
        line: i + 2,
        problem: `the delimiter row has ${delimCount} column(s) but the header has ${headerCount} - the table does not render until they match`,
      });
    }

    let j = i + 2;

    while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
      const cellCount = cells(lines[j]).length;

      if (cellCount !== headerCount) {
        const trailing = /\|\s*\|\s*$/u.test(lines[j]);

        out.push({
          fieldRef,
          line: j + 1,
          problem: `row has ${cellCount} cell(s), the header has ${headerCount}${cellCount < headerCount ? " - a pipe between two cells is missing" : trailing ? " - a stray trailing pipe adds an empty cell" : ""}`,
        });
      }

      j++;
    }

    i = j;
  }

  return out;
}

const tableLines = (text: string): string =>
  text
    .split("\n")
    .filter((line) => line.includes("|"))
    .join("\n");

function tableTexts(fields: SchemaField[], doc: unknown): Map<string, string> {
  const out = new Map<string, string>();

  for (const leaf of collectContentFields(fields, doc)) {
    if (
      leaf.richText ||
      leaf.embeddedInRichText ||
      typeof leaf.value !== "string" ||
      !leaf.value.includes("|")
    )
      continue;
    out.set(leaf.ref, leaf.value);
  }

  return out;
}

/** The malformed rows in the tables this edit wrote or changed. A table the edit left as it
 *  was is not its work to fix. */
export function findTableIssuesOfEdit(
  fields: SchemaField[],
  before: unknown,
  after: unknown
): TableIssue[] {
  const opened = tableTexts(fields, before);

  return [...tableTexts(fields, after)].flatMap(([ref, text]) =>
    tableLines(opened.get(ref) ?? "") === tableLines(text) ? [] : findTableIssuesInText(text, ref)
  );
}

export function describeTableIssue(issue: TableIssue): string {
  return `${issue.fieldRef} line ${issue.line}: ${issue.problem}`;
}
