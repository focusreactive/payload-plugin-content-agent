import { beforeEach, describe, it, expect, vi } from "vitest";

let finishDistillation!: () => void;
let finishCuration!: () => void;
let curations = 0;
let curationWaits = true;

vi.mock("../src/memory/distillation.js", () => ({
  runDistillation: () =>
    new Promise<void>((r) => {
      finishDistillation = r;
    }),
  runConversationSummary: async () => {},
}));
vi.mock("../src/memory/ltmCurator.js", () => ({
  runLtmCuration: () => {
    curations += 1;
    if (!curationWaits) return Promise.resolve();

    return new Promise<void>((r) => {
      finishCuration = r;
    });
  },
}));

const { MemoryService } = await import("../src/memory/index.js");

describe("MemoryService.runBackgroundTasks", () => {
  beforeEach(() => {
    curations = 0;
    curationWaits = true;
  });

  it("resolves only after distillation and curation finish", async () => {
    const memory = new MemoryService({} as any);

    memory.ltmCurator = true;
    const ctx: any = { backgroundReports: [], needsCompaction: true };
    let settled = false;
    const run = (async () => {
      await memory.runBackgroundTasks("c1", "u1", {} as any, ctx);
      settled = true;
    })();

    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    finishDistillation();
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    finishCuration();
    await run;
    expect(settled).toBe(true);
  });

  it("does not run the curator unless the host turns it on", async () => {
    // A curator started by mistake ends at once, so the assertion below names the rule.
    curationWaits = false;
    const memory = new MemoryService({} as any);
    const ctx: any = { backgroundReports: [], needsCompaction: true };
    const run = memory.runBackgroundTasks("c1", "u1", {} as any, ctx);

    await new Promise((r) => setTimeout(r, 10));
    finishDistillation();
    await run;
    expect(curations).toBe(0);
  });
});
