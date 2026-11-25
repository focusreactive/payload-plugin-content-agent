import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createMemoryTools } from "../src/agent/tools/memoryTools.js";

function makeTools() {
  const presentState = {
    setMission: vi.fn(async () => undefined),
    setStatus: vi.fn(async () => undefined),
    updateTasks: vi.fn(async () => undefined),
  };
  const tools: Record<string, any> = createMemoryTools({
    memory: { presentState } as any,
    options: {} as any,
    conversationId: "conv-1",
    userId: "user-1",
  });

  return { tools, presentState };
}

const opts: any = { toolCallId: "t", messages: [] };
const tasks = [
  { id: "a", content: "First step", status: "completed" },
  { id: "b", content: "Second step", status: "blocked", blockedReason: "Waits for a reply" },
];

describe("present_progress: the mission, the tasks and the status in one tool", () => {
  it("is the one progress tool of the memory tools", () => {
    const { tools } = makeTools();

    expect(Object.keys(tools).sort()).toEqual(["present_progress", "reflect"]);
  });

  it("saves the mission alone and leaves the tasks and the status as they are", async () => {
    const { tools, presentState } = makeTools();
    const res = await tools.present_progress.execute({ mission: "Move the catalogue" }, opts);

    expect(res).toEqual({ ok: true, mission: "Move the catalogue" });
    expect(presentState.setMission).toHaveBeenCalledWith("conv-1", "Move the catalogue");
    expect(presentState.updateTasks).not.toHaveBeenCalled();
    expect(presentState.setStatus).not.toHaveBeenCalled();
  });

  it("saves the task list alone, also an empty one", async () => {
    const { tools, presentState } = makeTools();

    expect(await tools.present_progress.execute({ tasks }, opts)).toEqual({
      ok: true,
      taskCount: 2,
    });
    expect(presentState.updateTasks).toHaveBeenCalledWith("conv-1", tasks);
    expect(await tools.present_progress.execute({ tasks: [] }, opts)).toEqual({
      ok: true,
      taskCount: 0,
    });
    expect(presentState.updateTasks).toHaveBeenLastCalledWith("conv-1", []);
    expect(presentState.setMission).not.toHaveBeenCalled();
    expect(presentState.setStatus).not.toHaveBeenCalled();
  });

  it("saves the status alone", async () => {
    const { tools, presentState } = makeTools();

    expect(await tools.present_progress.execute({ status: "Half done" }, opts)).toEqual({
      ok: true,
      status: "Half done",
    });
    expect(presentState.setStatus).toHaveBeenCalledWith("conv-1", "Half done");
    expect(presentState.setMission).not.toHaveBeenCalled();
    expect(presentState.updateTasks).not.toHaveBeenCalled();
  });

  it("saves all three in one call", async () => {
    const { tools, presentState } = makeTools();
    const res = await tools.present_progress.execute(
      { mission: "Move the catalogue", tasks, status: "Half done" },
      opts
    );

    expect(res).toEqual({
      ok: true,
      mission: "Move the catalogue",
      taskCount: 2,
      status: "Half done",
    });
    expect(presentState.setMission).toHaveBeenCalledTimes(1);
    expect(presentState.updateTasks).toHaveBeenCalledTimes(1);
    expect(presentState.setStatus).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty call, names the fields and writes nothing", async () => {
    const { tools, presentState } = makeTools();
    const res = await tools.present_progress.execute({}, opts);

    expect(res.error).toBe("Pass at least one of `mission`, `tasks` or `status`.");
    expect(presentState.setMission).not.toHaveBeenCalled();
    expect(presentState.updateTasks).not.toHaveBeenCalled();
    expect(presentState.setStatus).not.toHaveBeenCalled();
  });

  it("keeps the limits of each field", () => {
    const { tools } = makeTools();
    const input: z.ZodType = tools.present_progress.inputSchema;
    const valid = (value: unknown) => input.safeParse(value).success;

    expect(valid({ mission: "x".repeat(2000) })).toBe(true);
    expect(valid({ mission: "" })).toBe(false);
    expect(valid({ mission: "x".repeat(2001) })).toBe(false);
    expect(valid({ status: "" })).toBe(false);
    expect(valid({ status: "x".repeat(2001) })).toBe(false);
    expect(valid({ tasks })).toBe(true);
    expect(valid({ tasks: [{ id: "a", content: "First step", status: "done" }] })).toBe(false);
    expect(valid({ tasks: [{ content: "First step", status: "pending" }] })).toBe(false);
  });

  it("reports a failed save as an error", async () => {
    const { tools, presentState } = makeTools();

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    presentState.setStatus.mockRejectedValueOnce(new Error("connection lost"));
    const res = await tools.present_progress.execute({ status: "Half done" }, opts);

    expect(res.error).toContain("connection lost");
    vi.restoreAllMocks();
  });
});
