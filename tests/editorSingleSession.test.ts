import { describe, it, expect, vi } from "vitest";

let agentScript: (t: any, ctx: any) => Promise<string> = async () => "noop";
let runs = 0;

vi.mock("ai", () => {
  class MockToolLoopAgent {
    config: any;
    constructor(config: any) {
      this.config = config;
    }
    async generate() {
      runs += 1;
      const text = await agentScript(this.config.tools, { toolCallId: "t", messages: [] });

      return { text };
    }
  }

  return {
    ToolLoopAgent: MockToolLoopAgent,
    stopCountIs: () => () => false,
    isStepCount: () => () => false,
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

import { generateText } from "ai";
import { createContentEditorTools } from "../src/agent/content/contentEditor.js";
import { singleResult } from "../src/agent/content/editor/shared.js";
import { writeStatusOf } from "../src/agent/writeStatus.js";
import type { SchemaContext, SchemaField } from "../src/types.js";

const schema: SchemaContext = {
  globals: [],
  collections: [
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text" },
        { name: "slug", type: "text", unique: true },
        { name: "body", type: "textarea" },
        { name: "intro", type: "textarea" },
      ] as SchemaField[],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
};
const opts = { toolCallId: "t", messages: [] } as any;

function persistentIo(initial: any) {
  const store = { doc: structuredClone(initial), writes: 0, reads: 0 };
  const io = {
    transports: () => ({ read: "local", write: "local", create: "local" }),
    lockRefusal: async () => null,
    read: vi.fn(async () => {
      store.reads += 1;

      return { doc: structuredClone(store.doc) };
    }),
    write: vi.fn(async (_t: any, o: any) => {
      store.writes += 1;
      store.doc = { ...store.doc, ...o.patch };

      return { doc: structuredClone(store.doc) };
    }),
    list: vi.fn(async (_c: string, o: any) => ({
      docs: (o.where?.slug?.in ?? []).includes("payload-cms-agency") ? [{ id: 1 }] : [],
      totalDocs: 0,
      totalPages: 1,
    })),
  } as any;

  return { io, store };
}

const nothing = () => {};

describe("editContent: one session, checks inside it", () => {
  it("does not open a document that another person has open in the admin", async () => {
    runs = 0;
    const { io, store } = persistentIo({ id: "d1", title: "Sanity agency" });

    io.lockRefusal = vi.fn(async () => "Document d1 is open in the admin panel of another person");
    agentScript = async () => "should not run";
    const tools = createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 1,
      telemetry: null,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "rename the page" },
      opts
    );

    expect(JSON.stringify(r)).toMatch(/open in the admin panel of another person/u);
    expect(io.lockRefusal).toHaveBeenCalledWith({ collection: "pages" }, "d1");
    expect(runs).toBe(0);
    expect(store.reads).toBe(0);
    expect(store.writes).toBe(0);
  });

  it("saves while the reviewer still reads, and reports its objection with the draft", async () => {
    const { io, store } = persistentIo({
      id: "d1",
      title: "Old",
      slug: "old",
      body: "",
      intro: "",
    });

    let markSaved = nothing;

    const saved = new Promise<void>((resolve) => {
      markSaved = resolve;
    });
    const write = io.write.getMockImplementation()!;

    io.write.mockImplementation(async (target: any, options: any) => {
      const result = await write(target, options);

      markSaved();

      return result;
    });
    vi.mocked(generateText).mockImplementationOnce((async () => {
      await saved;

      return { output: { approved: false, reason: "the wrong field changed" } };
    }) as any);

    agentScript = async (t, ctx) => {
      await t.setValues.execute({ edits: [{ ref: "title", value: "New" }] }, ctx);
      await t.finishEdit.execute({ summary: "Renamed the page." }, ctx);

      return "";
    };

    const tools = createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 1,
      telemetry: null,
    });
    const result: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "rename the page" },
      opts
    );

    expect(store.writes).toBe(1);
    expect(store.doc.title).toBe("New");
    expect(JSON.stringify(result)).toMatch(/review: the wrong field changed/u);
  });

  it("opens once, writes once, and reports what finishEdit still lists - unlinking a dead link instead of discarding the rewrite", async () => {
    runs = 0;
    const { io, store } = persistentIo({
      id: "d1",
      title: "Sanity agency",
      slug: "sanity",
      body: "Read about [Sanity](https://my-agency.example/payload-cms-agency/) here.",
      intro: "Sanity intro",
    });
    const finishes: any[] = [];

    agentScript = async (t, ctx) => {
      await t.setValues.execute({ edits: [{ ref: "intro", value: "Hygraph intro" }] }, ctx);
      await t.setValues.execute(
        {
          edits: [
            {
              ref: "body",
              value: "Read about [Hygraph](https://my-agency.example/hygraph-customization/) here.",
            },
          ],
        },
        ctx
      );
      finishes.push(await t.finishEdit.execute({}, ctx));
      await t.setValues.execute({ edits: [{ ref: "title", value: "Hygraph agency" }] }, ctx);
      finishes.push(await t.finishEdit.execute({}, ctx));

      return "rewrote the page; could not find a real page for the customization link";
    };

    const probe = vi.fn(async () => "missing" as const);
    const tools = createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 1,
      telemetry: null,
      probeLink: probe,
    });
    const r: any = await tools.editContent.execute!(
      {
        collection: "pages",
        id: "d1",
        instruction: "make this page about Hygraph instead of Sanity",
      },
      opts
    );

    expect(probe).toHaveBeenCalledWith("https://my-agency.example/hygraph-customization/");

    expect(runs).toBe(1);
    expect(store.reads).toBe(2);
    expect(store.writes).toBe(1);
    expect(finishes[0].ok).toBe(false);
    expect(finishes[0].blocking.join(" ")).toMatch(/hygraph-customization/u);
    expect(r.status).toBe("done");
    expect(store.doc.title).toBe("Hygraph agency");
    expect(store.doc.intro).toBe("Hygraph intro");
    expect(store.doc.body).toBe("Read about Hygraph here.");
    expect(
      r.issues.some(
        (i: string) => /unlinked, text kept/u.test(i) && /hygraph-customization/u.test(i)
      )
    ).toBe(true);
    expect(r.summary).toMatch(/Saved with \d+ open issue/u);
  });

  it("saves the draft and reports a criterion that the editor declared, failed and then dropped", async () => {
    runs = 0;
    const { io, store } = persistentIo({
      id: "d1",
      title: "Sanity agency",
      slug: "sanity",
      body: "Sanity body",
      intro: "Sanity intro",
    });
    const finishes: any[] = [];

    agentScript = async (t, ctx) => {
      await t.declareOutcome.execute(
        {
          criteria: [
            { type: "absent", text: "Sanity" },
            { path: "title", type: "present", text: "Hygraph" },
          ],
        },
        ctx
      );
      await t.setValues.execute({ edits: [{ ref: "title", value: "Hygraph agency" }] }, ctx);
      finishes.push(await t.finishEdit.execute({}, ctx));
      await t.declareOutcome.execute(
        { criteria: [{ path: "title", type: "present", text: "Hygraph" }] },
        ctx
      );
      finishes.push(await t.finishEdit.execute({}, ctx));

      return "renamed the title";
    };

    const tools = createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 1,
      telemetry: null,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "make this page about Hygraph" },
      opts
    );

    expect(finishes[0].ok).toBe(false);
    expect(finishes[0].blocking.join(" ")).toMatch(/success criteria you declared are not met/u);
    expect(finishes[1].open.join(" ")).toMatch(/declared again without them/u);
    expect(r.status).toBe("done");
    expect(store.doc.title).toBe("Hygraph agency");
    expect(
      r.issues.some((i: string) => /declared again without them/u.test(i) && /"Sanity"/u.test(i))
    ).toBe(true);
  });

  it("keeps a link it cannot verify, and keeps one the task itself names, instead of unlinking on a guess", async () => {
    runs = 0;
    const { io, store } = persistentIo({
      id: "d1",
      title: "T",
      slug: "t",
      body: "Read about [Sanity](https://my-agency.example/payload-cms-agency/) here.",
      intro: "x",
    });
    let first: any = null;

    agentScript = async (t, ctx) => {
      await t.setValues.execute(
        {
          edits: [
            {
              ref: "body",
              value:
                "Read the [blog](https://my-agency.example/blog/) and the [guide](https://my-agency.example/cms-guide/) here.",
            },
          ],
        },
        ctx
      );
      first = await t.finishEdit.execute({}, ctx);

      return "linked both";
    };

    const tools = createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      {
        collection: "pages",
        id: "d1",
        instruction: 'link "blog" to https://my-agency.example/blog/ and add a guide link',
      },
      opts
    );

    expect(first.ok).toBe(true);
    expect(first.open.join(" ")).toMatch(/could not be verified.*cms-guide/u);
    expect(first.open.join(" ")).not.toMatch(/\/blog\//u);
    expect(r.status).toBe("done");
    expect(store.doc.body).toBe(
      "Read the [blog](https://my-agency.example/blog/) and the [guide](https://my-agency.example/cms-guide/) here."
    );
    expect(
      r.issues.some((i: string) => /could not be verified/u.test(i) && /cms-guide/u.test(i))
    ).toBe(true);
    expect(r.issues.some((i: string) => /unlinked/u.test(i))).toBe(false);
  });

  it('a failed "unchanged" on a field the editor itself edited is a reported fact, not work to redo', async () => {
    runs = 0;
    const { io, store } = persistentIo({
      id: "d1",
      title: "T",
      slug: "t",
      body: "Lokalise explains howcontinuous localization removes the wait.",
      intro: "x",
    });
    let finish: any = null;

    agentScript = async (t, ctx) => {
      await t.declareOutcome.execute(
        {
          criteria: [
            { path: "body", type: "unchanged", why: "only spacing may change" },
            { path: "intro", type: "unchanged" },
          ],
        },
        ctx
      );
      await t.setValues.execute(
        {
          edits: [
            {
              ref: "body",
              value: "Lokalise explains how continuous localization removes the wait.",
            },
          ],
        },
        ctx
      );
      finish = await t.finishEdit.execute({}, ctx);

      return "added the missing space";
    };

    const tools = createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "fix the spacing around the links" },
      opts
    );

    expect(finish.ok).toBe(true);
    expect(finish.open.join(" ")).toMatch(/declared body unchanged and then edited it/u);
    expect(finish.open.join(" ")).toMatch(/do not move or undo/u);
    expect(r.status).toBe("done");
    expect(store.doc.body).toBe("Lokalise explains how continuous localization removes the wait.");
    expect(r.changes.join(" ")).toMatch(/body: .*howcontinuous.*-> .*how continuous/u);
  });

  it("ends a session that changed nothing as unchanged: no save, no review, not a failed write", async () => {
    runs = 0;
    const { io, store } = persistentIo({
      id: "d1",
      title: "T",
      slug: "t",
      body: "plain",
      intro: "x",
    });
    let first: any = null;

    agentScript = async (t, ctx) => {
      first = await t.finishEdit.execute({}, ctx);

      return "nothing to change";
    };

    const tools = createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "fix the typos" },
      opts
    );

    expect(first.ok).toBe(true);
    expect(first.unchanged).toBe(true);
    expect(first.note).toMatch(/nothing will be saved/u);
    expect(store.writes).toBe(0);
    expect(r.status).toBe("unchanged");
    expect(r.summary).toBe("nothing to change");
    expect(r.error).toBeUndefined();
    expect(writeStatusOf(r)).toBe("nothing-changed");
    expect(singleResult("editContent", r)).toMatch(/NOTHING was changed[\s\S]*nothing to change/u);
  });

  it("sends back an unchanged document that still holds what a declared criterion says must go", async () => {
    runs = 0;
    const { io, store } = persistentIo({
      id: "d1",
      title: "T",
      slug: "t",
      body: "[Note: check this] plain",
      intro: "x",
    });
    const finishes: any[] = [];

    agentScript = async (t, ctx) => {
      await t.declareOutcome.execute(
        { criteria: [{ path: "body", type: "absent", text: "[Note:" }] },
        ctx
      );
      for (let call = 0; call < 3; call += 1) finishes.push(await t.finishEdit.execute({}, ctx));

      return "could not remove the note";
    };

    const tools = createContentEditorTools({
      io,
      schema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "remove the note" },
      opts
    );

    expect(finishes[0].ok).toBe(false);
    expect(finishes[0].blocking[0]).toMatch(/still holds[\s\S]*\[Note:[\s\S]*not done/u);
    expect(finishes[1].ok).toBe(false);
    expect(finishes[2]).toMatchObject({ ok: true, unchanged: true });
    expect(store.writes).toBe(0);
    expect(r.status).toBe("unchanged");
  });

  it("sends back a link label that changed while its link still opens the same page", async () => {
    runs = 0;
    const linkSchema: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "pages",
          fields: [
            { name: "title", type: "text" },
            {
              name: "links",
              type: "array",
              fields: [
                { name: "label", type: "text" },
                { name: "url", type: "text" },
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
    const { io, store } = persistentIo({
      id: "d1",
      title: "Teams in Germany",
      links: [{ id: "r1", label: "Austria", url: "https://site.example/teams-austria" }],
    });
    const finishes: any[] = [];

    agentScript = async (t, ctx) => {
      await t.setValues.execute({ edits: [{ ref: "links[r1].label", value: "Belgium" }] }, ctx);
      finishes.push(await t.finishEdit.execute({}, ctx));
      await t.setValues.execute({ edits: [{ ref: "links[r1].label", value: "Austria" }] }, ctx);
      await t.setValues.execute({ edits: [{ ref: "title", value: "Teams in France" }] }, ctx);
      finishes.push(await t.finishEdit.execute({}, ctx));

      return "restored the label";
    };

    const tools = createContentEditorTools({
      io,
      schema: linkSchema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "make it about France" },
      opts
    );

    expect(finishes[0].ok).toBe(false);
    expect(finishes[0].blocking.join(" ")).toMatch(
      /links\[r1\]\.label: "Austria" -> "Belgium", and the link still opens https:\/\/site\.example\/teams-austria/u
    );
    expect(finishes[1].ok).toBe(true);
    expect(r.status).toBe("done");
    expect(store.doc.links[0].label).toBe("Austria");
    expect(store.doc.title).toBe("Teams in France");
  });

  it("puts back at the save a link label that still names another page than its link opens", async () => {
    runs = 0;
    const linkSchema: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "pages",
          fields: [
            { name: "title", type: "text" },
            {
              name: "links",
              type: "array",
              fields: [
                { name: "label", type: "text" },
                { name: "url", type: "text" },
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
    const { io, store } = persistentIo({
      id: "d1",
      title: "Teams in Germany",
      links: [{ id: "r1", label: "Austria", url: "https://site.example/teams-austria" }],
    });
    const finishes: any[] = [];

    agentScript = async (t, ctx) => {
      await t.setValues.execute({ edits: [{ ref: "links[r1].label", value: "Belgium" }] }, ctx);
      await t.setValues.execute({ edits: [{ ref: "title", value: "Teams in France" }] }, ctx);
      finishes.push(await t.finishEdit.execute({}, ctx));

      return "left the label";
    };

    const tools = createContentEditorTools({
      io,
      schema: linkSchema,
      model: {} as any,
      concurrency: 5,
      personMessage: "Make this page about Belgium.",
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "make it about France" },
      opts
    );

    expect(finishes[0].ok).toBe(false);
    expect(finishes[0].blocking.join(" ")).toMatch(
      /links\[r1\]\.label: "Austria" -> "Belgium", and the link still opens https:\/\/site\.example\/teams-austria/u
    );
    expect(r.status).toBe("done");
    expect(store.doc.links[0].label).toBe("Austria");
    expect(store.doc.title).toBe("Teams in France");
    expect(r.issues.join(" ")).toMatch(/put back as they were[\s\S]*"Austria" -> "Belgium"/u);
  });

  it("reports why when the save-time checks put the document back as it was opened", async () => {
    runs = 0;
    const linkSchema: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "pages",
          fields: [
            { name: "title", type: "text" },
            {
              name: "links",
              type: "array",
              fields: [
                { name: "label", type: "text" },
                { name: "url", type: "text" },
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
    const { io, store } = persistentIo({
      id: "d1",
      title: "Teams in Germany",
      links: [{ id: "r1", label: "Austria", url: "https://site.example/teams-austria" }],
    });

    vi.mocked(generateText).mockClear();

    agentScript = async (t, ctx) => {
      await t.setValues.execute({ edits: [{ ref: "links[r1].label", value: "Belgium" }] }, ctx);
      await t.finishEdit.execute({}, ctx);

      return "Relabelled the link.";
    };

    const tools = createContentEditorTools({
      io,
      schema: linkSchema,
      model: {} as any,
      concurrency: 5,
      personMessage: "Make this page about Belgium.",
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "make it about Belgium" },
      opts
    );

    expect(store.writes).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
    expect(r.status).toBe("unchanged");
    expect(r.issues.join(" ")).toMatch(/put back as they were[\s\S]*"Austria" -> "Belgium"/u);
    expect(singleResult("editContent", r)).toMatch(
      /NOTHING was changed[\s\S]*took back[\s\S]*put back as they were[\s\S]*Relabelled the link\./u
    );
  });

  it("passes a refused save on whole, with the next step its refusal names", async () => {
    const { io, store } = persistentIo({
      id: "d1",
      title: "Old",
      slug: "old",
      body: "",
      intro: "",
    });

    io.write.mockImplementation(async () => ({
      error:
        "Document d1 is open in the admin panel of another person, so the agent did not write to it. Nothing was written. Do not retry in this turn. Tell the person the two ways out.",
    }));

    agentScript = async (t, ctx) => {
      await t.setValues.execute({ edits: [{ ref: "title", value: "New" }] }, ctx);
      await t.finishEdit.execute({ summary: "Renamed the page." }, ctx);

      return "Renamed the page.";
    };

    const tools = createContentEditorTools({ io, schema, model: {} as any, concurrency: 5 });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "rename the page" },
      opts
    );

    expect(store.doc.title).toBe("Old");
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/Do not retry in this turn\. Tell the person the two ways out\./u);
  });

  it("keeps a new link label when the person named the old label and the new one", async () => {
    runs = 0;
    const linkSchema: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "pages",
          fields: [
            { name: "title", type: "text" },
            {
              name: "links",
              type: "array",
              fields: [
                { name: "label", type: "text" },
                { name: "url", type: "text" },
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
    const { io, store } = persistentIo({
      id: "d1",
      title: "Teams in Germany",
      links: [{ id: "r1", label: "Austria", url: "https://site.example/teams-austria" }],
    });
    const finishes: any[] = [];

    agentScript = async (t, ctx) => {
      await t.setValues.execute({ edits: [{ ref: "links[r1].label", value: "Belgium" }] }, ctx);
      await t.setValues.execute({ edits: [{ ref: "title", value: "Teams in France" }] }, ctx);
      finishes.push(await t.finishEdit.execute({}, ctx));

      return "left the label";
    };

    const tools = createContentEditorTools({
      io,
      schema: linkSchema,
      model: {} as any,
      concurrency: 5,
      personMessage: 'Rename the link "Austria" to "Belgium".',
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "make it about France" },
      opts
    );

    expect(finishes[0].ok).toBe(true);
    expect(r.status).toBe("done");
    expect(store.doc.links[0].label).toBe("Belgium");
    expect(r.issues).toBeUndefined();
  });

  it("still refuses to ship an empty section shell, with no session left to send it back to", async () => {
    runs = 0;
    const blocksSchema: SchemaContext = {
      globals: [],
      collections: [
        {
          slug: "pages",
          fields: [
            { name: "title", type: "text" },
            {
              name: "layout",
              type: "blocks",
              blocks: [
                {
                  slug: "faq",
                  fields: [
                    { name: "title", type: "text" },
                    { name: "items", type: "array", fields: [{ name: "q", type: "text" }] },
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
    const { io, store } = persistentIo({ id: "d1", title: "T", layout: [] });

    agentScript = async (t, ctx) => {
      await t.insertItem.execute(
        { path: "layout", blockType: "faq", fields: { title: "FAQ" } },
        ctx
      );

      return "added an FAQ";
    };

    const tools = createContentEditorTools({
      io,
      schema: blocksSchema,
      model: {} as any,
      concurrency: 5,
    });
    const r: any = await tools.editContent.execute!(
      { collection: "pages", id: "d1", instruction: "add an FAQ section" },
      opts
    );

    expect(r.status).toBe("rejected");
    expect(r.reviewReason).toMatch(/empty shells/u);
    expect(store.writes).toBe(0);
  });
});
