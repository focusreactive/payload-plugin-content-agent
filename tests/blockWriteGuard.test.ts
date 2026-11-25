import { describe, it, expect, vi } from "vitest";
import { containsBlocksArray, guardBlockWrites } from "../src/agent/tools/blockWriteGuard.js";

const opts = { toolCallId: "t", messages: [] } as any;

describe("containsBlocksArray", () => {
  it("detects a top-level blocks array", () => {
    expect(containsBlocksArray([{ blockType: "hero", heading: "x" }])).toBe(true);
  });
  it("detects blocks nested inside an object/group", () => {
    expect(containsBlocksArray({ layout: [{ blockType: "cta" }] })).toBe(true);
    expect(containsBlocksArray({ seo: { sections: [{ blockType: "hero" }] } })).toBe(true);
  });
  it("ignores plain arrays and scalars", () => {
    expect(containsBlocksArray([1, 2, 3])).toBe(false);
    expect(containsBlocksArray([{ id: 1, name: "tag" }])).toBe(false);
    expect(containsBlocksArray("hello")).toBe(false);
    expect(containsBlocksArray({ title: "Home", slug: "home" })).toBe(false);
  });
});

const makeTools = () => ({
  findPages: { execute: vi.fn().mockResolvedValue({ content: [{ text: "{}" }] }) },
  createPages: { execute: vi.fn().mockResolvedValue({ content: [{ text: '{"id":1}' }] }) },
  updatePages: { execute: vi.fn().mockResolvedValue({ content: [{ text: '{"id":1}' }] }) },
});

describe("guardBlockWrites", () => {
  it("refuses create/update when params carry a blocks array", async () => {
    const tools = makeTools();
    const guarded = guardBlockWrites(tools);
    const r: any = await guarded.createPages.execute(
      { title: "Home", slug: "home", layout: [{ blockType: "hero", heading: "Hi" }] },
      opts
    );

    expect(r.error).toContain("Refusing to write");
    expect(tools.createPages.execute).not.toHaveBeenCalled();
  });

  it("allows create/update of non-blocks fields", async () => {
    const tools = makeTools();
    const guarded = guardBlockWrites(tools);

    await guarded.updatePages.execute({ id: "1", title: "New title" }, opts);
    expect(tools.updatePages.execute).toHaveBeenCalledOnce();
  });

  it("does not touch find tools", async () => {
    const tools = makeTools();
    const guarded = guardBlockWrites(tools);

    await guarded.findPages.execute({ id: "1", draft: true }, opts);
    expect(tools.findPages.execute).toHaveBeenCalledOnce();
  });
});
