import { describe, it, expect } from "vitest";
import { keyedMarkdownView } from "../src/agent/subAgents/lexicalMarkdown.js";

const para = (text: string) => ({
  type: "paragraph",
  version: 1,
  direction: "ltr",
  format: "",
  indent: 0,
  textFormat: 0,
  textStyle: "",
  children: [{ type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" }],
});
const lexical = (...children: any[]) => ({
  root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children },
});

describe("surgical view with structural nodes (blocks/uploads)", () => {
  it("renders placeholders instead of throwing on block/upload/hr nodes", async () => {
    const content = lexical(
      para("Intro"),
      { type: "block", version: 2, fields: { id: "b1", blockType: "cta", heading: "Buy now" } },
      { type: "upload", version: 1, relationTo: "media", value: 7, fields: {} },
      { type: "horizontalrule", version: 1 },
      para("Outro")
    );
    const view = await keyedMarkdownView(content);

    expect(view).toContain("[0] Intro");
    expect(view).toContain("[1] <block: cta>");
    expect(view).toContain("[2] <upload>");
    expect(view).toContain("[3] <horizontalrule>");
    expect(view).toContain("[4] Outro");
    expect(view).toContain('expectedType:"block"');
  });
});
