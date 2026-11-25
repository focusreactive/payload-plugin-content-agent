import { describe, it, expect, vi } from "vitest";

let agentScript: (t: any, ctx: any) => Promise<string> = async () => "noop";
const agentPrompts: string[] = [];

vi.mock("ai", () => {
  class MockToolLoopAgent {
    config: any;
    constructor(config: any) {
      this.config = config;
    }
    async generate(args?: any) {
      const prompt = args?.prompt ?? args?.messages?.[0]?.content;

      if (typeof prompt === "string") agentPrompts.push(prompt);
      const ctx = { toolCallId: "t", messages: [] };
      const text = await agentScript(this.config.tools, ctx);

      return { text };
    }
  }

  return {
    ToolLoopAgent: MockToolLoopAgent,
    isStepCount: (_n: number) => () => false,
    hasToolCall: () => () => false,
    jsonSchema: (schema: any) => ({ jsonSchema: schema }),
    tool: (cfg: any) => ({
      description: cfg.description,
      inputSchema: cfg.inputSchema,
      execute: cfg.execute,
    }),
    generateText: vi.fn().mockResolvedValue({ output: { approved: true, reason: "ok" } }),
    Output: { object: ({ schema }: any) => schema },
  };
});

import { createContentEditorTools } from "../src/agent/content/contentEditor.js";
import { createDocumentIO } from "../src/agent/content/documentIo.js";
import {
  collectDocumentLinks,
  collectLinksInRichText,
  findLinkIssues,
  describeLink,
} from "../src/agent/content/links.js";
import { checkCriteria, linkIntent } from "../src/agent/content/outcomeCriteria.js";
import type { Criterion } from "../src/agent/content/outcomeCriteria.js";
import { collectTextNodes } from "../src/agent/content/lexicalEngine.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

function paraWithLink(before: string, anchor: string, url: string, after = "") {
  return {
    type: "paragraph",
    version: 1,
    children: [
      ...(before ? [{ type: "text", version: 1, text: before }] : []),
      {
        type: "link",
        version: 1,
        fields: { linkType: "custom", url, newTab: false },
        children: [{ type: "text", version: 1, text: anchor }],
      },
      ...(after ? [{ type: "text", version: 1, text: after }] : []),
    ],
  };
}

const rich = (...children: any[]) => ({ root: { type: "root", version: 1, children } });
const plainPara = (text: string) => ({
  type: "paragraph",
  version: 1,
  children: [{ type: "text", version: 1, text }],
});

const faqListBlock = {
  slug: "faqList",
  fields: [
    { name: "title", type: "text" },
    { name: "items", type: "array", fields: [{ name: "richText", type: "richText" }] },
  ] as SchemaField[],
};
const textIntroBlock = {
  slug: "textIntro",
  fields: [{ name: "text", type: "richText" }] as SchemaField[],
};

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text" },
        { name: "blocks", type: "blocks", blocks: [textIntroBlock, faqListBlock] },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};
const pageFields = schema.collections[0].fields as SchemaField[];
const opts = { toolCallId: "t", messages: [] } as any;

const docWithThreeLinks = () => ({
  id: "d1",
  title: "Migrate to Storyblok",
  blocks: [
    {
      id: "b1",
      blockType: "textIntro",
      text: rich(
        paraWithLink(
          "Work with a ",
          "Contentful agency",
          "https://my-agency.example/contentful-expert-agency/",
          " today."
        )
      ),
    },
    {
      id: "b2",
      blockType: "faqList",
      title: "FAQ",
      items: [
        {
          id: "r1",
          richText: rich(
            paraWithLink(
              "Coming from ",
              "Contentful",
              "https://my-agency.example/migrate-from-contentful/",
              "?"
            ),
            plainPara("We map templates and components first."),
            paraWithLink(
              "Or move to ",
              "Sanity",
              "https://my-agency.example/sanity-expert-agency/",
              " instead."
            )
          ),
        },
      ],
    },
  ],
});

