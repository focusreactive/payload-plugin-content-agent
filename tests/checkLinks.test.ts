import { describe, expect, it } from "vitest";
import { checkLinks } from "../src/agent/tools/checkLinks.js";
import type { SchemaContext } from "../src/types.js";

const schema = {
  globals: [],
  collections: [
    {
      slug: "notes",
      useAsTitle: "title",
      fields: [
        { name: "title", type: "text" },
        { name: "handle", type: "text", unique: true },
        { name: "summary", type: "textarea" },
        { name: "body", type: "richText" },
      ],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "aliases",
      useAsTitle: "old",
      fields: [{ name: "old", type: "text", unique: true }],
      hasVersions: false,
      hasDrafts: false,
      hasAuth: false,
      timestamps: true,
    },
  ],
} as unknown as SchemaContext;

const text = (value: string) => ({ type: "text", text: value });
const link = (url: string, label: string) => ({
  type: "link",
  fields: { linkType: "custom", url },
  children: [text(label)],
});
const reference = (id: number, label: string) => ({
  type: "link",
  fields: { linkType: "internal", doc: { relationTo: "notes", value: id } },
  children: [text(label)],
});
const body = (...nodes: unknown[]) => ({
  root: { type: "root", children: [{ type: "paragraph", children: nodes }] },
});

interface Stored {
  doc: Record<string, any>;
  live: boolean;
}

function store(extra: unknown[] = []): Record<string, Stored[]> {
  return {
    notes: [
      {
        live: true,
        doc: {
          id: 1,
          _status: "published",
          title: "Alpha",
          handle: "alpha",
          body: body(
            link("https://site.example/notes/beta/", "to beta"),
            link("https://site.example/notes/gamma", "to gamma"),
            link("https://site.example/notes/missing", "to nothing"),
            link("https://site.example/old/alpha", "old alpha"),
            link("#", "empty"),
            link("https://elsewhere.example/page", "outside"),
            link("mailto:desk@elsewhere.example", "mail"),
            reference(2, "beta by id"),
            reference(77, "gone by id"),
            ...extra
          ),
        },
      },
      { live: false, doc: { id: 2, _status: "draft", title: "Beta", handle: "beta" } },
      {
        live: true,
        doc: {
          id: 3,
          _status: "draft",
          title: "Gamma",
          handle: "gamma",
          summary: "See [the first note](/notes/alpha).",
        },
      },
    ],
    aliases: [{ live: true, doc: { id: 9, old: "/old/alpha" } }],
  };
}

function matches(doc: Record<string, any>, where: any): boolean {
  if (!where) return true;
  if (where.and) return where.and.every((clause: any) => matches(doc, clause));
  if (where.or) return where.or.some((clause: any) => matches(doc, clause));

  return Object.entries(where).every(([field, test]: [string, any]) =>
    "in" in test ? test.in.includes(doc[field]) : doc[field] === test.equals
  );
}

function io(data = store()): any {
  return {
    transports: () => ({ read: "mcp" }),
    list: async (collection: string, { where, draft }: any = {}) => {
      const docs = data[collection]
        .filter(({ live }) => draft !== false || live)
        .map(({ doc }) => (draft === false ? { ...doc, _status: "published" } : doc))
        .filter((doc) => matches(doc, where));

      return { docs, totalDocs: docs.length, totalPages: 1 };
    },
  };
}

const run = (input: object = {}, context: object = {}, data = store()): Promise<any> =>
  checkLinks({ io: io(data), schema, ...context }, { collection: "notes", ...input });

const target = (result: any, url: string) => result.targets.find((entry: any) => entry.url === url);

