import type { ResolvedPluginOptions, SchemaContext } from "../src/types.js";
import { createTools } from "../src/agent/tools/index.js";

const schema: SchemaContext = {
  locales: ["en", "de"],
  defaultLocale: "en",
  collections: [
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text", localized: true },
        { name: "image", type: "upload", relationTo: "media" },
      ],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "media",
      upload: true,
      fields: [{ name: "alt", type: "text" }],
      hasVersions: false,
      hasDrafts: false,
      hasAuth: false,
      timestamps: true,
    },
  ],
  globals: [],
} as SchemaContext;

/**
 * Every tool the chat can have: a localized schema with an upload collection, memory, editorial
 * instructions and image input.
 */
export async function chatToolNames(): Promise<string[]> {
  const memory = { pendingBulk: undefined, changesets: { record: async () => {} } };
  const options = {
    instructions: true,
    imageInput: true,
    modules: [],
  } as unknown as ResolvedPluginOptions;

  return Object.keys(
    createTools({}, schema, options, {
      memory: memory as never,
      conversationId: "c",
      userId: "u",
    })
  );
}
