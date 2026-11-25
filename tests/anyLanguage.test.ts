import { describe, it, expect } from "vitest";

import { textMatch } from "../src/memory/storage/textMatch.js";
import { DISTILLATION_SYSTEM_PROMPT } from "../src/memory/distillation.js";
import { CURATOR_SYSTEM_PROMPT } from "../src/memory/ltmCurator.js";
import { wordsOf } from "../src/words.js";

describe("text without spaces between words", () => {
  it("wordsOf gives each character of such a script and the runs of the others", () => {
    expect(wordsOf("one two")).toEqual(["one", "two"]);
    expect(wordsOf("東京の天気")).toEqual(["東", "京", "の", "天", "気"]);
    expect(wordsOf("ราคา 2026")).toEqual(["ร", "า", "ค", "า", "2026"]);
  });

  it("the memory search adds a substring match only for such a query", () => {
    expect(textMatch("release plan", "tsv", "content", "$2")).toBe(
      "tsv @@ replace(plainto_tsquery('simple', $2)::text, '&', '|')::tsquery"
    );
    expect(textMatch("発売日", "tsv", "content", "$2")).toBe(
      "(tsv @@ replace(plainto_tsquery('simple', $2)::text, '&', '|')::tsquery OR strpos(lower(content), lower($2)) > 0)"
    );
  });
});

describe("the memory keeps the language of the conversation", () => {
  it.each([
    ["distillation", DISTILLATION_SYSTEM_PROMPT],
    ["curator", CURATOR_SYSTEM_PROMPT],
  ])("the %s prompt says so", (_name, prompt) => {
    expect(prompt).toContain("in the language the conversation is in");
    expect(prompt).toContain("do not translate them");
  });
});
