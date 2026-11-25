import { afterEach, describe, expect, it, vi } from "vitest";

let reachesSave = false;

vi.mock("../src/agent/content/editor/session.js", () => ({
  runContentEditor: (run: { onSaveStart?: () => void }) => {
    if (reachesSave) run.onSaveStart?.();

    return new Promise(() => {});
  },
}));

const { runWithTimeout } = await import("../src/agent/content/editor/timedRun.js");

const run = () =>
  runWithTimeout({
    deps: {} as never,
    target: { collection: "posts" },
    id: 7,
    instruction: "x",
    timeoutMs: 1000,
  });

afterEach(() => vi.useRealTimers());

describe("the deadline of one document of a run", () => {
  it("says nothing was saved when the run never reached the save", async () => {
    vi.useFakeTimers();
    reachesSave = false;
    const result = run();

    await vi.advanceTimersByTimeAsync(7000);
    expect((await result).error).toMatch(/was not saved/u);
  });

  it("says the save may still land when the save had started", async () => {
    vi.useFakeTimers();
    reachesSave = true;
    const result = run();

    await vi.advanceTimersByTimeAsync(7000);
    const { error } = await result;

    expect(error).not.toMatch(/was not saved/u);
    expect(error).toMatch(/may still/u);
    expect(error).toMatch(/Read the document/u);
  });
});
