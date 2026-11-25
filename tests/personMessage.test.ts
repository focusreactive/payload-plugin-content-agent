import { describe, expect, it } from "vitest";

import { personMessageNote } from "../src/agent/content/editor/personMessage.js";
import { lastPersonMessage } from "../src/agent/runAgent/assemble.js";

const message = (role: "user" | "assistant", ...texts: string[]) =>
  ({ id: role, role, parts: texts.map((text) => ({ type: "text", text })) }) as any;

describe("the editor gets the person's own words next to the task", () => {
  it("takes the text of the last message the person wrote", () => {
    const messages = [
      message("user", "Rename the page."),
      message("assistant", "Done."),
      message("user", 'Change the tagline to "Tools for teams that publish daily".'),
      message("assistant", "On it."),
    ];

    expect(lastPersonMessage(messages)).toBe(
      'Change the tagline to "Tools for teams that publish daily".'
    );
  });

  it("has nothing to pass when the person wrote no text", () => {
    expect(lastPersonMessage([message("assistant", "Hello")])).toBeUndefined();
    expect(lastPersonMessage([{ id: "u", role: "user", parts: [] } as any])).toBeUndefined();
  });

  it("quotes the message as written and says which values to take from it", () => {
    const note = personMessageNote('Set it to "A, b".');

    expect(note).toContain('"""\nSet it to "A, b".\n"""');
    expect(note).toContain("character for character");
    expect(note).toContain("the person's words are right and the task is wrong");
  });

  it("adds no note without a message and cuts a very long one with the full length named", () => {
    expect(personMessageNote(undefined)).toBe("");
    expect(personMessageNote("   ")).toBe("");
    expect(personMessageNote("x".repeat(5000))).toContain("[cut, 5000 characters in total]");
  });
});
