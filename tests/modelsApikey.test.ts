import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-sdk/openai", () => {
  const createOpenAI = vi.fn((opts?: any) => {
    const client: any = (id: string) => ({ id, opts });

    client.embedding = (id: string) => ({ embeddingId: id, opts });

    return client;
  });

  return { createOpenAI };
});
vi.mock("@ai-sdk/anthropic", () => {
  const createAnthropic = vi.fn((opts?: any) => (id: string) => ({ id, opts }));

  return { createAnthropic };
});

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { resolveModels } from "../src/models.js";

describe("resolveModels: explicit apiKey injection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes apiKey to createOpenAI, and the SAME keyed client backs the embedding model", async () => {
    const res = await resolveModels("openai", { apiKey: "sk-openai-test" });

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-openai-test" });
    expect((res.embeddingModel as any).opts).toEqual({ apiKey: "sk-openai-test" });
    expect((res.model as any).opts).toEqual({ apiKey: "sk-openai-test" });
  });

  it("passes apiKey to createAnthropic", async () => {
    await resolveModels("anthropic", { apiKey: "sk-ant-test" });
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-test" });
  });

  it("omits the apiKey arg when none is given (provider falls back to its env var)", async () => {
    await resolveModels("openai", {});
    expect(createOpenAI).toHaveBeenCalledWith({});
  });
});
