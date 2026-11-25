import { describe, it, expect, vi } from "vitest";
import { replaceTextInLexical } from "../src/agent/subAgents/programmaticOps.js";
import { createFindReplaceTool } from "../src/agent/content/findReplace.js";
import { createTurnApprovals, decideApproval } from "../src/agent/approvals.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

import { createDocumentIO } from "../src/agent/content/documentIo.js";
import { parseApprovalRequest } from "../src/approvalRequest.js";

const asIo = (tools: any, s: any) => createDocumentIO({ mcpTools: tools, schema: s });

const opts = { toolCallId: "t", messages: [] } as any;

describe("replaceTextInLexical (lossless tree walk)", () => {
  it("replaces text in text nodes and counts occurrences", () => {
    const content = {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Best CMS in 2025 and again 2025" }],
          },
          { type: "heading", tag: "h2", children: [{ type: "text", text: "Plans for 2025" }] },
        ],
      },
    };
    const { content: out, count }: { content: any; count: number } = replaceTextInLexical(
      content,
      "2025",
      "2026"
    );

    expect(count).toBe(3);
    expect(JSON.stringify(out)).not.toContain("2025");
    expect(out.root.children[1].children[0].text).toBe("Plans for 2026");
  });

  it("PRESERVES blocks/uploads but DOES replace link URLs (matches what searchContent surfaces)", () => {
    const content = {
      root: {
        type: "root",
        children: [
          {
            type: "block",
            fields: { blockType: "cta", heading: "Sign up 2025", url: "https://x.com/2025" },
          },
          { type: "upload", relationTo: "media", value: "m1" },
          {
            type: "link",
            fields: { url: "https://x.com/2025", linkType: "custom" },
            children: [{ type: "text", text: "link 2025" }],
          },
        ],
      },
    };
    const { content: out, count }: { content: any; count: number } = replaceTextInLexical(
      content,
      "2025",
      "2026"
    );

    expect(out.root.children[0]).toEqual({
      type: "block",
      fields: { blockType: "cta", heading: "Sign up 2025", url: "https://x.com/2025" },
    });
    expect(out.root.children[1]).toEqual({ type: "upload", relationTo: "media", value: "m1" });
    expect(out.root.children[2].fields.url).toBe("https://x.com/2026");
    expect(out.root.children[2].children[0].text).toBe("link 2026");
    expect(count).toBe(2);
  });

  it("normalizes a contact-us link URL everywhere it appears (the user's real task)", () => {
    const content = {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "link",
                fields: { url: "https://my-agency.example/#contacts", linkType: "custom" },
                children: [{ type: "text", text: "Get in touch" }],
              },
            ],
          },
          {
            type: "autolink",
            fields: { url: "https://my-agency.example/#contacts" },
            children: [{ type: "text", text: "reach out" }],
          },
        ],
      },
    };
    const { content: out, count }: { content: any; count: number } = replaceTextInLexical(
      content,
      "https://my-agency.example/#contacts",
      "https://my-agency.example/contact-us"
    );

    expect(count).toBe(2);
    expect(JSON.stringify(out)).not.toContain("#contacts");
  });
});

function makeMcp(saved: Record<string, any>) {
  const docs: Record<string, any> = {
    "1": {
      id: "1",
      title: "SEO in 2025",
      content: {
        root: {
          children: [{ type: "paragraph", children: [{ type: "text", text: "written 2025" }] }],
        },
      },
    },
    "2": { id: "2", title: "No year here", content: { root: { children: [] } } },
  };

  return {
    findposts: {
      execute: vi.fn(async ({ id }: any) => ({
        content: [{ text: JSON.stringify(docs[String(id)]) }],
      })),
    },
    updateposts: {
      execute: vi.fn(async (args: any) => {
        saved[String(args.id)] = args;

        return { content: [{ text: "{}" }] };
      }),
    },
  };
}

