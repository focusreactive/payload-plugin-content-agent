import { describe, it, expect } from "vitest";
import {
  activityLabel,
  activityTarget,
  isTurnLive,
  progressCardFollows,
  showsThinking,
  toolPhase,
} from "../src/ui/turnStatus.js";
import { CUT_OFF_NOTE, cutOffNote } from "../src/agent/turnEnd.js";

describe("isTurnLive", () => {
  it("is live only for the last message of a running turn", () => {
    expect(isTurnLive(true, "streaming")).toBe(true);
    expect(isTurnLive(true, "submitted")).toBe(true);
    expect(isTurnLive(true, "ready")).toBe(false);
    expect(isTurnLive(true, "error")).toBe(false);
    expect(isTurnLive(false, "streaming")).toBe(false);
  });
});

describe("toolPhase", () => {
  it("follows the AI Elements lifecycle while the turn runs", () => {
    expect(toolPhase({ state: "input-streaming" }, true)).toBe("pending");
    expect(toolPhase({ state: "input-available" }, true)).toBe("running");
    expect(toolPhase({ state: "output-available" }, true)).toBe("done");
    expect(toolPhase({ state: "output-error" }, true)).toBe("error");
  });

  it('turns a step without a result into "interrupted" once the turn is over', () => {
    expect(toolPhase({ state: "input-streaming" }, false)).toBe("interrupted");
    expect(toolPhase({ state: "input-available" }, false)).toBe("interrupted");
    expect(toolPhase({ state: "output-available" }, false)).toBe("done");
    expect(toolPhase({ state: "output-error" }, false)).toBe("error");
  });
});

describe("activityLabel", () => {
  it("says what a step does in plain words", () => {
    expect(activityLabel("updatePosts")).toBe("Updating posts");
    expect(activityLabel("findPosts")).toBe("Searching posts");
    expect(activityLabel("readDocument")).toBe("Reading document");
    expect(activityLabel("editContent")).toBe("Editing content");
    expect(activityLabel("getSchemaInfo")).toBe("Reading schema info");
    expect(activityLabel("present_table")).toBe("Preparing a table");
    expect(activityLabel("web")).toBe("Reading the web");
    expect(activityLabel("findReplaceContent")).toBe("Replacing content");
  });

  it("names the server of a namespaced tool and never shows a raw identifier", () => {
    expect(activityLabel("search__site-page-metrics")).toBe("search: site page metrics");
    expect(activityLabel("whoAmI")).toBe("Who am i");
  });
});

const assistant = (...parts: any[]) => ({ role: "assistant", parts });

