import { asSchema } from "ai";
import { describe, expect, it } from "vitest";

import { distillationSchema } from "../src/memory/distillation.js";
import { ltmActionSchema } from "../src/memory/ltmCurator.js";

type JsonSchema = {
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

function optionalKeys(schema: JsonSchema, path = ""): string[] {
  const own = Object.keys(schema.properties ?? {})
    .filter((key) => !(schema.required ?? []).includes(key))
    .map((key) => `${path}${key}`);
  const nested = Object.entries(schema.properties ?? {}).flatMap(([key, value]) =>
    optionalKeys(value, `${path}${key}.`)
  );

  return [...own, ...nested, ...(schema.items ? optionalKeys(schema.items, `${path}[].`) : [])];
}

describe("the schemas of the structured model answers", () => {
  it.each([
    ["distillation", distillationSchema],
    ["long-term memory actions", ltmActionSchema],
  ])("%s: every key is required, so a strict provider takes the schema", async (_name, schema) => {
    const json = (await asSchema(schema as never).jsonSchema) as JsonSchema;

    expect(optionalKeys(json)).toEqual([]);
  });

  it("takes an answer with null for a value the model has none for", () => {
    expect(
      ltmActionSchema.parse({
        actions: [
          {
            type: "none",
            slug: null,
            parentSlug: null,
            path: null,
            title: null,
            body: null,
            reason: null,
          },
        ],
      }).actions
    ).toHaveLength(1);
    expect(distillationSchema.parse({ narrative: "n", keyObservations: [], tags: null }).tags).toBe(
      null
    );
  });
});
