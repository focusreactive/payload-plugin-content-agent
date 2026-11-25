import { describe, it, expect } from "vitest";
import { trimAfterHeading } from "../src/agent/subAgents/programmaticOps.js";

function makeLexicalDoc(nodes: any[]) {
  return {
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: nodes,
    },
  };
}

function paragraph(text: string) {
  return {
    type: "paragraph",
    version: 1,
    direction: "ltr",
    format: "",
    indent: 0,
    textFormat: 0,
    textStyle: "",
    children: [{ type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" }],
  };
}

function heading(tag: string, text: string) {
  return {
    type: "heading",
    tag,
    version: 1,
    direction: "ltr",
    format: "",
    indent: 0,
    children: [{ type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" }],
  };
}

const testDoc = makeLexicalDoc([
  heading("h1", "Main Title"),
  paragraph("Introduction paragraph."),
  heading("h2", "Section One"),
  paragraph("Body content here."),
  heading("h2", "Related Posts"),
  paragraph("Link to post 1"),
  paragraph("Link to post 2"),
]);

describe("trimAfterHeading", () => {
  it("removes heading and everything after it", () => {
    const { content, removedCount }: { content: any; removedCount: number } = trimAfterHeading(
      testDoc,
      "Related Posts"
    );

    expect(removedCount).toBe(3);
    expect(content.root.children).toHaveLength(4);
    expect(content.root.children[0].children[0].text).toBe("Main Title");
    expect(content.root.children[2].children[0].text).toBe("Section One");
  });

  it("is case-insensitive", () => {
    const { content, removedCount }: { content: any; removedCount: number } = trimAfterHeading(
      testDoc,
      "related posts"
    );

    expect(removedCount).toBe(3);
    expect(content.root.children).toHaveLength(4);
  });

  it("trims whitespace in search", () => {
    const { content, removedCount }: { content: any; removedCount: number } = trimAfterHeading(
      testDoc,
      "  Related Posts  "
    );

    expect(removedCount).toBe(3);
    expect(content.root.children).toHaveLength(4);
  });

  it("returns no changes when heading not found", () => {
    const { content, removedCount }: { content: any; removedCount: number } = trimAfterHeading(
      testDoc,
      "Nonexistent Heading"
    );

    expect(removedCount).toBe(0);
    expect(content).toBe(testDoc);
  });

  it("removes everything when first heading matches", () => {
    const { content, removedCount }: { content: any; removedCount: number } = trimAfterHeading(
      testDoc,
      "Main Title"
    );

    expect(removedCount).toBe(7);
    expect(content.root.children).toHaveLength(0);
  });

  it("does not modify original document", () => {
    const originalLength = testDoc.root.children.length;

    trimAfterHeading(testDoc, "Related Posts");
    expect(testDoc.root.children).toHaveLength(originalLength);
  });

  it("handles empty document", () => {
    const emptyDoc = makeLexicalDoc([]);
    const { content, removedCount }: { content: any; removedCount: number } = trimAfterHeading(
      emptyDoc,
      "Anything"
    );

    expect(removedCount).toBe(0);
    expect(content.root.children).toHaveLength(0);
  });
});