function makeMcp(doc: any, captured: { update?: any } = {}) {
  return {
    findpages: {
      execute: vi
        .fn()
        .mockResolvedValue({ content: [{ text: `Resource:\n${JSON.stringify(doc)}` }] }),
    },
    updatepages: {
      execute: vi.fn(async (args: any) => {
        captured.update = args;

        return { content: [{ text: "{}" }] };
      }),
    },
  };
}

const toolsFor = (doc: any, captured: { update?: any } = {}) =>
  createContentEditorTools({
    io: createDocumentIO({ mcpTools: makeMcp(doc, captured), schema }),
    schema,
    model: {} as any,
    concurrency: 5,
  });

describe("collectLinksInRichText", () => {
  it("finds a link and flattens its anchor text", () => {
    const found = collectLinksInRichText(
      rich(paraWithLink("a ", "the anchor", "https://x.test/p", " b")),
      "text"
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      fieldRef: "text",
      linkType: "custom",
      url: "https://x.test/p",
      text: "the anchor",
    });
  });

  it("reads an internal link by its referenced document", () => {
    const value = rich({
      type: "paragraph",
      version: 1,
      children: [
        {
          type: "link",
          version: 1,
          fields: { linkType: "internal", doc: { relationTo: "pages", value: 42 } },
          children: [{ type: "text", version: 1, text: "see this" }],
        },
      ],
    });
    const found = collectLinksInRichText(value, "body");

    expect(found[0]).toMatchObject({ linkType: "internal", text: "see this" });
    expect(found[0].url).toBeUndefined();
    expect(describeLink(found[0])).toContain("document");
  });

  it("returns nothing for prose with no links", () => {
    expect(collectLinksInRichText(rich(plainPara("just words")), "text")).toHaveLength(0);
  });
});

describe("collectDocumentLinks", () => {
  it("finds links nested inside array rows of a block, not just top-level fields", () => {
    const links = collectDocumentLinks(pageFields, docWithThreeLinks());

    expect(links).toHaveLength(3);
    expect(links.map((l) => l.text)).toEqual(["Contentful agency", "Contentful", "Sanity"]);
    expect(links[2].fieldRef).toBe("blocks[b2].items[r1].richText");
  });
});

describe("collectTextNodes: which segments are anchors", () => {
  it("reports the enclosing link target for an anchor segment and nothing for prose", () => {
    const nodes = collectTextNodes(
      rich(paraWithLink("Work with a ", "Contentful agency", "https://x.test/c", " today."))
    );

    expect(nodes.map((n) => n.node.text)).toEqual(["Work with a ", "Contentful agency", " today."]);
    expect(nodes[0].linkTarget).toBeUndefined();
    expect(nodes[1].linkTarget).toBe("https://x.test/c");
    expect(nodes[2].linkTarget).toBeUndefined();
  });
});

describe("findLinkIssues: a rewritten anchor that kept its target", () => {
  it("reports the anchor whose words changed while the url stayed", () => {
    const before = docWithThreeLinks();
    const after = docWithThreeLinks();

    after.blocks[0].text = rich(
      paraWithLink(
        "Work with a ",
        "Sitecore to Storyblok migration partner",
        "https://my-agency.example/contentful-expert-agency/",
        " today."
      )
    );
    const { retargeted } = findLinkIssues(pageFields, before, after);

    expect(retargeted).toHaveLength(1);
    expect(retargeted[0].textBefore).toBe("Contentful agency");
    expect(retargeted[0].link.text).toBe("Sitecore to Storyblok migration partner");
    expect(retargeted[0].link.url).toBe("https://my-agency.example/contentful-expert-agency/");
  });

  it("stays quiet when the anchor text was left alone", () => {
    const { retargeted } = findLinkIssues(pageFields, docWithThreeLinks(), docWithThreeLinks());

    expect(retargeted).toHaveLength(0);
  });

  it("stays quiet for a TRANSLATION: every anchor is rewritten and every target kept, correctly", () => {
    const before = docWithThreeLinks();
    const after = docWithThreeLinks();

    after.blocks[0].text = rich(
      paraWithLink(
        "Trabaja con una ",
        "agencia de Contentful",
        "https://my-agency.example/contentful-expert-agency/",
        " hoy."
      )
    );
    const { retargeted } = findLinkIssues(pageFields, before, after, {
      isTranslation: true,
    });

    expect(retargeted).toHaveLength(0);
  });

  it("does not report a link that was removed outright - only surviving ones can disagree", () => {
    const before = docWithThreeLinks();
    const after = docWithThreeLinks();

    after.blocks[0].text = rich(plainPara("Work with a Storyblok partner today."));
    const { retargeted } = findLinkIssues(pageFields, before, after);

    expect(retargeted).toHaveLength(0);
  });
});

