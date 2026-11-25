import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@payloadcms/ui", () => ({
  useConfig: () => ({ config: {} }),
  getHTMLDiffComponents: undefined,
}));
const { ReviewRow } = await import("../src/ui/components/reviewRow.js");

const render = (isOpen: boolean, issues: string[]) =>
  renderToStaticMarkup(
    React.createElement(ReviewRow, {
      editedRef: { collection: "posts", id: "7" } as any,
      info: { collection: "posts", id: "7", kind: "text", fields: [], differs: false, issues },
      rowKey: "posts:7",
      state: undefined,
      isSelected: false,
      isPublished: false,
      isDiscarded: false,
      isOpen,
      adminRoute: "/admin",
      toggleSelect: () => undefined,
      toggleExpand: () => undefined,
    })
  );

describe("review list: the issues of a row", () => {
  it("shows the text of each issue when the row is open", () => {
    const html = render(true, ["The link to /pricing was not checked.", "A price changed."]);

    expect(html).toContain("2 issues");
    expect(html).toContain("Open issues for you to check");
    expect(html).toContain("The link to /pricing was not checked.");
    expect(html).toContain("A price changed.");
  });

  it("keeps the texts on the badge of a closed row and shows no list", () => {
    const html = render(false, ["A price changed."]);

    expect(html).toContain("1 issue");
    expect(html).toContain('title="A price changed."');
    expect(html).not.toContain("Open issues for you to check");
  });

  it("shows no issue block for a row without issues", () => {
    const html = render(true, []);

    expect(html).not.toContain("issue");
  });
});
