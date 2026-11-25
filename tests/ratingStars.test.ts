import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@payloadcms/ui", () => ({ useConfig: () => ({ config: {} }), useAuth: () => ({}) }));
const { Stars } = await import("../src/ui/ChatRating.js");

describe("the rating stars", () => {
  it("are buttons with a name, so a keyboard and a screen reader can pick one", () => {
    const html = renderToStaticMarkup(React.createElement(Stars, { value: 2, onPick: () => {} }));

    expect(html.match(/<button type="button" aria-label="\d of 5 stars"/gu)).toHaveLength(5);
    expect(html).toContain('aria-label="5 of 5 stars"');
  });

  it("name the given rating when they only show it", () => {
    const html = renderToStaticMarkup(React.createElement(Stars, { value: 4, readOnly: true }));

    expect(html).not.toContain("<button");
    expect(html).toContain("4 of 5 stars");
  });
});
