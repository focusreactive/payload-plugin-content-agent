import { randomUUID } from "node:crypto";
import { createMCPClient } from "@ai-sdk/mcp";
import { generateText, stepCountIs } from "ai";

// An agent outside the admin: a model with the tools of the MCP endpoint of the site and nothing
// else. It gets the instructions of the server, as a client that shows them to its model does.
const ROLE =
  "You work on the content of a website through the tools of its MCP server. Do what the person asks. When you are done, say in a few sentences what you did and what you could not do.";

async function languageModel(provider, modelId, apiKey) {
  if (provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");

    return createAnthropic({ apiKey })(modelId);
  }

  const { createOpenAI } = await import("@ai-sdk/openai");

  return createOpenAI({ apiKey })(modelId);
}

const textOf = (output) => {
  if (typeof output === "string") return output;
  const part = output?.content?.find?.((entry) => entry?.type === "text");

  return typeof part?.text === "string" ? part.text : JSON.stringify(output ?? null);
};

function errorOf(output) {
  const text = textOf(output);

  try {
    const parsed = JSON.parse(text);

    if (typeof parsed?.error === "string") return parsed.error;
  } catch {
    // Not JSON: the text itself is the result.
  }

  return output?.isError ? text : null;
}

function callsOf(steps) {
  const calls = [];

  for (const step of steps) {
    const results = new Map((step.toolResults ?? []).map((result) => [result.toolCallId, result]));
    const failures = new Map(
      (step.content ?? [])
        .filter((part) => part.type === "tool-error")
        .map((part) => [part.toolCallId, part])
    );

    for (const call of step.toolCalls ?? []) {
      const failure = failures.get(call.toolCallId);
      const result = results.get(call.toolCallId);
      const error = failure
        ? String(failure.error?.message ?? failure.error)
        : errorOf(result?.output);

      calls.push({
        tool: call.toolName,
        input: call.input,
        ...(error ? { error: error.slice(0, 600) } : {}),
      });
    }
  }

  return calls;
}

export async function createOutsideAgent({
  base,
  mcpKey,
  provider,
  modelId,
  apiKey,
  maxSteps = 30,
}) {
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: `${base}/api/mcp`,
      headers: { Authorization: `Bearer ${mcpKey}` },
    },
  });
  const tools = await client.tools();
  const model = await languageModel(provider, modelId, apiKey);
  const system = [ROLE, client.instructions].filter(Boolean).join("\n\n");

  return {
    toolNames: Object.keys(tools),
    instructions: client.instructions ?? null,

    async send(prompt) {
      const started = Date.now();
      const conversationId = randomUUID();

      try {
        const result = await generateText({
          model,
          system,
          prompt,
          tools,
          stopWhen: stepCountIs(maxSteps),
        });
        const calls = callsOf(result.steps);
        const usage = result.totalUsage ?? {};

        return {
          conversationId,
          text: result.text,
          tools: calls.map((call) => call.tool),
          calls,
          error: null,
          finishReason: result.finishReason,
          seconds: (Date.now() - started) / 1000,
          metrics: {
            steps: result.steps.length,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cachedShare: usage.inputTokens
              ? (usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0) /
                usage.inputTokens
              : 0,
            toolCalls: calls.length,
            failedToolCalls: calls.filter((call) => call.error).length,
          },
        };
      } catch (err) {
        return {
          conversationId,
          text: "",
          tools: [],
          calls: [],
          error: String(err?.message ?? err).slice(0, 500),
          finishReason: null,
          seconds: (Date.now() - started) / 1000,
          metrics: null,
        };
      }
    },

    // One tool call with no model, for a scenario that tests the endpoint itself.
    async call(name, input) {
      const tool = tools[name];

      if (!tool) return { error: `The endpoint has no tool "${name}".` };
      const output = await tool.execute(input, { toolCallId: randomUUID(), messages: [] });
      const error = errorOf(output);
      const text = textOf(output);

      if (error) return { error };

      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    },

    close: () => client.close(),
  };
}
