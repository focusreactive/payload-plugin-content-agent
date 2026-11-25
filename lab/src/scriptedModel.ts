// Type a script name in the chat, for example `script: table`. The step is the number of tool
// results after the last user message, so one stateless model serves every conversation.
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

type Part = Record<string, unknown>;
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const finish = (unified: string): Part => ({
  type: "finish",
  finishReason: { unified, raw: unified },
  usage,
});
const text = (value: string, id = "t1"): Part[] => [
  { type: "text-start", id },
  ...value.match(/\S+\s*/gu)!.map((delta) => ({ type: "text-delta", id, delta })),
  { type: "text-end", id },
];
const reasoning = (value: string): Part[] => [
  { type: "reasoning-start", id: "r1" },
  { type: "reasoning-delta", id: "r1", delta: value },
  { type: "reasoning-end", id: "r1" },
];
const call = (toolName: string, input: unknown, toolCallId = `call_${toolName}`): Part => ({
  type: "tool-call",
  toolCallId,
  toolName,
  input: JSON.stringify(input),
});

const SCRIPTS: Record<string, { about: string; delay?: number; steps: Part[][] }> = {
  thinking: {
    about: "a slow answer: the thinking line, then text",
    delay: 4000,
    steps: [[...text("This answer started after four seconds."), finish("stop")]],
  },
  reasoning: {
    about: "a reasoning summary, then text",
    steps: [
      [
        ...reasoning("**Checking the request**\n\nThe person wants a short answer."),
        ...text("Here is the short answer."),
        finish("stop"),
      ],
    ],
  },
  tool: {
    about: "a real tool call (the schema summary), then text",
    steps: [
      [call("getSchemaInfo", {}), finish("tool-calls")],
      [...text("The schema was read with a real tool call."), finish("stop")],
    ],
  },
  failed: {
    about: "a tool call that fails, then text",
    steps: [
      [call("readDocument", { collection: "no-such-collection", id: "1" }), finish("tool-calls")],
      [...text("The tool failed, as the script asked."), finish("stop")],
    ],
  },
  editerror: {
    about: "an edit call whose input the tool does not take: the step fails",
    steps: [
      [
        call("editContent", { collection: "posts", id: "1", instruction: 42 }),
        finish("tool-calls"),
      ],
      [...text("The edit step failed, as the script asked."), finish("stop")],
    ],
  },
  editrefused: {
    about: "an edit call that the tool refuses with an error",
    steps: [
      [
        call("editContent", { collection: "no-such-collection", id: "1", instruction: "Fix it." }),
        finish("tool-calls"),
      ],
      [...text("The edit was refused, as the script asked."), finish("stop")],
    ],
  },
  table: {
    about: "a table drawn in the chat",
    steps: [
      [
        call("present_table", {
          title: "Pages",
          columns: [
            { key: "page", label: "Page" },
            { key: "visits", label: "Visits" },
          ],
          rows: [
            { page: "/blog", visits: 1200 },
            { page: "/about", visits: 340 },
          ],
        }),
        finish("tool-calls"),
      ],
      [...text("The table is above."), finish("stop")],
    ],
  },
  metrics: {
    about: "a row of metric cards",
    steps: [
      [
        call("present_metrics", {
          title: "This week",
          cards: [
            { label: "Drafts", value: 12, change: { value: 20, direction: "up", good: true } },
            { label: "Published", value: 4 },
          ],
        }),
        finish("tool-calls"),
      ],
      [...text("The numbers are above."), finish("stop")],
    ],
  },
  chart: {
    about: "a line chart",
    steps: [
      [
        call("present_chart", {
          title: "Drafts per month",
          series: [
            {
              name: "Drafts",
              data: [
                { x: "Sep", y: 8 },
                { x: "Oct", y: 14 },
                { x: "Nov", y: 11 },
              ],
            },
          ],
        }),
        finish("tool-calls"),
      ],
      [...text("The chart is above."), finish("stop")],
    ],
  },
  cutoff: {
    about: "an answer cut off by the output limit",
    steps: [[...text("This answer stops in the middle of a"), finish("length")]],
  },
  error: {
    about: "a provider error in the middle of the answer",
    steps: [
      [
        ...text("Starting, then"),
        { type: "error", error: new Error("scripted provider error: overloaded") },
      ],
    ],
  },
  replace: {
    about:
      'a write with no model inside: replaces "Harbor" with "Harbour" in the pages (blog schema)',
    steps: [
      [
        call("findReplaceContent", {
          collection: "pages",
          find: "Harbor",
          replace: "Harbour",
          ids: [1, 2],
        }),
        finish("tool-calls"),
      ],
      [...text("Replaced in the pages. Open the review panel to see the change."), finish("stop")],
    ],
  },
  confirm: {
    about:
      'a write in six posts, so the chat asks the person first: replaces "Short" with "Brief" (blog schema)',
    steps: [
      [
        ...text("I will replace the word in six posts."),
        call("findReplaceContent", {
          collection: "posts",
          find: "Short",
          replace: "Brief",
          ids: [4, 5, 6, 7, 8, 9],
        }),
        finish("tool-calls"),
      ],
      [...text("Replaced in the posts. Open the review panel to see the change."), finish("stop")],
    ],
  },
  many: {
    about:
      "six direct updates in one step, so the chat asks the person before the sixth (blog schema)",
    steps: [
      [
        ...text("I will set the excerpt of six posts."),
        ...[4, 5, 6, 7, 8, 9].map((id) =>
          call(
            "updateDocument",
            { collection: "posts", id, data: { excerpt: "Part of the basics series." } },
            `call_many_${id}`
          )
        ),
        finish("tool-calls"),
      ],
      [...text("The excerpts are set. Open the review panel to see the change."), finish("stop")],
    ],
  },
  clear: {
    about: "an update that empties a field, so the chat asks the person first (blog schema)",
    steps: [
      [
        call("updateDocument", { collection: "posts", id: 2, data: { excerpt: "" } }),
        finish("tool-calls"),
      ],
      [...text("The excerpt of the post is empty now."), finish("stop")],
    ],
  },
  create: {
    about: "a new draft post (blog schema). The review panel lists it as created",
    steps: [
      [
        call("createDocument", {
          collection: "posts",
          data: { title: "A scripted draft", slug: "a-scripted-draft" },
        }),
        finish("tool-calls"),
      ],
      [...text("Created a draft post."), finish("stop")],
    ],
  },
};

