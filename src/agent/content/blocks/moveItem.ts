import { z } from "zod";
import { tool } from "ai";
import { parsePath, rowId } from "../discovery.js";
import { itemNotFoundError } from "../../toolErrors.js";
import { resolveContainer } from "./containers.js";
import type { BlockToolsContext } from "./containers.js";

async function moveItem(
  context: BlockToolsContext,
  { path, id, toIndex }: { path: string; id: string; toIndex: number }
) {
  const resolved = resolveContainer(context, parsePath(path));

  if ("error" in resolved) return { error: resolved.error };
  const { array } = resolved;
  const from = array.findIndex((row) => rowId(row) === String(id));

  if (from === -1) return { error: itemNotFoundError(id, path, array) };
  const [item] = array.splice(from, 1);
  const to = Math.max(0, Math.min(Math.trunc(toIndex), array.length));

  array.splice(to, 0, item);

  return { ok: true, id, from, to };
}

export function createMoveItemTool(context: BlockToolsContext) {
  return tool({
    description:
      "Reorder an item (a block or an array row) within its container, addressed by id. toIndex is the 0-based position the item has after the move. The result gives the old and the new position.",
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "Path to the blocks array or plain array field: a `path` from `structure` of getEditableContent."
        ),
      id: z
        .string()
        .describe("The id of the item to move, from `items` of that path in `structure`."),
      toIndex: z
        .number()
        .int()
        .min(0)
        .describe(
          "The 0-based position of the item after the move: 0 is first; a number past the end puts it last."
        ),
    }),
    execute: (input: { path: string; id: string; toIndex: number }) => moveItem(context, input),
  });
}
