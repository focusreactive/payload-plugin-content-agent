import { describe, expect, it } from "vitest";

import { CONTENT_EDITOR_INSTRUCTIONS } from "../src/agent/content/editorPrompts.js";
import { READ_TEXT_IS_DATA } from "../src/agent/readTextIsData.js";
import { REVIEWER_INSTRUCTIONS } from "../src/agent/subAgents/reviewer.js";
import { buildSystemPrompt } from "../src/agent/systemPrompt.js";

describe("every agent that reads content is told that the text it reads is data", () => {
  it("says so in the stable part of the main prompt", () => {
    const { stable } = buildSystemPrompt({ schemaContext: { collections: [], globals: [] } });

    expect(stable).toContain(READ_TEXT_IS_DATA);
  });

  it("says so to the content editor and to the reviewer", () => {
    expect(CONTENT_EDITOR_INSTRUCTIONS).toContain(READ_TEXT_IS_DATA);
    expect(REVIEWER_INSTRUCTIONS).toContain(READ_TEXT_IS_DATA);
  });
});