describe("linkCount: removed links are checked by counting", () => {
  const noLinks = [{ check: { type: "linkCount" as const, n: 0 } }];
  const check = (after: unknown) => checkCriteria(noLinks, docWithThreeLinks(), after)[0];

  it("fails while the links are in the document and lists them", () => {
    const result = check(docWithThreeLinks());

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("has 3 link(s), and exactly 0 were declared");
    expect(result.detail).toContain('"Contentful agency"');
  });

  it("passes once every link is gone", () => {
    const after = docWithThreeLinks();

    after.blocks[0].text = rich(plainPara("Work with a Storyblok partner today."));
    after.blocks[1].items![0].richText = rich(
      plainPara("Coming from Contentful? We map templates first.")
    );

    expect(check(after).ok).toBe(true);
  });

  it("catches exactly the live failure: one of two links in ONE field removed, the other left", () => {
    const after = docWithThreeLinks();

    after.blocks[0].text = rich(plainPara("Work with a Storyblok partner today."));
    after.blocks[1].items![0].richText = rich(
      plainPara("Coming from Contentful?"),
      plainPara("We map templates and components first."),
      paraWithLink(
        "Or move to ",
        "Sanity",
        "https://my-agency.example/sanity-expert-agency/",
        " instead."
      )
    );
    const result = check(after);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("has 1 link(s)");
    expect(result.detail).toContain('"Sanity"');
  });

  it("counts only the links of the declared field", () => {
    const faq = [{ path: "blocks[b2]", check: { type: "linkCount" as const, n: 2 } }];

    expect(checkCriteria(faq, docWithThreeLinks(), docWithThreeLinks())[0].ok).toBe(true);
  });
});

const intent = (criteria: Criterion[]) => linkIntent({ criteria }, docWithThreeLinks());
const count = (n: number, path?: string): Criterion => ({
  path,
  check: { type: "linkCount", n },
});

describe("linkIntent: what the declared counts say against the opened document", () => {
  it("says nothing when no link count is declared or the count is the one the document has", () => {
    expect(intent([])).toBeNull();
    expect(intent([{ check: { type: "unchanged" } }])).toBeNull();
    expect(intent([count(3)])).toBeNull();
  });

  it("reads a lower count as links removed and a higher one as links added", () => {
    expect(intent([count(0)])).toBe("fewer");
    expect(intent([count(1, "blocks[b2]")])).toBe("fewer");
    expect(intent([count(4)])).toBe("more");
    expect(intent([count(3, "blocks[b2]")])).toBe("more");
  });
});