describe("checkLinks: every link of a collection with the state of its target", () => {
  it("counts every link and lists the targets that need a person", async () => {
    const result = await run();

    expect(result.documents).toBe(3);
    expect(result.links).toBe(10);
    expect(result.siteHosts).toEqual(["site.example"]);
    expect(result.byState).toEqual({
      "not-found": { targets: 2, links: 2 },
      unpublished: { targets: 2, links: 2 },
      "no-address": { targets: 1, links: 1 },
      "address-record": { targets: 1, links: 1 },
      document: { targets: 2, links: 2 },
      external: { targets: 1, links: 1 },
      other: { targets: 1, links: 1 },
    });
    expect(result.targets.map((entry: any) => entry.state)).toEqual([
      "not-found",
      "not-found",
      "unpublished",
      "unpublished",
      "no-address",
      "address-record",
    ]);
    expect(result.notListed).toMatch(/document, external, other/u);
  });

  it("names the document and the field of a link, with its text", async () => {
    const result = await run();

    expect(target(result, "https://site.example/notes/missing").in).toEqual([
      { id: 1, title: "Alpha", field: "body", text: "to nothing" },
    ]);
  });

  it("tells a document that was never published from a draft over a published version", async () => {
    const result = await run({ states: ["unpublished", "document"] });

    expect(target(result, "https://site.example/notes/beta/")).toMatchObject({
      state: "unpublished",
      documents: [{ collection: "notes", id: 2, title: "Beta", published: false }],
    });
    expect(target(result, "https://site.example/notes/gamma")).toMatchObject({
      state: "document",
      documents: [{ collection: "notes", id: 3, published: true }],
    });
    expect(target(result, "/notes/alpha").in[0]).toMatchObject({ id: 3, field: "summary" });
  });

  it("reads a stored percent-encoded # as a link without an address", async () => {
    const result = await run({}, {}, store([link("%23", "nowhere")]));

    expect(target(result, "%23")).toMatchObject({
      state: "no-address",
      in: [{ id: 1, field: "body", text: "nowhere" }],
    });
  });

  it("finds a document whose key is a part of the path with more than one segment", async () => {
    const data = store([link("https://site.example/notes/deep/delta/", "to delta")]);

    data.notes.push({
      live: true,
      doc: { id: 4, _status: "published", title: "Delta", handle: "deep/delta" },
    });
    const result = await run({ states: ["document"] }, {}, data);

    expect(target(result, "https://site.example/notes/deep/delta/")).toMatchObject({
      state: "document",
      documents: [{ collection: "notes", id: 4 }],
    });
  });

  it("names the document that holds the whole address as its key", async () => {
    const result = await run();

    expect(target(result, "https://site.example/old/alpha")).toMatchObject({
      state: "address-record",
      heldBy: [{ collection: "aliases", id: 9, field: "old", title: "/old/alpha" }],
      documents: [{ collection: "notes", id: 1 }],
    });
  });

  it("gives the state of a link that names a document by id", async () => {
    const result = await run();
    const byId = result.targets.filter((entry: any) => !entry.url && entry.state !== "no-address");

    expect(byId).toEqual([
      expect.objectContaining({
        state: "not-found",
        in: [expect.objectContaining({ text: "gone by id" })],
      }),
      expect.objectContaining({
        state: "unpublished",
        documents: [{ collection: "notes", id: 2, title: "Beta", published: false }],
      }),
    ]);
  });

  it("does not take a host for this site when its addresses are no documents here", async () => {
    const data = store([
      link("https://elsewhere.example/alpha", "one"),
      link("https://elsewhere.example/two", "two"),
      link("https://elsewhere.example/three", "three"),
      link("https://elsewhere.example/four", "four"),
    ]);
    const result = await run({ states: ["external"] }, {}, data);

    expect(result.siteHosts).toEqual(["site.example"]);
    expect(result.byState.external).toEqual({ targets: 5, links: 5 });
    expect(target(result, "https://elsewhere.example/alpha").state).toBe("external");
  });

  it("takes the host of the site address from the config", async () => {
    const result = await run({}, { siteUrl: "https://www.site.example" });

    expect(result.siteHosts).toEqual(["site.example"]);
  });

  it("adds what the site itself answered for an address without a document", async () => {
    const asked: string[] = [];
    const missing = await run(
      {},
      {
        probe: async (url: string) => {
          asked.push(url);

          return "missing";
        },
      }
    );

    expect(asked).toEqual(["https://site.example/notes/missing"]);
    expect(target(missing, "https://site.example/notes/missing").live).toBe("404");

    const opens = await run({ states: ["other"] }, { probe: async () => "ok" });

    expect(target(opens, "https://site.example/notes/missing")).toMatchObject({
      state: "other",
      live: "opens",
    });
  });

  it("refuses an unknown collection and lists the collections", async () => {
    const unknown = await run({ collection: "letters" });

    expect(unknown.error).toMatch(/Unknown collection "letters". Available: notes, aliases/u);
  });
});