describe("findReplaceContent tool (deterministic bulk, no LLM)", () => {
  const schema: SchemaContext = {
    globals: [],
    collections: [
      {
        slug: "posts",
        fields: [
          { name: "title", type: "text" },
          { name: "content", type: "richText", editor: "lexical" },
        ] as SchemaField[],
        hasVersions: true,
        hasDrafts: true,
        hasAuth: false,
        timestamps: true,
      },
    ],
  };

  it("replaces across ids, saves only changed docs, reports counts", async () => {
    const saved: Record<string, any> = {};
    const tools = createFindReplaceTool(asIo(makeMcp(saved), schema), schema);
    const r: any = await tools.findReplaceContent.execute!(
      { collection: "posts", find: "2025", replace: "2026", ids: ["1", "2"] },
      opts
    );

    expect(r.totalReplacements).toBe(2);
    expect(r.changedDocs).toBe(1);
    expect(saved["1"].title).toBe("SEO in 2026");
    expect(JSON.stringify(saved["1"].content)).toContain("written 2026");
    expect(saved["2"]).toBeUndefined();
  });

  it("in a locale other than the default, leaves a match in a field shared by every locale and says so", async () => {
    const localized: SchemaContext = {
      globals: [],
      locales: ["en", "es"],
      defaultLocale: "en",
      collections: [
        {
          slug: "posts",
          fields: [
            { name: "title", type: "text", localized: true },
            { name: "slug", type: "text" },
          ] as SchemaField[],
          hasVersions: true,
          hasDrafts: true,
          hasAuth: false,
          timestamps: true,
        },
      ],
    };
    const doc = { id: "3", title: "Verano 2025", slug: "summer-2025" };

    const run = async (locale: string) => {
      const saved: Record<string, any> = {};
      const mcp = {
        findposts: {
          execute: vi.fn(async () => ({ content: [{ text: JSON.stringify(doc) }] })),
        },
        updateposts: {
          execute: vi.fn(async (args: any) => {
            saved[String(args.id)] = args;

            return { content: [{ text: "{}" }] };
          }),
        },
      };
      const tools = createFindReplaceTool(asIo(mcp, localized), localized);
      const r: any = await tools.findReplaceContent.execute!(
        { collection: "posts", find: "2025", replace: "2026", ids: ["3"], locale },
        opts
      );

      return { r, saved };
    };

    const es = await run("es");

    expect(es.saved["3"].title).toBe("Verano 2026");
    expect(es.saved["3"].slug).toBeUndefined();
    expect(es.r.sharedSkipped).toBe(1);
    expect(es.r.sharedNote).toMatch(/shared by every locale[\s\S]*without `locale`/u);
    expect(es.r.noMatchIds).toBeUndefined();

    const en = await run("en");

    expect(en.saved["3"].slug).toBe("summer-2026");
    expect(en.r.sharedSkipped).toBeUndefined();
  });

  it("names the documents with no match and says why a found string can have none", async () => {
    const tools = createFindReplaceTool(asIo(makeMcp({}), schema), schema);
    const r: any = await tools.findReplaceContent.execute!(
      { collection: "posts", find: "2025", replace: "2026", ids: ["1", "2"] },
      opts
    );

    expect(r.noMatchIds).toEqual(["2"]);
    expect(r.noMatchNote).toMatch(/1 document\(s\) had no match and were not changed \(ids: 2\)/u);
    expect(r.noMatchNote).toMatch(/exact case/u);
    expect(r.noMatchNote).toMatch(/one run of formatting/u);
    expect(r.noMatchNote).not.toMatch(/fallback/u);
    expect(r.notStartedIds).toBeUndefined();
  });

  it("refuses a run on more than 5 documents that the person did not confirm, and saves nothing", async () => {
    const saved: Record<string, any> = {};
    const tools = createFindReplaceTool(asIo(makeMcp(saved), schema), schema);
    const ids = ["1", "2", "3", "4", "5", "6"];
    const r: any = await tools.findReplaceContent.execute!(
      { collection: "posts", find: "2025", replace: "2026", ids },
      opts
    );

    expect(r.error).toContain("6 documents");
    expect(r.error).toContain("Call findReplaceContent again");
    expect(Object.keys(saved)).toHaveLength(0);
  });

  it("asks the person with the exact scope, and runs after the click", async () => {
    const saved: Record<string, any> = {};
    const approvals = createTurnApprovals();
    const tools = createFindReplaceTool(asIo(makeMcp(saved), schema), schema, { approvals });
    const input = {
      collection: "posts",
      find: "2025",
      replace: "2026",
      ids: ["1", "2", "3", "4", "5", "6"],
    };
    const asked = await decideApproval(approvals, {
      toolName: "findReplaceContent",
      toolCallId: "t",
      input,
    });

    expect(parseApprovalRequest(asked?.reason)).toMatchObject({
      kind: "replace",
      collection: "posts",
      count: 6,
      find: "2025",
      replace: "2026",
    });
    const r: any = await tools.findReplaceContent.execute!(input, opts);

    expect(r.error).toBeUndefined();
    expect(saved["1"].title).toBe("SEO in 2026");
  });

  it("does not ask for a run at the threshold", async () => {
    const approvals = createTurnApprovals();

    createFindReplaceTool(asIo(makeMcp({}), schema), schema, { approvals });
    const asked = await decideApproval(approvals, {
      toolName: "findReplaceContent",
      toolCallId: "t",
      input: { collection: "posts", find: "a", replace: "b", ids: ["1", "2", "3", "4", "5"] },
    });

    expect(asked).toBeUndefined();
  });
});

const paragraph = (text: string) => ({
  type: "paragraph",
  children: [{ type: "text", text }],
});

describe("findReplaceContent reaches rich text inside a block embedded in rich text", () => {
  const schema: SchemaContext = {
    globals: [],
    collections: [
      {
        slug: "posts",
        fields: [
          {
            name: "content",
            type: "richText",
            editor: "lexical",
            blocks: [
              {
                slug: "banner",
                fields: [{ name: "content", type: "richText", editor: "lexical" }],
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
    id: "7",
    content: {
      root: {
        type: "root",
        children: [
          paragraph("Prices of 2025"),
          {
            type: "block",
            fields: {
              id: "b1",
              blockType: "banner",
              content: { root: { type: "root", children: [paragraph("Offer valid in 2025")] } },
            },
          },
        ],
      },
    },
  };

  it("replaces the text of the parent and of the embedded block once each", async () => {
    const saved: Record<string, any> = {};
    const mcp = {
      findposts: { execute: async () => ({ content: [{ text: JSON.stringify(doc) }] }) },
      updateposts: {
        execute: async (args: any) => {
          saved[String(args.id)] = args;

          return { content: [{ text: "{}" }] };
        },
      },
    };
    const tools = createFindReplaceTool(asIo(mcp, schema), schema);
    const r: any = await tools.findReplaceContent.execute!(
      { collection: "posts", find: "2025", replace: "2026", ids: ["7"] },
      opts
    );
    const children = saved["7"].content.root.children;

    expect(r.totalReplacements).toBe(2);
    expect(children[0].children[0].text).toBe("Prices of 2026");
    expect(children[1].fields.content.root.children[0].children[0].text).toBe(
      "Offer valid in 2026"
    );
  });
});
