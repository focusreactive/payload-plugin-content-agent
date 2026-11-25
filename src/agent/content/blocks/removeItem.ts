import { z } from "zod";
import { tool } from "ai";
import { parsePath, rowId } from "../discovery.js";
import { itemNotFoundError } from "../../toolErrors.js";
import { resolveContainer } from "./containers.js";
import type { BlockToolsContext } from "./containers.js";

async function removeItem(context: BlockToolsContext, { path, id }: { path: string; id: string }) {
  const resolved = resolveContainer(context, parsePath(path));

  if ("error" in resolved) return { error: resolved.error };
  const { array } = resolved;
  const i = array.findIndex((row) => rowId(row) === String(id));

  if (i === -1) return { error: itemNotFoundError(id, path, array) };
  const { minRows } = resolved.field;

  if (minRows !== undefined && array.length <= minRows)
    return {
      error: `"${path}" holds ${array.length} item(s) and needs at least ${minRows}, so none can be removed. Change the item with setValues, or add another one with insertItem first.`,
    };
  const refused = context.guards.remove?.(array[i], path);

  if (refused) return { error: refused };
  array.splice(i, 1);

  return { ok: true, id, count: array.length };
}

export function createRemoveItemTool(context: BlockToolsContext) {
  return tool({
    description:
      "Remove an item (a block or an array row) from its container, addressed by id. A container with a minimum number of items refuses a removal below it.",
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "Path to the blocks array or plain array field: a `path` from `structure` of getEditableContent."
        ),
      id: z
        .string()
        .describe("The id of the item to remove, from `items` of that path in `structure`."),
    }),
    execute: (input: { path: string; id: string }) => removeItem(context, input),
  });
}
