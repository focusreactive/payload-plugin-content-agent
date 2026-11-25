import { describe, expect, it } from "vitest";
import { collectTextNodes } from "../src/agent/content/lexicalEngine.js";
import { applyTransform } from "../src/agent/content/richtext/surgical.js";

const text = (value: string) => ({
  type: "text",
  version: 1,
  text: value,
  format: 0,
  detail: 0,
  mode: "normal",
  style: "",
});
const link = (value: string, url: string) => ({
  type: "link",
  version: 1,
  fields: { linkType: "custom", url },
  children: [text(value)],
});
const paragraph = (...children: unknown[]) => ({ type: "paragraph", version: 1, children });
const cell = (...children: unknown[]) => ({ type: "tablecell", version: 1, children });
const table = (...cells: unknown[]) => ({
  type: "table",
  version: 1,
  children: [{ type: "tablerow", version: 1, children: cells }],
});
const body = (...children: unknown[]) => ({ root: { type: "root", version: 1, children } });
const texts = (value: unknown) => collectTextNodes(value).map((ref) => ref.node.text);

const content = () =>
  body(
    paragraph(text("Intro.")),
    table(
      cell(paragraph(text("Check the rules"), text(" Note: checked in March."))),
      cell(paragraph(text("Done")))
    ),
    paragraph(text("See "), link("the guide", "https://example.org/a"), text("."))
  );

describe("transform mode and an empty segment", () => {
  it("removes one piece of text of a table cell and keeps the rest of the table", () => {
    const result = applyTransform(content(), { "2": "" }, 7);

    expect("error" in result ? result.error : undefined).toBeUndefined();
    if ("error" in result) return;
    expect(texts(result.updated)).toEqual([
      "Intro.",
      "Check the rules",
      "Done",
      "See ",
      "the guide",
      ".",
    ]);
    const rows = (result.updated as any).root.children[1].children;

    expect(rows).toHaveLength(1);
    expect(rows[0].children).toHaveLength(2);
    expect(rows[0].children[0].children[0].children).toHaveLength(1);
  });

  it("refuses to empty the only text of a paragraph or of a cell", () => {
    for (const key of ["0", "3"]) {
      const result = applyTransform(content(), { [key]: "" }, 7);

      expect("error" in result ? result.error : "").toMatch(/the only text of its paragraph/u);
    }
  });

  it("refuses to empty every piece of text of one paragraph in one call", () => {
    const result = applyTransform(content(), { "1": "", "2": " " }, 7);

    expect("error" in result ? result.error : "").toMatch(/the only text of its paragraph/u);
  });

  it("refuses to empty the text of a link", () => {
    const result = applyTransform(content(), { "5": "" }, 7);

    expect("error" in result ? result.error : "").toMatch(/the text of a link/u);
  });
});
