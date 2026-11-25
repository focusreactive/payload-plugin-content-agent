import { describe, it, expect } from "vitest";
// @ts-expect-error plain JavaScript module without type declarations
import * as graders from "../evals/lib/lexical.mjs";

// @ts-expect-error plain JavaScript module without type declarations
import * as replies from "../evals/lib/reply.mjs";

const {
  differences,
  flat,
  gluedBoundaries,
  gluedPlaces,
  joined,
  links,
  paragraphs,
  same,
  textBlocks,
} = graders;
const { asksPerson, deniesChange, fold, holds, holdsWord, named } = replies;

const text = (t: string) => ({ type: "text", text: t });
const link = (url: string, t: string) => ({
  type: "link",
  fields: { url },
  children: [text(t)],
});
const para = (...children: object[]) => ({ type: "paragraph", children });
const doc = (...children: object[]) => ({ root: { type: "root", children } });

describe("eval graders: rich text readers", () => {
  const value = doc(para(text("Read the "), link("https://a.example", "guide"), text(" first.")), {
    type: "heading",
    children: [text("Next")],
  });

  it("reads text and links in document order", () => {
    expect(flat(value)).toEqual([
      ["text", "Read the "],
      ["link", "https://a.example", "guide"],
      ["text", " first."],
      ["text", "Next"],
    ]);
    expect(joined(value)).toBe("Read the guide first.Next");
    expect(links(value)).toEqual([["https://a.example", "guide"]]);
    expect(paragraphs(value)).toEqual(["Read the guide first.", "Next"]);
  });

  it("reads each list item as its own block", () => {
    const list = {
      type: "list",
      children: [
        { type: "listitem", children: [text("One")] },
        { type: "listitem", children: [text("Two")] },
      ],
    };

    expect(textBlocks(doc(para(text("Intro")), list))).toEqual(["Intro", "One", "Two"]);
  });

  it("does not count the text of a link twice", () => {
    expect(joined(doc(para(link("https://a.example", "only"))))).toBe("only");
  });

  it("counts a boundary where two words touch, and only there", () => {
    expect(
      gluedBoundaries(doc(para(text("with a"), link("u", "style guide"), text("that works"))))
    ).toBe(2);
    expect(
      gluedBoundaries(doc(para(text("with a "), link("u", "style guide"), text(" that works"))))
    ).toBe(0);
    expect(gluedBoundaries(doc(para(text("see the "), link("u", "guide"), text("."))))).toBe(0);
    expect(gluedBoundaries(doc(para(text("end")), para(text("start"))))).toBe(0);
  });

  it("names the two texts of a glued boundary", () => {
    expect(gluedPlaces(doc(para(text("with a"), link("u", "style guide"), text(" ok"))))).toEqual([
      ["with a", "style guide"],
    ]);
  });

  it("lists where two lists differ, up to the limit", () => {
    expect(differences(["a", "b", "c"], ["a", "x"])).toEqual([
      [1, "b", "x"],
      [2, "c", null],
    ]);
    expect(differences(["a", "b"], ["x", "y"], 1)).toEqual([[0, "a", "x"]]);
    expect(differences(["a"], ["a"])).toEqual([]);
  });

  it("compares values without regard to key order, and sees a real difference", () => {
    expect(same({ a: 1, b: [{ c: 2, d: 3 }] }, { b: [{ d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(same({ a: 1, b: [1, 2] }, { a: 1, b: [2, 1] })).toBe(false);
    expect(same({ a: null }, {})).toBe(false);
  });
});

describe("eval graders: readers of a reply", () => {
  const candidates = [
    {
      key: "service",
      names: ["Payload CMS development", "payload-cms-development"],
    },
    {
      key: "spain",
      names: ["Payload CMS development in Spain", "payload-cms-development-spain"],
    },
    { key: "slash", names: ["payload-cms-development/"] },
  ];
  const keys = (reply: string) => [...named(reply, candidates)].sort();

  it("reads one spelling for letter case, quote marks, dashes and emphasis", () => {
    expect(fold("  **It’s**  a `Test` – “yes” ")).toBe('it\'s a test - "yes"');
    expect(holds("He wrote: *The   first* line.", "the first line")).toBe(true);
    expect(holds("He wrote the first line.", "the second line")).toBe(false);
  });

  it("gives a name to the longest title that holds it", () => {
    expect(keys("Only **Payload CMS development in Spain** has it.")).toEqual(["spain"]);
    expect(keys("Payload CMS development and Payload CMS development in Spain.")).toEqual([
      "service",
      "spain",
    ]);
  });

  it("takes a slug only as a whole", () => {
    expect(keys("See /payload-cms-development-spain/ for it.")).toEqual(["spain"]);
    expect(keys("The page payload-cms-development-germany is fine.")).toEqual([]);
    expect(keys("`payload-cms-development` and `payload-cms-development/`")).toEqual([
      "service",
      "slash",
    ]);
  });

  describe("the narrow reading, for the names a reply must not hold", () => {
    const pages = [
      { key: "about", names: ["About", "about"] },
      {
        key: "spain",
        names: ["Payload CMS development in Spain", "payload-cms-development-spain"],
      },
    ];
    const narrow = (reply: string, addresses = true) =>
      [...named(reply, pages, { addresses, setOff: true })].sort();

    it("takes a name of one word only where the reply sets it off", () => {
      expect(narrow("The description has about 150 characters.")).toEqual([]);
      expect(narrow("About 150 characters are left.")).toEqual([]);
      expect(narrow("The page **About** has none.")).toEqual(["about"]);
      expect(narrow("The page `about` has none.")).toEqual(["about"]);
      expect(narrow('The page "About" has none.')).toEqual(["about"]);
      expect(narrow("| About | 12 |")).toEqual(["about"]);
      expect(narrow("These pages:\n- About\n- Other")).toEqual(["about"]);
      expect([...named("It has about 150 characters.", pages)]).toEqual(["about"]);
    });

    it("takes a name of several words anywhere", () => {
      expect(narrow("Also Payload CMS development in Spain has it.")).toEqual(["spain"]);
      expect(narrow("Also payload-cms-development-spain has it.")).toEqual(["spain"]);
    });

    it("takes a name in an address only when addresses count", () => {
      expect(narrow("It links to /services/payload-cms-development-spain/ twice.", false)).toEqual(
        []
      );
      expect(narrow("It links to https://site.test/about and no more.", false)).toEqual([]);
      expect(narrow("The pages /about and /payload-cms-development-spain/ exist.")).toEqual([
        "about",
        "spain",
      ]);
      expect(narrow("**Payload CMS development in Spain** links to /about/.", false)).toEqual([
        "spain",
      ]);
    });
  });

  it("gives one name to every candidate that has it", () => {
    const twins = [
      { key: "a", names: ["Same title"] },
      { key: "b", names: ["Same title"] },
    ];

    expect([...named("The page Same title.", twins)].sort()).toEqual(["a", "b"]);
  });
});

describe("eval graders: a reply that says nothing changed", () => {
  it("does not take a false claim of the change for a denial", () => {
    expect(
      deniesChange(
        'Done: every "quarterly roadmap" in the body now reads "yearly roadmap". No other text was changed.',
        "yearly roadmap"
      )
    ).toBe(false);
  });

  it("takes a reply that found no match and changed nothing", () => {
    expect(
      deniesChange(
        'The body has no "quarterly roadmap", so there was nothing to replace with "yearly roadmap".',
        "yearly roadmap"
      )
    ).toBe(true);
    expect(
      deniesChange(
        "I searched the body.\nIt doesn't contain that phrase, so I left it unchanged.",
        "yearly roadmap"
      )
    ).toBe(true);
  });

  it("needs a denial", () => {
    expect(deniesChange("I searched the body for the phrase.", "yearly roadmap")).toBe(false);
  });
});

describe("eval graders: a reply that asks the person for a value", () => {
  it("takes a question and a request alike", () => {
    expect(asksPerson("Which address should the button use?")).toBe(true);
    expect(
      asksPerson(
        "I couldn't find a pricing page in the CMS. No draft was changed.\n\nPlease share the new pricing page's URL."
      )
    ).toBe(true);
    expect(asksPerson("1. **Give me the pricing page's address**, for example `/pricing`.")).toBe(
      true
    );
    expect(
      asksPerson("If the page lives on another site, send me the full URL and I'll use that.")
    ).toBe(true);
  });

  it("does not take a report for a request", () => {
    expect(
      asksPerson("I pointed the button at the pricing page. The change is in the draft.")
    ).toBe(false);
    expect(asksPerson("I couldn't find a pricing page, so nothing was changed.")).toBe(false);
  });
});

describe("eval graders: a word of the text", () => {
  it("counts a word only as a whole, alone or with a plural s", () => {
    expect(holdsWord("A bar chart with three bars", "chart")).toBe(true);
    expect(holdsWord("Two GRAPHS side by side", "graph")).toBe(true);
    expect(holdsWord("A photograph for the guide", "graph")).toBe(false);
    expect(holdsWord("Cover image with a clean design", "sign")).toBe(false);
    expect(holdsWord(null, "sign")).toBe(false);
  });
});