describe("showsThinking", () => {
  it("shows again once every step of the reply has its result", () => {
    expect(
      showsThinking(
        assistant(
          { type: "tool-editContent", toolCallId: "a", state: "output-available" },
          { type: "step-start" }
        ),
        "streaming"
      )
    ).toBe(true);
  });

  it("hides after the text of a step is complete, while the server still ends the turn", () => {
    expect(
      showsThinking(
        assistant(
          { type: "tool-listDocuments", toolCallId: "a", state: "output-available" },
          { type: "step-start" },
          { type: "text", text: "Five documents.", state: "done" }
        ),
        "streaming"
      )
    ).toBe(false);
  });

  it("hides while a step waits for the answer of the person", () => {
    expect(
      showsThinking(
        assistant({ type: "tool-updateDocument", toolCallId: "a", state: "approval-requested" }),
        "streaming"
      )
    ).toBe(false);
  });

  it("names the collection or the global of a running step", () => {
    expect(activityTarget({ collection: "media", limit: 5 })).toBe("media");
    expect(activityTarget({ global: "header" })).toBe("header");
    expect(activityTarget({ query: "x" })).toBe("");
    expect(activityTarget(undefined)).toBe("");
    expect(activityTarget({ collection: 3 })).toBe("");
  });

  it("shows before the first token and between steps", () => {
    expect(showsThinking(undefined, "submitted")).toBe(true);
    expect(showsThinking({ role: "user", parts: [] }, "streaming")).toBe(true);
    expect(showsThinking(assistant({ type: "step-start" }), "streaming")).toBe(true);
    expect(
      showsThinking(
        assistant({ type: "tool-findPosts", toolCallId: "a", state: "output-available" }),
        "streaming"
      )
    ).toBe(true);
  });

  it("hides while something else on screen shows the progress, and after the turn", () => {
    expect(
      showsThinking(assistant({ type: "text", text: "Hi", state: "streaming" }), "streaming")
    ).toBe(false);
    expect(
      showsThinking(assistant({ type: "reasoning", text: "", state: "streaming" }), "streaming")
    ).toBe(false);
    expect(
      showsThinking(
        assistant({ type: "tool-updatePosts", toolCallId: "a", state: "input-available" }),
        "streaming"
      )
    ).toBe(false);
    expect(
      showsThinking(
        assistant({ type: "data-content-ops", data: { phase: "running" } }),
        "streaming"
      )
    ).toBe(false);
    expect(
      showsThinking(
        assistant({
          type: "tool-editContent",
          toolCallId: "a",
          state: "approval-responded",
          approval: { id: "x", approved: true },
        }),
        "streaming"
      )
    ).toBe(false);
    expect(
      showsThinking(
        assistant(
          {
            type: "tool-editContent",
            toolCallId: "a",
            state: "approval-responded",
            approval: { id: "x", approved: true },
          },
          { type: "step-start" }
        ),
        "streaming"
      )
    ).toBe(false);
    expect(
      showsThinking(
        assistant(
          { type: "tool-editContent", toolCallId: "a", state: "input-available" },
          { type: "step-start" }
        ),
        "streaming"
      )
    ).toBe(false);
    expect(showsThinking(assistant({ type: "step-start" }), "ready")).toBe(false);
  });

  it("hides after the person confirms a step that now runs, before the first token comes", () => {
    const approved = {
      type: "tool-editContent",
      toolCallId: "a",
      state: "approval-responded",
      approval: { id: "x", approved: true },
    };

    expect(showsThinking(assistant(approved), "submitted")).toBe(false);
    expect(
      showsThinking(
        assistant({ type: "tool-editContent", toolCallId: "a", state: "input-available" }),
        "submitted"
      )
    ).toBe(false);
  });

  it("hides while any live line stands in the reply, not only the last one", () => {
    const running = { type: "data-content-ops", id: "ops-1", data: { phase: "running" } };
    const done = { type: "data-content-ops", id: "ops-1", data: { phase: "done" } };

    expect(showsThinking(assistant(running, { type: "step-start" }), "streaming")).toBe(false);
    expect(
      showsThinking(
        assistant({ type: "reasoning", text: "", state: "streaming" }, { type: "step-start" }),
        "streaming"
      )
    ).toBe(false);
    expect(showsThinking(assistant(running, done, { type: "step-start" }), "streaming")).toBe(true);
  });

  it("shows when the person answered and nothing in the reply runs yet", () => {
    expect(
      showsThinking(
        assistant(
          { type: "tool-findPosts", toolCallId: "a", state: "output-available" },
          { type: "text", text: "Two posts.", state: "done" }
        ),
        "submitted"
      )
    ).toBe(true);
  });
});

describe("cutOffNote", () => {
  it("adds the note only when the last step did not end normally", () => {
    expect(cutOffNote("stop")).toBe("");
    expect(cutOffNote("tool-calls")).toBe("");
    expect(cutOffNote(undefined)).toBe("");
    for (const reason of ["other", "length", "error", "content-filter"])
      expect(cutOffNote(reason)).toBe(CUT_OFF_NOTE);
  });
});

describe("progressCardFollows", () => {
  const edit = { type: "tool-editContent", toolCallId: "a", state: "input-available" };
  const card = { type: "data-content-ops", data: { phase: "running" } };

  it("is true once a progress card stands after the step, so the step draws no second loader", () => {
    expect(progressCardFollows([edit, card] as any, 0)).toBe(true);
    expect(progressCardFollows([edit, { type: "step-start" }, card] as any, 0)).toBe(true);
  });

  it("is false while the step is the only thing that shows the work", () => {
    expect(progressCardFollows([edit] as any, 0)).toBe(false);
    expect(progressCardFollows([card, edit] as any, 1)).toBe(false);
  });
});
