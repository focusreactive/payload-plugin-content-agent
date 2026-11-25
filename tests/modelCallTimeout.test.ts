import { generateText, streamText } from "ai";
import { describe, expect, it } from "vitest";

import { ModelCallTimeoutError, withCallTimeout } from "../src/modelCallTimeout.js";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const model = (doGenerate: (options: any) => Promise<any>): any => ({
  specificationVersion: "v4",
  provider: "test.provider",
  modelId: "test-model",
  supportedUrls: {},
  doGenerate,
  doStream: async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "t" });
        controller.enqueue({ type: "text-delta", id: "t", delta: "streamed" });
        controller.enqueue({ type: "text-end", id: "t" });
        controller.enqueue({ type: "finish", finishReason: { unified: "stop" }, usage });
        controller.close();
      },
    }),
  }),
});

const answers = async () => ({
  content: [{ type: "text", text: "done" }],
  finishReason: { unified: "stop" },
  usage,
  warnings: [],
});

const hangs = ({ abortSignal }: any) =>
  new Promise((_resolve, reject) => {
    if (abortSignal.aborted) reject(abortSignal.reason);
    abortSignal.addEventListener("abort", () => reject(abortSignal.reason));
  });

describe("model call timeout", () => {
  it("keeps the model id and the provider, and passes an answer through", async () => {
    const wrapped = withCallTimeout(model(answers), 1000);

    expect(wrapped.modelId).toBe("test-model");
    expect(wrapped.provider).toBe("test.provider");
    expect((await generateText({ model: wrapped, prompt: "x" })).text).toBe("done");
  });

  it("stops a call that does not answer and says how long it waited", async () => {
    const wrapped = withCallTimeout(model(hangs), 1000);
    const call = generateText({ model: wrapped, prompt: "x", maxRetries: 3 });

    await expect(call).rejects.toBeInstanceOf(ModelCallTimeoutError);
    await expect(call).rejects.toThrow("The model did not answer in 1 seconds.");
  });

  it("still follows the abort of the caller", async () => {
    const caller = new AbortController();
    const call = generateText({
      model: withCallTimeout(model(hangs), 60_000),
      prompt: "x",
      abortSignal: caller.signal,
    });

    caller.abort();
    await expect(call).rejects.not.toBeInstanceOf(ModelCallTimeoutError);
  });

  it("puts no limit on a streamed call", async () => {
    const result = streamText({ model: withCallTimeout(model(hangs), 20), prompt: "x" });

    expect(await result.text).toBe("streamed");
  });

  it("leaves a model given as an id as it is", () => {
    expect(withCallTimeout("some-id")).toBe("some-id");
    expect(withCallTimeout(undefined)).toBeUndefined();
  });
});
