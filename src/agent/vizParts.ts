import { isRecord } from "../borders.js";
import { visualKindOf } from "../sdk/visual.js";

export interface StoredToolPart {
  type: `tool-${string}`;
  toolCallId: string;
  state: "output-available";
  input: unknown;
  output: unknown;
}

const MAX_STORED_BYTES = 256_000;

export function collectVizParts(
  steps: ReadonlyArray<{ toolResults?: ReadonlyArray<unknown> }> | undefined
): StoredToolPart[] {
  const out: StoredToolPart[] = [];
  let bytes = 0;

  for (const step of steps ?? []) {
    for (const result of step.toolResults ?? []) {
      if (!isRecord(result) || typeof result.toolName !== "string" || !visualKindOf(result.output))
        continue;
      const part: StoredToolPart = {
        type: `tool-${result.toolName}`,
        toolCallId: String(result.toolCallId ?? ""),
        state: "output-available",
        input: result.input ?? {},
        output: result.output,
      };
      let size = 0;

      try {
        size = JSON.stringify(part).length;
      } catch {
        continue;
      }

      if (bytes + size > MAX_STORED_BYTES) break;
      bytes += size;
      out.push(part);
    }
  }

  return out;
}
