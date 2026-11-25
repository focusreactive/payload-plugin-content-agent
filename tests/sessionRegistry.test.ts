import { describe, expect, it } from "vitest";
import { backgroundRunning, mountedSessions } from "../src/ui/sessionRegistry.js";

describe("mounted chat sessions (new chat must not hide a running turn)", () => {
  const a = { id: "a", isExisting: true };
  const b = { id: "b", isExisting: false };

  it("keeps the previous session mounted while it is running and the user opens a new chat", () => {
    const next = mountedSessions([a], b, { a: true });

    expect(next.map((s) => s.id)).toEqual(["a", "b"]);
    expect(backgroundRunning(next, "b", { a: true })).toEqual(["a"]);
  });

  it("drops a hidden session once it has finished", () => {
    const next = mountedSessions([a, b], b, { a: false });

    expect(next.map((s) => s.id)).toEqual(["b"]);
    expect(backgroundRunning(next, "b", {})).toEqual([]);
  });

  it("never drops the active session, running or not, and never lists it as background", () => {
    expect(mountedSessions([a, b], a, { a: true, b: true }).map((s) => s.id)).toEqual(["b", "a"]);
    expect(backgroundRunning([a, b], "a", { a: true, b: true })).toEqual(["b"]);
    expect(mountedSessions([], b, {}).map((s) => s.id)).toEqual(["b"]);
  });

  it("a session that was never started is dropped when the user moves on", () => {
    expect(mountedSessions([b], a, {}).map((s) => s.id)).toEqual(["a"]);
  });

  it("keeps a running session that started as new mounted as it is when it is selected again", () => {
    const mounted = mountedSessions([b], a, { b: true });
    const back = mountedSessions(mounted, { id: "b", isExisting: true }, { b: true });

    expect(back.find((s) => s.id === "b")).toBe(b);
  });
});
