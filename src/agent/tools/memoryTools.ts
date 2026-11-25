import { tool } from "ai";
import { z } from "zod";
import type { MemoryService } from "../../memory/index.js";
import type { ResolvedPluginOptions } from "../../types.js";
import { runReflection } from "../../memory/reflect.js";
import type { Task } from "../../memory/storage/present.js";
import { withErrorHandling } from "./utils.js";

export interface MemoryToolsOptions {
  memory: MemoryService;
  options: ResolvedPluginOptions;
  conversationId: string;
  userId: string;
}

function createReflectTool(memory: MemoryService, options: ResolvedPluginOptions, userId: string) {
  return tool({
    description:
      'Search your memory - past conversations and long-term knowledge. Use this when the user references something from a previous conversation, asks "do you remember", or when historical context would help. Memory holds what no document holds: what was discussed, who asked for a change and why something was decided. The CMS holds what exists now, so read the document for the current value of a field. A field that names a person is content; who made a change is found here.',
    inputSchema: z.object({
      question: z.string().describe("What to search for in memory"),
    }),
    execute: withErrorHandling(async ({ question }) => {
      const model = options.backgroundModel ?? options.model;
      const answer = await runReflection(question, userId, memory, model);

      return { answer };
    }),
  });
}

interface ProgressInput {
  mission?: string;
  tasks?: Task[];
  status?: string;
}

async function saveProgress(
  memory: MemoryService,
  conversationId: string,
  { mission, tasks, status }: ProgressInput
) {
  if (mission === undefined && tasks === undefined && status === undefined)
    return { error: "Pass at least one of `mission`, `tasks` or `status`." };
  if (mission !== undefined) await memory.presentState.setMission(conversationId, mission);
  if (tasks !== undefined) await memory.presentState.updateTasks(conversationId, tasks);
  if (status !== undefined) await memory.presentState.setStatus(conversationId, status);

  return {
    ok: true,
    ...(mission === undefined ? {} : { mission }),
    ...(tasks === undefined ? {} : { taskCount: tasks.length }),
    ...(status === undefined ? {} : { status }),
  };
}

function createProgressTool(memory: MemoryService, conversationId: string) {
  return tool({
    description:
      "Keep the progress of multi-step work in this conversation. Pass at least one of: `mission` - the current mission/goal, when the user describes a multi-step project or overarching objective; `tasks` - the task list of the mission, to break the work into trackable steps; `status` - the current status within the mission, to track progress on the overall goal. What you omit stays as it is.",
    inputSchema: z.object({
      mission: z
        .string()
        .min(1)
        .max(2000)
        .optional()
        .describe("The mission or goal description (max 2000 chars)"),
      tasks: z
        .array(
          z.object({
            id: z.string().describe("Unique task identifier"),
            content: z.string().describe("Task description"),
            status: z
              .enum(["pending", "in_progress", "completed", "blocked"])
              .describe("The state of the task. With `blocked`, give `blockedReason`."),
            blockedReason: z.string().optional().describe("Why the task is blocked"),
          })
        )
        .optional()
        .describe("Full task list (replaces previous tasks)"),
      status: z
        .string()
        .min(1)
        .max(2000)
        .optional()
        .describe("Current status description (max 2000 chars)"),
    }),
    execute: withErrorHandling((input: ProgressInput) =>
      saveProgress(memory, conversationId, input)
    ),
  });
}

export function createMemoryTools({ memory, options, conversationId, userId }: MemoryToolsOptions) {
  return {
    reflect: createReflectTool(memory, options, userId),
    present_progress: createProgressTool(memory, conversationId),
  };
}
