import { describe, it, expect } from "vitest";
import { runAgent } from "../src/agent/index.js";
import type { SchemaContext, SchemaField } from "../src/types.js";
import { pluginOptions } from "./harness.js";

const gateSchema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
        {
          name: "meta",
          type: "group",
          fields: [
            { name: "note", type: "text" },
            { name: "migrationId", type: "text", readOnly: true },
          ],
        },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};

describe("IDOR gate fails CLOSED on DB error", () => {
  it("a findOrCreate throw skips the memory block instead of proceeding on an unverified conversation", async () => {
    let assembleCalled = false,
      saveCalled = false;
    const memory: any = {
      telemetry: null,
      conversations: {
        findOrCreate: async () => {
          throw new Error("pooler dropped the connection");
        },
        findById: async () => null,
        touch: async () => {},
      },
      saveMessage: async () => {
        saveCalled = true;
      },
      assembleContext: async () => {
        assembleCalled = true;

        return {};
      },
      getSystemPromptAdditions: () => "",
      getContextMessages: () => [],
    };
    // Nothing listens on this port, so the connection is refused at once.
    const payload: any = { config: { serverURL: "http://127.0.0.1:9" } };

    try {
      await runAgent({
        messages: [{ id: "m", role: "user", parts: [{ type: "text", text: "hi" }] }] as any,
        payload,
        user: { id: "attacker" } as any,
        schema: gateSchema,
        options: pluginOptions(),
        memory,
        conversationId: "someone-elses-uuid",
      });
    } catch {
      /* the connect failure is expected: the gate runs before it */
    }

    expect(saveCalled).toBe(false);
    expect(assembleCalled).toBe(false);
  });
});
