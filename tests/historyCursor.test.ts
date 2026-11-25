import { describe, expect, it } from "vitest";
import { historyCursor } from "../src/api/conversationsEndpoint.js";

describe("the cursor of the chat history", () => {
  it("takes only the time and the id that the server sends as nextCursor", () => {
    const next = "2026-11-24T10:00:00.000Z|0b7e2a52-3c1d-4f6e-9a8b-1c2d3e4f5a6b";

    expect(historyCursor(next)).toBe(next);
    expect(historyCursor("2026-11-24T10:00:00.000Z")).toBeUndefined();
    expect(historyCursor("2026-11-24T10:00:00.000Z|not-an-id")).toBeUndefined();
    expect(historyCursor(`${next}|extra`)).toBeUndefined();
    expect(historyCursor(null)).toBeUndefined();
  });
});
