import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUuid } from "../src/ui/randomUuid.js";

afterEach(() => vi.unstubAllGlobals());

describe("a conversation id in the browser", () => {
  it("is a v4 UUID also where crypto.randomUUID is missing, as on an admin over plain HTTP", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ids = new Set(Array.from({ length: 50 }, () => randomUuid()));

    expect(ids.size).toBe(50);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });
});
