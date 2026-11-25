import { describe, it, expect, vi } from "vitest";
import { contentAgentPlugin } from "../src/plugin.js";

vi.mock("@payloadcms/ui", () => ({ useConfig: () => ({ config: {} }) }));
const { openDocumentState } = await import("../src/ui/openForm.js");

const BRIDGE = "@focus-reactive/payload-plugin-content-agent/client#DocumentFormBridge";

const apply = (config: object) =>
  contentAgentPlugin({ provider: "anthropic", mcpApiKey: "k" })(config as any) as any;

describe("the form bridge in the admin config", () => {
  it("sits in the edit view of every collection and global, after the components of the host", () => {
    const config = apply({
      collections: [
        { slug: "pages", fields: [] },
        {
          slug: "posts",
          fields: [],
          admin: {
            useAsTitle: "title",
            components: {
              edit: { beforeDocumentControls: ["host#Control"], SaveButton: "host#Save" },
            },
          },
        },
      ],
      globals: [
        { slug: "settings", fields: [] },
        {
          slug: "footer",
          fields: [],
          admin: { components: { elements: { beforeDocumentControls: ["host#Control"] } } },
        },
      ],
    });
    const [pages, posts] = config.collections;
    const [settings, footer] = config.globals;

    expect(pages.admin.components.edit.beforeDocumentControls).toEqual([BRIDGE]);
    expect(posts.admin.components.edit).toEqual({
      beforeDocumentControls: ["host#Control", BRIDGE],
      SaveButton: "host#Save",
    });
    expect(posts.admin.useAsTitle).toBe("title");
    expect(settings.admin.components.elements.beforeDocumentControls).toEqual([BRIDGE]);
    expect(footer.admin.components.elements.beforeDocumentControls).toEqual([
      "host#Control",
      BRIDGE,
    ]);
  });
});

describe("openDocumentState", () => {
  it("says nothing when the form shows the last write or has no unsaved edits", () => {
    expect(openDocumentState(0, 0, null)).toBeNull();
    expect(openDocumentState(2, 2, true)).toBeNull();
    expect(openDocumentState(2, 1, false)).toBeNull();
  });

  it("warns of the unsaved edits, and offers a reload when the form reports nothing", () => {
    expect(openDocumentState(2, 1, true)).toBe("unsaved");
    expect(openDocumentState(1, 0, null)).toBe("stale");
  });
});
