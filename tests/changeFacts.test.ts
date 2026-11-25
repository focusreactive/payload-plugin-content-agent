import { describe, it, expect } from "vitest";
import { describeChanges } from "../src/agent/content/changeFacts.js";
import type { SchemaField } from "../src/types.js";

const text = (t: string) => ({ type: "text", version: 1, format: 0, text: t });
const link = (url: string, t: string) => ({
  type: "link",
  version: 1,
  fields: { url, linkType: "custom" },
  children: [text(t)],
});
const para = (...c: any[]) => ({ type: "paragraph", version: 1, children: c });
const rt = (...children: any[]) => ({
  root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children },
});

const fields: SchemaField[] = [
  { name: "title", type: "text" },
  { name: "excerpt", type: "textarea" },
  { name: "content", type: "richText", editor: "lexical" },
  {
    name: "layout",
    type: "blocks",
    blocks: [
      { slug: "faq", fields: [{ name: "title", type: "text" }] },
      { slug: "hero", fields: [{ name: "heading", type: "text" }] },
    ],
  },
] as SchemaField[];

const doc = () => ({
  id: 1,
  title: "Sanity vs Payload",
  excerpt: "We ran real editorial tasks through both agents.",
  content: rt(
    para(
      text("We handed the agent to two of our content managers. "),
      text("A content manager stops being an operator.")
    ),
    para(text("See Sanity as the platform."))
  ),
  layout: [
    { id: "a", blockType: "hero", heading: "Hi" },
    { id: "b", blockType: "faq", title: "FAQ" },
  ],
});

describe("describeChanges", () => {
  it("reports nothing for an identical document", () => {
    expect(describeChanges(fields, doc(), doc())).toEqual([]);
  });

  it("names every changed segment, not only the one the task asked for", () => {
    const after = doc();

    after.content.root.children[0].children[0].text =
      "We handed the agent to two of our content editors. ";
    after.content.root.children[0].children[1].text = "A content editor stops being an operator.";
    const lines = describeChanges(fields, doc(), after);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/content: ".*content managers.*" -> ".*content editors.*"/u);
    expect(lines[1]).toMatch(/content manager stops.*-> ".*content editor stops/u);
  });

  it("reports a link added, repointed and removed by its anchor", () => {
    const added = doc();

    added.content.root.children[1].children = [
      text("See "),
      link("https://my-agency.example/blog/", "Sanity"),
      text(" as the platform."),
    ];
    expect(describeChanges(fields, doc(), added)).toEqual([
      'content: link added on "Sanity" -> https://my-agency.example/blog/',
    ]);
    const repointed = structuredClone(added);

    repointed.content.root.children[1].children[1].fields.url = "https://www.sanity.io";
    expect(describeChanges(fields, added, repointed)).toEqual([
      'content: link "Sanity" repointed https://my-agency.example/blog/ -> https://www.sanity.io',
    ]);
    expect(describeChanges(fields, added, doc())).toEqual([
      'content: link removed from "Sanity" (was https://my-agency.example/blog/)',
    ]);
  });

  it("reports plain fields with a focused before/after, and blocks that came or went", () => {
    const after = doc();

    after.excerpt = "We ran real editorial tasks through both agents. Reviewed in November 2026.";
    after.layout = [after.layout[0]];
    const lines = describeChanges(fields, doc(), after);

    expect(lines).toContain("layout[b]: block faq removed");
    expect(lines.find((l) => l.startsWith("excerpt:"))).toMatch(
      /-> ".*Reviewed in November 2026\."/u
    );
    const added = doc();

    added.layout.push({ id: "c", blockType: "faq", title: "More" });
    expect(describeChanges(fields, doc(), added)).toContain("layout[c]: block faq added");
  });

  it("names the block of a row id made of digits by its id, not by its position", () => {
    const before: any = doc();

    before.layout = [
      { id: "1", blockType: "hero", heading: "Hi" },
      { id: "0", blockType: "faq", title: "FAQ" },
    ];
    const after: any = { ...before, layout: [before.layout[0]] };

    expect(describeChanges(fields, before, after)).toContain("layout[0]: block faq removed");
  });

  it("reports a field filled or cleared in a block that stays as that field, not as the block", () => {
    const cleared: any = doc();

    cleared.layout[0].heading = null;
    expect(describeChanges(fields, doc(), cleared)).toEqual(["layout[a].heading: removed"]);
    expect(describeChanges(fields, cleared, doc())).toEqual(['layout[a].heading: added "Hi"']);
  });

  it("reports a block that got a name, a new name or lost its name", () => {
    const named: any = doc();

    named.layout[0].blockName = "Hero (main)";
    expect(describeChanges(fields, doc(), named)).toEqual([
      'layout[a].blockName: "" -> "Hero (main)"',
    ]);
    const renamed: any = doc();

    renamed.layout[0].blockName = "Hero (campaign)";
    expect(describeChanges(fields, named, renamed)).toEqual([
      'layout[a].blockName: "Hero (main)" -> "Hero (campaign)"',
    ]);
    expect(describeChanges(fields, named, doc())).toEqual([
      'layout[a].blockName: "Hero (main)" -> ""',
    ]);
  });

  it("reports a text that stood twice and lost one copy as removed once", () => {
    const before = {
      content: rt(para(text("Marked note.")), para(text("Same line.")), para(text("Same line."))),
    };
    const after = { content: rt(para(text("Same line."))) };
    const lines = describeChanges(fields, before, after);

    expect(lines.filter((line) => line.includes("text removed"))).toEqual([
      'content: text removed "Marked note."',
      'content: text removed "Same line."',
    ]);
  });

  it("caps the list", () => {
    const after = doc();

    after.content = rt(
      ...Array.from({ length: 20 }, (_, i) => para(text(`Paragraph ${i} rewritten`)))
    );
    const lines = describeChanges(fields, doc(), after);

    expect(lines.length).toBeLessThanOrEqual(13);
  });

  it("says how the page reads when a link brought a new word with it", () => {
    const after = doc();

    after.content.root.children[1].children = [
      link("https://my-agency.example/blog/", "Sanity"),
      text("See Sanity as the platform."),
    ];
    const lines = describeChanges(fields, doc(), after);

    expect(lines[0]).toBe('content: link added on "Sanity" -> https://my-agency.example/blog/');
    expect(lines[1]).toMatch(
      /content: the page read ".*See Sanity as.*" and now reads ".*SanitySee Sanity as/u
    );
  });
});

describe("a paragraph added after another one", () => {
  it("is not shown as text glued to the paragraph before it", () => {
    const before = { content: rt(para(text("First steps for a small team."))) };
    const after = {
      content: rt(
        para(text("First steps for a small team.")),
        para(text("Updated for this year."))
      ),
    };
    const lines = describeChanges(fields, before, after);
    const reads = lines.find((line) => line.includes("now reads"));

    expect(reads).toContain("small team. ¶ Updated for this year.");
    expect(lines.join("\n")).not.toContain("team.Updated");
  });

  it("a sentence added inside the same paragraph has no block mark", () => {
    const before = { content: rt(para(text("First steps."))) };
    const after = { content: rt(para(text("First steps."), text(" Updated."))) };

    expect(describeChanges(fields, before, after).join("\n")).not.toContain("¶");
  });
});
