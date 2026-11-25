import { describe, it, expect, vi } from "vitest";
import { richTextToPlain, documentText, pageSections } from "../src/agent/content/documentText.js";
import { createIoReadTools } from "../src/agent/tools/index.js";
import { capMcpToolOutput, MAX_STRIPPED_JSON_CHARS } from "../src/agent/tools/outputCap.js";
import type { DocumentIO } from "../src/agent/content/documentIo.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const text = (t: string) => ({ type: "text", version: 1, text: t });
const para = (...c: any[]) => ({ type: "paragraph", version: 1, children: c });
const rt = (...children: any[]) => ({
  root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children },
});

const body = rt(
  { type: "heading", tag: "h2", version: 1, children: [text("Why headless")] },
  para(
    text("Teams pick a "),
    { type: "link", version: 3, fields: { url: "/x" }, children: [text("headless CMS")] },
    text(" for speed.")
  ),
  {
    type: "list",
    listType: "bullet",
    version: 1,
    children: [
      { type: "listitem", version: 1, children: [text("one")] },
      { type: "listitem", version: 1, children: [text("two")] },
    ],
  },
  { type: "upload", version: 1, relationTo: "media", value: 4 },
  {
    type: "block",
    version: 2,
    fields: {
      id: "cb1",
      blockType: "callout",
      heading: "Note",
      body: rt(para(text("Inside callout"))),
    },
  }
);

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "slug", type: "text" },
        { name: "content", type: "richText", editor: "lexical" },
        {
          name: "seo",
          type: "group",
          fields: [
            { name: "description", type: "textarea" },
            { name: "noIndex", type: "checkbox" },
          ],
        },
        {
          name: "layout",
          type: "blocks",
          blocks: [
            {
              slug: "faq",
              fields: [
                { name: "title", type: "text" },
                {
                  name: "items",
                  type: "array",
                  fields: [
                    { name: "q", type: "text" },
                    { name: "a", type: "richText" },
                  ],
                },
              ],
            },
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
const doc = {
  id: 1,
  title: "Headless CMS architecture",
  slug: "headless-cms",
  content: body,
  seo: { description: "A guide.", noIndex: false },
  layout: [
    {
      id: "f1",
      blockType: "faq",
      title: "FAQ",
      items: [{ id: "i1", q: "Is it fast?", a: rt(para(text("Yes."))) }],
    },
  ],
};
const opts = { toolCallId: "t", messages: [] } as any;

describe("richTextToPlain", () => {
  it("flattens headings, links, lists, embedded blocks; drops uploads and node metadata", () => {
    const out = richTextToPlain(body);

    expect(out).toBe(
      "## Why headless\nTeams pick a headless CMS for speed.\n- one\n- two\nNote\nInside callout"
    );
    expect(out).not.toContain("version");
  });
  it("is empty for a missing or empty root", () => {
    expect(richTextToPlain(null)).toBe("");
    expect(richTextToPlain(rt())).toBe("");
  });
});

describe("documentText", () => {
  it("walks every text-bearing field in schema order, at any depth, skipping non-text", () => {
    const sections = documentText(schema.collections[0].fields, doc);

    expect(sections.map((s) => s.ref)).toEqual([
      "title",
      "slug",
      "content",
      "seo.description",
      "layout[f1].title",
      "layout[f1].items[i1].q",
      "layout[f1].items[i1].a",
    ]);
    expect(sections.find((s) => s.ref === "layout[f1].items[i1].a")!.text).toBe("Yes.");
  });
  it("shows the fields of a block embedded in rich text once, inside the rich text", () => {
    const fields = schema.collections[0].fields.map((field) =>
      field.name === "content"
        ? {
            ...field,
            blocks: [
              {
                slug: "callout",
                fields: [
                  { name: "heading", type: "text" },
                  { name: "body", type: "richText" },
                ],
              },
            ],
          }
        : field
    ) as SchemaField[];
    const sections = documentText(fields, doc);

    expect(sections.filter((s) => s.ref.startsWith("content")).map((s) => s.ref)).toEqual([
      "content",
    ]);
    expect(sections.find((s) => s.ref === "content")!.text).toContain("Note\nInside callout");
  });
});

describe("pageSections", () => {
  const sections = Array.from({ length: 5 }, (_, i) => ({
    ref: `f${i}`,
    type: "text",
    text: "x".repeat(100),
  }));

  it("fills a page up to the budget and hands back a cursor for the rest", () => {
    const p1 = pageSections(sections, undefined, 250);

    expect(p1.sections.map((s) => s.ref)).toEqual(["f0", "f1"]);
    expect(p1.next).toBe("2");
    const p2 = pageSections(sections, p1.next, 250);

    expect(p2.sections.map((s) => s.ref)).toEqual(["f2", "f3"]);
    const p3 = pageSections(sections, p2.next, 250);

    expect(p3.sections.map((s) => s.ref)).toEqual(["f4"]);
    expect(p3.next).toBeUndefined();
  });
  it("splits one section larger than the budget across pages instead of dropping it", () => {
    const big = [
      { ref: "body", type: "richText", text: "line one\nline two\nline three\nline four" },
    ];
    const p1 = pageSections(big, undefined, 20);

    expect(p1.sections[0].text).toBe("line one\nline two");
    expect(p1.next).toBe("0:18");
    const p2 = pageSections(big, p1.next, 20);

    expect(p2.sections[0].text).toBe("line three\nline four");
    expect(p2.next).toBeUndefined();
  });
});

describe('readDocument({ view: "text" }) - the whole content, paged, never truncated', () => {
  const io = {
    read: vi.fn(async () => ({ doc })),
    list: vi.fn(),
    write: vi.fn(),
    create: vi.fn(),
    transports: () => ({ read: "local" }),
  } as unknown as DocumentIO;

  it("returns every section with a completion marker when it fits", async () => {
    const r: any = await createIoReadTools(io, schema).readDocument.execute!(
      { collection: "posts", id: 1, view: "text" },
      opts
    );

    expect(r.view).toBe("text");
    expect(r.complete).toBe(true);
    expect(r.sections.map((s: any) => s.ref)).toContain("content");
    expect(r.sections.find((s: any) => s.ref === "content").text).toContain("## Why headless");
    expect(r.next).toBeUndefined();
  });
  it("pages a huge body under the output cap and tells the model to follow `next`", async () => {
    const huge = {
      ...doc,
      content: rt(
        ...Array.from({ length: 900 }, (_, i) => para(text(`Paragraph ${i} `.repeat(6))))
      ),
    };
    const bigIo = { ...io, read: vi.fn(async () => ({ doc: huge })) } as unknown as DocumentIO;
    const r: any = await createIoReadTools(bigIo, schema).readDocument.execute!(
      { collection: "posts", id: 1, view: "text" },
      opts
    );

    expect(r.next).toBeDefined();
    expect(r.note).toMatch(/cursor/u);
    expect(JSON.stringify(r).length).toBeLessThan(MAX_STRIPPED_JSON_CHARS);
    const r2: any = await createIoReadTools(bigIo, schema).readDocument.execute!(
      { collection: "posts", id: 1, view: "text", cursor: r.next },
      opts
    );

    expect(r2.sections[0].ref).toBe("content");
    expect(r2.totalChars).toBe(r.totalChars);
  });
  it("the default view is unchanged: fields with content summarized", async () => {
    const r: any = await createIoReadTools(io, schema).readDocument.execute!(
      { collection: "posts", id: 1 },
      opts
    );

    expect(r.doc.title).toBe("Headless CMS architecture");
    expect(r.view).toBeUndefined();
  });
});

describe("the passthrough output cap points at the right continuation, not at the user", () => {
  it('names readDocument view "text" and never says to ask', () => {
    const capped = capMcpToolOutput({
      content: [
        { type: "text", text: JSON.stringify({ body: "x".repeat(MAX_STRIPPED_JSON_CHARS + 10) }) },
      ],
    }) as any;
    const t = capped.content[0].text;

    expect(t).toMatch(/readDocument\(\{ view: "text" \}\)/u);
    expect(t).toMatch(/not a reason to ask/u);
  });
});

describe("an empty criterion text can never hang the server", () => {
  it("checkCriteria with an empty needle returns instead of looping", async () => {
    const { checkCriteria } = await import("../src/agent/content/outcomeCriteria.js");
    const page = { title: "A page", body: "some text" };
    const r = checkCriteria(
      [
        { check: { type: "countAtMost", text: "", n: 0 } } as any,
        { check: { type: "absent", text: "" } } as any,
        { check: { type: "present", text: "" } } as any,
      ],
      page,
      page
    );

    expect(r.map((result) => [result.ok, result.detail])).toEqual([
      [true, '"" appears 0 time(s), at most 0 allowed.'],
      [true, '"" does not appear.'],
      [false, '"" does not appear anywhere.'],
    ]);
  });
  it("declareOutcome refuses an empty text", async () => {
    const { readCriteria } = await import("../src/agent/content/outcomeInput.js");
    const refused = (criterion: object) => "error" in readCriteria({ criteria: [criterion] });

    expect(refused({ type: "present", text: "" })).toBe(true);
    expect(refused({ type: "countAtMost", text: "", n: 0 })).toBe(true);
    expect(refused({ type: "present", text: "x" })).toBe(false);
  });
});
