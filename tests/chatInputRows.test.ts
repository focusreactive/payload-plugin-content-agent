import { describe, it, expect } from "vitest";
import { rowsHeight } from "../src/ui/ChatInput.js";

const style = (over: Partial<Record<string, string>> = {}) =>
  ({
    fontSize: "15px",
    lineHeight: "22.5px",
    paddingTop: "10px",
    paddingBottom: "10px",
    borderTopWidth: "1px",
    borderBottomWidth: "1px",
    ...over,
  }) as any;

describe("rowsHeight", () => {
  it("is three lines plus padding and border", () => {
    expect(rowsHeight({}, style())).toBe(90);
  });

  it('falls back on a font-size multiple when line-height is "normal"', () => {
    expect(rowsHeight({}, style({ lineHeight: "normal" }))).toBe(Math.round(15 * 1.5 * 3 + 22));
  });

  it("tracks the type scale instead of a pixel constant", () => {
    const small = rowsHeight({}, style({ fontSize: "13px", lineHeight: "19.5px" }));
    const large = rowsHeight({}, style({ fontSize: "18px", lineHeight: "27px" }));

    expect(large).toBeGreaterThan(small);
  });

  it("survives missing padding/border values without producing NaN", () => {
    const h = rowsHeight(
      {},
      style({ paddingTop: "", paddingBottom: "", borderTopWidth: "", borderBottomWidth: "" })
    );

    expect(Number.isFinite(h)).toBe(true);
    expect(h).toBe(Math.round(22.5 * 3));
  });

  it("honours an explicit row count", () => {
    expect(rowsHeight({}, style(), 1)).toBeLessThan(rowsHeight({}, style(), 3));
  });
});