describe("editContent: the link gates end to end", () => {
  it("names every surviving link to the editor inside its own session, and does not save while they stand", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockClear();
    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });
    let finish: any = null;

    agentScript = async (t, ctx) => {
      await t.declareOutcome.execute({ criteria: [{ type: "linkCount", n: 0 }] }, ctx);
      await t.setValues.execute({ edits: [{ ref: "title", value: "Links removed" }] }, ctx);
      finish = await t.finishEdit.execute({}, ctx);

      return "removed the links";
    };

    agentPrompts.length = 0;
    const captured: { update?: any } = {};
    const r: any = await toolsFor(docWithThreeLinks(), captured).editContent.execute!(
      { collection: "pages", id: "d1", instruction: "remove the links from the text" },
      opts
    );

    expect(agentPrompts).toHaveLength(1);
    expect(finish.ok).toBe(false);
    expect(finish.blocking.join(" ")).toContain("exactly 0 were declared");
    expect(finish.blocking.join(" ")).toContain("Contentful agency");
    expect(finish.blocking.join(" ")).toContain("Sanity");
    expect(r.status).toBe("done");
    expect(captured.update).toBeDefined();
    expect(r.issues.join(" ")).toContain("exactly 0 were declared");
    const prompt = vi.mocked(ai.generateText as any).mock.calls[0][0].messages[0].content as string;

    expect(prompt).toContain("Open issues");
    expect(prompt).toContain("Contentful agency");
  });

  it("hands a retargeted anchor to the reviewer as a stated fact", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockClear();
    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });
    let seenLinkTargets: Record<number, string> | undefined;

    agentScript = async (t, ctx) => {
      const view: any = await t.viewRichText.execute(
        { ref: "blocks[b1].text", mode: "transform" },
        ctx
      );

      seenLinkTargets = view.linkTargets;
      await t.applyRichText.execute(
        {
          ref: "blocks[b1].text",
          mode: "transform",
          segments: { 1: "Sitecore to Storyblok migration partner" },
          nodeCount: view.nodeCount,
        },
        ctx
      );

      return "rewrote the anchor";
    };

    await toolsFor(docWithThreeLinks()).editContent.execute!(
      { collection: "pages", id: "d1", instruction: "rewrite this page for Sitecore to Storyblok" },
      opts
    );
    expect(seenLinkTargets).toEqual({ 1: "https://my-agency.example/contentful-expert-agency/" });
    const prompt = vi.mocked(ai.generateText as any).mock.calls[0][0].messages[0].content as string;

    expect(prompt).toContain("TEXT changed while their TARGET stayed the same");
    expect(prompt).toContain('was "Contentful agency"');
    expect(prompt).toContain("/contentful-expert-agency/");
  });

  it("lets a correctly scoped edit through: a count declared for one block leaves the other links alone", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockClear();
    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "the remaining links are outside the FAQ" },
    });

    let finish: any = null;

    agentScript = async (t, ctx) => {
      await t.declareOutcome.execute(
        { criteria: [{ type: "linkCount", path: "blocks[b2]", n: 0 }] },
        ctx
      );
      await t.setValues.execute(
        { edits: [{ ref: "title", value: "Migrate to Storyblok now" }] },
        ctx
      );
      finish = await t.finishEdit.execute({}, ctx);

      return "the FAQ has no links; left the intro link alone";
    };

    const doc = docWithThreeLinks();

    doc.blocks[1].items![0].richText = rich(
      plainPara("Coming from Contentful? We map templates first.")
    );
    delete (doc.blocks[0] as any).text;
    doc.blocks[0].text = rich(
      paraWithLink(
        "Work with a ",
        "Contentful agency",
        "https://my-agency.example/contentful-expert-agency/",
        " today."
      )
    );
    const captured: { update?: any } = {};
    const r: any = await toolsFor(doc, captured).editContent.execute!(
      { collection: "pages", id: "d1", instruction: "remove the links from the FAQ" },
      opts
    );

    expect(finish.ok).toBe(true);
    expect(r.status).toBe("done");
    expect(captured.update).toBeDefined();
  });

  it("says nothing about links to the reviewer when none changed", async () => {
    const ai = await import("ai");

    vi.mocked(ai.generateText as any).mockClear();
    vi.mocked(ai.generateText as any).mockResolvedValue({
      output: { approved: true, reason: "ok" },
    });

    agentScript = async (t, ctx) => {
      await t.setValues.execute(
        { edits: [{ ref: "title", value: "Migrate to Storyblok now" }] },
        ctx
      );

      return "renamed";
    };

    await toolsFor(docWithThreeLinks()).editContent.execute!(
      { collection: "pages", id: "d1", instruction: "rename the title" },
      opts
    );
    const prompt = vi.mocked(ai.generateText as any).mock.calls[0][0].messages[0].content as string;

    expect(prompt).not.toContain("TARGET stayed the same");
  });
});
