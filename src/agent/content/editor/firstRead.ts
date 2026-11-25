import type { JSONValue, ModelMessage, Tool } from "ai";

const FIRST_READ = "getEditableContent";
const FIRST_READ_CALL_ID = "content-editor-first-read";

/**
 * Every session starts with the same read, so the code makes it: the editor finds the call and
 * its result in the conversation and spends no model step on it.
 */
export async function firstMessages(
  tools: Record<typeof FIRST_READ, Pick<Tool, "execute">>,
  prompt: string
): Promise<ModelMessage[]> {
  const toolCallId = FIRST_READ_CALL_ID;
  const value = await tools[FIRST_READ].execute!({}, { toolCallId, messages: [], context: {} });

  return [
    { role: "user", content: prompt },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId, toolName: FIRST_READ, input: {} }],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName: FIRST_READ,
          output: { type: "json", value: value as JSONValue },
        },
      ],
    },
  ];
}