const HELP = `Scripted model. Type "script: <name>". Scripts: ${Object.entries(SCRIPTS)
  .map(([name, s]) => `${name} (${s.about})`)
  .join("; ")}.`;

function lastUserText(prompt: any[]): { text: string; toolResultsAfter: number } {
  let index = -1;

  for (let i = prompt.length - 1; i >= 0; i--)
    if (prompt[i].role === "user") {
      index = i;
      break;
    }

  const content = index < 0 ? "" : prompt[index].content;
  const value =
    typeof content === "string"
      ? content
      : (content ?? []).map((part: any) => part.text ?? "").join(" ");

  return {
    text: value,
    toolResultsAfter: prompt.slice(index + 1).filter((m) => m.role === "tool").length,
  };
}

function parts(prompt: any[]): { chunks: Part[]; delay: number } {
  const { text: message, toolResultsAfter } = lastUserText(prompt);
  const script = SCRIPTS[message.match(/script:\s*([a-z]+)/iu)?.[1]?.toLowerCase() ?? ""];

  if (!script) return { chunks: [...text(HELP), finish("stop")], delay: 0 };
  const step = script.steps[Math.min(toolResultsAfter, script.steps.length - 1)];

  return { chunks: step, delay: toolResultsAfter === 0 ? (script.delay ?? 0) : 0 };
}

export function scriptedModel() {
  return new MockLanguageModelV3({
    doStream: async (options: any) => {
      const { chunks, delay } = parts(options.prompt);

      return {
        stream: simulateReadableStream({
          chunks: [{ type: "stream-start", warnings: [] }, ...chunks] as never,
          initialDelayInMs: delay,
          chunkDelayInMs: 40,
        }),
      };
    },
    // Sub-agents and background tasks call the model without a stream. No script needs them yet:
    // they get a short text, or an empty object when the caller asked for JSON.
    doGenerate: async (options: any) =>
      ({
        content: [
          {
            type: "text",
            text:
              options.responseFormat?.type === "json"
                ? "{}"
                : "Scripted model: no sub-agent script.",
          },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      }) as never,
  });
}
