import type { LanguageModel, EmbeddingModel } from "ai";
import type { AIProvider } from "./types.js";

interface ResolvedModels {
  model: LanguageModel;
  backgroundModel: LanguageModel;
  subagentModel: LanguageModel;
  embeddingModel?: EmbeddingModel;
}

const PROVIDER_DEFAULTS: Record<
  AIProvider,
  {
    model: string;
    backgroundModel: string;
    subagentModel: string;
    embeddingModel?: string;
  }
> = {
  anthropic: {
    model: "claude-sonnet-5-5",
    backgroundModel: "claude-haiku-5-5",
    subagentModel: "claude-haiku-5-5",
  },
  openai: {
    model: "gpt-6.1-terra",
    backgroundModel: "gpt-6-luna",
    subagentModel: "gpt-6-luna",
    embeddingModel: "text-embedding-3-small",
  },
};

/** The values of the `provider` option. */
export const PROVIDERS = Object.keys(PROVIDER_DEFAULTS) as AIProvider[];

function resolveModel(
  override: string | LanguageModel | undefined,
  defaultId: string,
  providerFn: (id: string) => LanguageModel
): LanguageModel {
  if (!override) return providerFn(defaultId);
  if (typeof override === "string") return providerFn(override);

  return override;
}

export async function resolveModels(
  provider: AIProvider,
  overrides?: {
    model?: string | LanguageModel;
    backgroundModel?: string | LanguageModel;
    subagentModel?: string | LanguageModel;
    embeddingModel?: EmbeddingModel;
    apiKey?: string;
  }
): Promise<ResolvedModels> {
  const defaults = PROVIDER_DEFAULTS[provider];

  if (provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const anthropic = createAnthropic(overrides?.apiKey ? { apiKey: overrides.apiKey } : {});

    return {
      model: resolveModel(overrides?.model, defaults.model, anthropic),
      backgroundModel: resolveModel(
        overrides?.backgroundModel,
        defaults.backgroundModel,
        anthropic
      ),
      subagentModel: resolveModel(overrides?.subagentModel, defaults.subagentModel, anthropic),
      embeddingModel: overrides?.embeddingModel,
    };
  }

  if (provider === "openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const openai = createOpenAI(overrides?.apiKey ? { apiKey: overrides.apiKey } : {});

    return {
      model: resolveModel(overrides?.model, defaults.model, openai),
      backgroundModel: resolveModel(overrides?.backgroundModel, defaults.backgroundModel, openai),
      subagentModel: resolveModel(overrides?.subagentModel, defaults.subagentModel, openai),
      embeddingModel:
        overrides?.embeddingModel ??
        (defaults.embeddingModel ? openai.embedding(defaults.embeddingModel) : undefined),
    };
  }

  throw new Error(`[Content Agent] Unknown provider: ${provider}`);
}
