import { describe, it, expect } from "vitest";
import { shiftedEntryError } from "../src/agent/content/guards.js";
import { createDocumentRewriteTools } from "../src/agent/content/documentRewrite.js";
import { createRichTextTools } from "../src/agent/content/richtextTools.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const opts = { toolCallId: "t", messages: [] } as any;
const text = (t: string) => ({ type: "text", version: 1, format: 0, text: t });
const link = (url: string, t: string) => ({
  type: "link",
  version: 1,
  fields: { url, linkType: "custom", newTab: true },
  children: [text(t)],
});
const para = (...c: any[]) => ({ type: "paragraph", version: 1, children: c });
const rt = (...children: any[]) => ({
  root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children },
});

const S1 = "A couple of months ago I ";
const S2 = "built an MVP of a content agent for Payload";
const S3 = " and wrote about it in a separate article. There I put it next to ";
const S4 = "Sanity’s agent";
const S5 =
  " on simple tasks: finding links, verifying a list of articles, and running a bulk replacement. The results were very close, and I promised to come back with a more honest test - not on tasks I made up, but on the ones editors ask for every day.";
const S6 =
  "After that article, we handed the agent to two of our content managers as an internal beta. For five weeks, they used it as part of their normal work. I refined the agent based on their requests and deliberately did not coach them on how to phrase things “correctly”. From those requests, I picked 31 tasks and ran them through both agents - ours and Sanity Content Agent - word for word, exactly as the editors wrote them.";
const S7 = "## Who is this article for?";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "description", type: "textarea" },
        { name: "content", type: "richText", editor: "lexical" },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};
const makeDoc = () => ({
  id: 315,
  title:
    "Sanity Content Agent vs. Payload: An Open-Source Alternative, Tested on 31 Real Editorial Tasks",
  description:
    "Payload CMS vs. Sanity: we ran real editorial tasks through both AI content agents and compared speed, accuracy and cost.",
  content: rt(
    para(
      text(S1),
      link("https://my-agency.example/blog/payload-content-agent/", S2),
      text(S3),
      link("https://www.sanity.io", S4),
      text(S5)
    ),
    para(text(S6)),
    para(text(S7))
  ),
});
const ws = (doc: any) =>
  ({ ref: { current: doc }, original: structuredClone(doc), collection: "posts" }) as any;

describe("shiftedEntryError", () => {
  const others = [
    { n: 1, text: S1 },
    { n: 2, text: S2 },
    { n: 5, text: S5 },
  ];

  it("refuses a value that is exactly another entry, naming both numbers", () => {
    expect(shiftedEntryError("Entry 3", S3, S1, others)).toMatch(
      /Entry 3 is exactly the text of entry 1/u
    );
    expect(shiftedEntryError("Entry 7", S7, S5, others)).toMatch(/exactly the text of entry 5/u);
  });
  it("refuses a value that carries the whole of another long entry", () => {
    expect(
      shiftedEntryError(
        "Entry 6",
        S6,
        `There I put it next to [Sanity](https://my-agency.example/blog/)’s agent${S5}`,
        others
      )
    ).toMatch(/contains the whole text of entry 5/u);
  });
  it("passes a rewrite of the entry's own words, an unchanged value, and short coincidences", () => {
    expect(
      shiftedEntryError("Entry 6", S6, S6.replace("five weeks", "six weeks"), others)
    ).toBeNull();
    expect(shiftedEntryError("Entry 6", S6, S6, others)).toBeNull();
    expect(
      shiftedEntryError("Entry 9", "Read the docs", "Learn more", [{ n: 4, text: "Learn more" }])
    ).toBeNull();
    expect(shiftedEntryError("Entry 9", `Intro. ${S5}`, `New intro. ${S5}`, others)).toBeNull();
  });
});

describe("applyDocumentText: entries written under the wrong numbers", () => {
  it("replays the real case: the five shifted entries are refused and the document is untouched", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);

    expect(read.text["3"]).toBe(S1); // 1 is the title, 2 the description, the body starts at 3
    expect(read.text["8"]).toBe(S6); // link anchors are entries too: 4 and 6
    const r: any = await t.applyDocumentText.execute!(
      {
        token: read.token,
        text: {
          "5": `${S1}[${S2}](https://www.sanity.io)${S3}`,
          "8": `There I put it next to [Sanity](https://my-agency.example/blog/)’s agent${S5}`,
          "9": S5,
        },
      },
      opts
    );

    expect(r.ok).toBe(false);
    expect(r.errors.map((e: any) => e.n).sort()).toEqual(["5", "8", "9"]);
    expect(r.errors.find((e: any) => e.n === "5").error).toMatch(
      /contains the whole text of entry 4/u
    );
    expect(r.errors.find((e: any) => e.n === "8").error).toMatch(
      /contains the whole text of entry 7/u
    );
    expect(r.errors.find((e: any) => e.n === "9").error).toMatch(/exactly the text of entry 7/u);
    expect(doc).toEqual(makeDoc());
  });

  it("still accepts the same edit sent under the right numbers", async () => {
    const doc = makeDoc();
    const t = createDocumentRewriteTools(ws(doc), schema);
    const read: any = await t.readDocumentText.execute!({}, opts);
    const r: any = await t.applyDocumentText.execute!(
      {
        token: read.token,
        text: { "8": S6.replace("two of our content managers", "two of our editors") },
      },
      opts
    );

    expect(r.ok).toBe(true);
    expect(doc.content.root.children[1].children[0].text).toContain("two of our editors");
  });
});

describe("applyRichText transform: segments written under the wrong indices", () => {
  it("refuses a segment that carries another segment's words", async () => {
    const doc = makeDoc();
    const t = createRichTextTools(ws(doc), schema);
    const view: any = await t.viewRichText.execute!({ ref: "content", mode: "transform" }, opts);

    expect(view.segments[5]).toBe(S6);
    const r: any = await t.applyRichText.execute!(
      { ref: "content", mode: "transform", segments: { 6: S5 }, nodeCount: view.nodeCount },
      opts
    );

    expect(r.error).toMatch(/Segment 6 is exactly the text of entry 4/u);
    expect(doc.content.root.children[2].children[0].text).toBe(S7);
  });
});
