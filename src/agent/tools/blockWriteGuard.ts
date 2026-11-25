import type { McpCallOptions, McpTool } from "../../borders.js";
import { isObjectLike } from "../content/discovery.js";
import { UPDATE_CONTROL_KEYS } from "./mcp/controlKeys.js";

export function containsBlocksArray(value: unknown, depth = 0): boolean {
  if (depth > 100) return false;

  if (Array.isArray(value)) {
    if (value.some((item: unknown) => isObjectLike(item) && typeof item.blockType === "string"))
      return true;

    return value.some((item: unknown) => containsBlocksArray(item, depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.values(value).some((nested) => containsBlocksArray(nested, depth + 1));
  }

  return false;
}

// Only the tools exposed to the agent are guarded:
// internal callers keep the unguarded tools to save composed blocks.
export function guardBlockWrites<ToolType extends McpTool>(
  tools: Record<string, ToolType>
): Record<string, ToolType> {
  const out: Record<string, ToolType> = {};

  for (const [name, tool] of Object.entries(tools)) {
    const lower = name.toLowerCase();
    const isWrite = lower.startsWith("create") || lower.startsWith("update");
    const execute = tool?.execute;

    if (!isWrite || typeof execute !== "function") {
      out[name] = tool;
      continue;
    }

    out[name] = {
      ...tool,
      execute: async (params: Record<string, unknown>, opts: McpCallOptions) => {
        if (params && typeof params === "object") {
          for (const [key, value] of Object.entries(params)) {
            if (UPDATE_CONTROL_KEYS.has(key)) continue;

            if (containsBlocksArray(value)) {
              return {
                error:
                  `Refusing to write the "${key}" blocks/layout field directly via ${name}. ` +
                  `Create or update the document WITHOUT that field, then compose its sections with ` +
                  `editContent({ collection, id, instruction }) - it validates every block against the schema. ` +
                  `Never pass a blocks array to create/update.`,
              };
            }
          }
        }

        return execute.call(tool, params, opts);
      },
    };
  }

  return out;
}
