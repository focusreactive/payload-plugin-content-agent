import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../src/agent/systemPrompt.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const schema: SchemaContext = {
  collections: [
    {
      slug: "blog-posts",
      fields: [{ name: "title", type: "text" }] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "site_pages",
      fields: [{ name: "name", type: "text" }] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
  globals: [
    {
      slug: "site-settings",
      fields: [{ name: "siteName", type: "text" }] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
    },
  ],
  locales: ["en", "es"],
  defaultLocale: "en",
};

function joined(parts: { stable: string; volatile: string }): string {
  return `${parts.stable}\n\n${parts.volatile}`;
}

describe("buildSystemPrompt: emitted text integrity", () => {
  const withMemory = joined(
    buildSystemPrompt({ schemaContext: schema, schemaPromptMode: "auto", memoryEnabled: true })
  );
  const withoutMemory = joined(
    buildSystemPrompt({ schemaContext: schema, schemaPromptMode: "auto", memoryEnabled: false })
  );

  it('contains no template artifacts or leaked "undefined"', () => {
    for (const p of [withMemory, withoutMemory]) {
      expect(p).not.toMatch(/\$\{/u);
      expect(p).not.toContain("undefined");
    }
  });

  it("names the document tools and no tool of one collection", () => {
    for (const name of ["listDocuments", "readDocument", "createDocument", "updateDocument"])
      expect(withMemory).toContain(name);
    expect(withMemory).not.toMatch(/\b(find|create|update)(BlogPosts|SitePages)\b/u);
    expect(withMemory).not.toMatch(/\b(find|create|update)\{Collection\}/u);
  });

  it("references memory tools ONLY when memory is enabled", () => {
    expect(withMemory).toContain("reflect");
    expect(withMemory).toContain("present_progress");
    expect(withoutMemory).not.toContain("present_progress");
    expect(withoutMemory).not.toContain("proposeGlossaryEntry");
    expect(withoutMemory).toContain("No Memory Configured");
  });

  it("documents the universal tools and the enforced review gate", () => {
    for (const p of [withMemory, withoutMemory]) {
      expect(p).toContain("createDocument");
      expect(p).toContain("readDocument");
      expect(p).toContain("updateDocument({ ..., preview: true })");
      expect(p).not.toContain("reviewChanges");
      expect(p).toContain("editContent");
    }
  });

  it("renders the localization section for multi-locale schemas", () => {
    expect(withMemory).toContain("Locales: en, es");
    const single = joined(
      buildSystemPrompt({
        schemaContext: { ...schema, locales: undefined, defaultLocale: undefined },
        schemaPromptMode: "auto",
        memoryEnabled: true,
      })
    );

    expect(single).not.toContain("## Localization");
  });
});
