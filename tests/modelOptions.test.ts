import { describe, expect, it } from "vitest";
import { contentAgentPlugin } from "../src/plugin.js";

const instance = { specificationVersion: "v3", provider: "x", modelId: "m", doGenerate: () => {} };
const build = (options: Record<string, unknown>) => () =>
  contentAgentPlugin({ mcpApiKey: "k", ...options } as any)({} as any);

describe("the model options, checked when the config is built", () => {
  it("refuses a model id without a provider, for every model option", () => {
    expect(build({ model: instance, subagentModel: "some-model" })).toThrow(
      /`subagentModel` is a model id, and a model id needs `provider`/u
    );
    expect(build({ model: instance, backgroundModel: "some-model" })).toThrow(/backgroundModel/u);
    expect(build({ model: "some-model" })).toThrow(/`model` is a model id/u);
  });

  it("refuses an unknown provider and names the values", () => {
    expect(build({ provider: "Anthropic" })).toThrow(
      /Unknown provider "Anthropic"[\s\S]*"anthropic"/u
    );
  });

  it("builds with a provider and model ids, or with model instances only", () => {
    expect(build({ provider: "openai", subagentModel: "some-model" })).not.toThrow();
    expect(build({ model: instance, subagentModel: instance })).not.toThrow();
  });
});
