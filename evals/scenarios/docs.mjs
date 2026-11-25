import { joined, paragraphs, same } from "../lib/lexical.mjs";

const page = (ref) => ({ collection: ref.collection, documentId: String(ref.id) });
const rows = (doc) => (doc.steps ?? []).map(({ heading, detail }) => ({ heading, detail }));
const nav = (g) => (g.links ?? []).map(({ label, path }) => ({ label, path }));
const content = ({ title, summary, body, steps, seo }) => ({
  title,
  summary,
  body,
  steps,
  seo,
});

export default [
  {
    id: "translate-field",
    title: "Translate one field into the second locale",
    uses: ["install"],
    async run({ api, docs, read, send }) {
      // The German value starts empty, so every run does the same work.
      await api.patchDoc("articles", docs.install.id, { summary: null }, "de");
      const before = await read("install", "en");
      const turn = await send("Translate the summary of this article into German.", {
        pageContext: page(docs.install),
      });
      const en = await read("install", "en");
      const de = await api.req(
        "GET",
        `/api/articles/${docs.install.id}?depth=0&draft=true&locale=de&fallback-locale=none`
      );
      const details = {
        german: de.summary,
        englishUnchanged: en.summary === before.summary,
        englishBodyUnchanged: same(en.body, before.body),
        looksGerman: /\b(und|den|das|die|der|mit|sich|Ihrem|Sie)\b/u.test(de.summary ?? ""),
      };

      return {
        ok:
          Boolean(de.summary) &&
          de.summary !== en.summary &&
          details.englishUnchanged &&
          details.englishBodyUnchanged &&
          details.looksGerman,
        details,
        turn,
      };
    },
  },
  {
    id: "bulk-translate",
    title: "Translate one field of several documents",
    uses: ["install", "invoices"],
    async run({ api, docs, read, send }) {
      const names = ["install", "invoices"];

      for (const n of names) await api.patchDoc("articles", docs[n].id, { summary: null }, "de");
      const before = await Promise.all(names.map((n) => read(n, "en")));
      const turn = await send("Translate the summary of every article into German.");
      const en = await Promise.all(names.map((n) => read(n, "en")));
      const de = await Promise.all(
        names.map((n) =>
          api.req(
            "GET",
            `/api/articles/${docs[n].id}?depth=0&draft=true&locale=de&fallback-locale=none`
          )
        )
      );
      const perDoc = names.map((_, i) => ({
        german: de[i].summary,
        ok:
          Boolean(de[i].summary) &&
          de[i].summary !== en[i].summary &&
          /\b(und|den|das|die|der|mit|sich|Ihrem|Sie|als|eine?)\b/u.test(de[i].summary) &&
          en[i].summary === before[i].summary &&
          same(en[i].body, before[i].body) &&
          en[i].title === before[i].title,
      }));

      return { ok: perDoc.every((d) => d.ok), details: { perDoc }, turn };
    },
  },
  {
    id: "array-row-edit",
    title: "Change one field of one array row",
    uses: ["install"],
    async run({ docs, read, send }) {
      const before = await read("install");
      const value = "Accept the license. Choose the folder you want.";
      const turn = await send(
        `In the steps, change the detail of the step "Run the installer" to exactly: "${value}" Change nothing else.`,
        { pageContext: page(docs.install) }
      );
      const after = await read("install");
      const expected = rows(before).map((r) =>
        r.heading === "Run the installer" ? { ...r, detail: value } : r
      );
      const details = { steps: rows(after), bodyUnchanged: same(before.body, after.body) };

      return {
        ok: same(rows(after), expected) && details.bodyUnchanged && before.title === after.title,
        details,
        turn,
      };
    },
  },
  {
    id: "group-field",
    title: "Change a field inside a group",
    uses: ["install"],
    async run({ docs, read, send }) {
      const before = await read("install");
      const value = "Install the desktop app on Windows or macOS in three steps.";
      const turn = await send(
        `Set the SEO meta description of this article to exactly: "${value}" Change nothing else.`,
        { pageContext: page(docs.install) }
      );
      const after = await read("install");
      const details = {
        metaDescription: after.seo?.metaDescription,
        metaTitleUnchanged: before.seo?.metaTitle === after.seo?.metaTitle,
        summaryUnchanged: before.summary === after.summary,
      };

      return {
        ok:
          after.seo?.metaDescription === value &&
          details.metaTitleUnchanged &&
          details.summaryUnchanged &&
          same(before.body, after.body),
        details,
        turn,
      };
    },
  },
  {
    id: "replace-in-one-field",
    title: "Replace a phrase in the body and leave the same phrase in other fields",
    uses: ["install"],
    async run({ docs, read, send }) {
      const before = await read("install");
      const turn = await send(
        'In the body field only, replace "workspace admin" with "workspace owner". Do not touch the steps.',
        { pageContext: page(docs.install) }
      );
      const after = await read("install");
      const details = {
        body:
          joined(after.body).includes("workspace owner") &&
          !joined(after.body).includes("workspace admin"),
        bodyIsExactlyTheReplacement:
          joined(after.body) === joined(before.body).replace("workspace admin", "workspace owner"),
        stepsUnchanged: same(rows(before), rows(after)),
        nodeCount: [paragraphs(before.body).length, paragraphs(after.body).length],
      };

      return {
        ok:
          details.bodyIsExactlyTheReplacement &&
          details.stepsUnchanged &&
          details.nodeCount[0] === details.nodeCount[1],
        details,
        turn,
      };
    },
  },
  {
    id: "global-array-add",
    title: "Add a row to a global that has drafts",
    uses: ["global:navigation"],
    async run({ api, send }) {
      const before = await api.getGlobal("navigation");
      const turn = await send(
        'Add a link "Glossary" with the path "/glossary" to the end of the navigation. Keep the existing links.'
      );
      const after = await api.getGlobal("navigation");
      const details = { links: nav(after) };

      return {
        ok: same(nav(after), [...nav(before), { label: "Glossary", path: "/glossary" }]),
        details,
        turn,
      };
    },
  },
  {
    id: "discard-localized",
    title: "Restore drill: a discard brings a translated locale back to its own state",
    uses: ["install"],
    async run({ api, docs, read, send }) {
      const german = () =>
        api.req(
          "GET",
          `/api/articles/${docs.install.id}?depth=0&draft=true&locale=de&fallback-locale=none`
        );

      await api.patchDoc("articles", docs.install.id, { summary: null }, "de");
      const before = { en: await read("install", "en"), de: await german() };
      const turn = await send("Translate the summary of this article into German.", {
        pageContext: page(docs.install),
      });
      const translated = await german();
      const { results } = await api.discard(turn.conversationId, [
        { collection: "articles", id: docs.install.id },
      ]);
      const after = { en: await read("install", "en"), de: await german() };
      const details = {
        translated: translated.summary,
        results,
        germanRestored: same(content(after.de), content(before.de)),
        germanDiffers: Object.keys(content(before.de)).filter(
          (key) => !same(after.de[key], before.de[key])
        ),
        germanSummary: after.de.summary,
        englishUnchanged: same(content(after.en), content(before.en)),
      };

      return {
        ok:
          Boolean(translated.summary) &&
          results.some((result) => result.status === "restored") &&
          details.germanRestored &&
          details.englishUnchanged,
        details,
        turn,
      };
    },
  },
  {
    id: "discard-global",
    title: "Restore drill: a discard brings a global back",
    uses: ["global:navigation"],
    async run({ api, send }) {
      const before = await api.getGlobal("navigation");
      const turn = await send(
        'Add a link "Glossary" with the path "/glossary" to the end of the navigation. Keep the existing links.'
      );
      const changed = await api.getGlobal("navigation");
      const { results } = await api.discard(turn.conversationId, [
        { collection: "global:navigation", id: "navigation" },
      ]);
      const after = await api.getGlobal("navigation");
      const details = { changed: nav(changed), results, links: nav(after) };

      return {
        ok:
          nav(changed).length === nav(before).length + 1 &&
          results.some((result) => result.status === "restored") &&
          same(nav(after), nav(before)),
        details,
        turn,
      };
    },
  },
  {
    id: "read-only-question",
    title: "A question that must not change anything",
    uses: ["install"],
    async run({ api, docs, read, send }) {
      const before = await read("install");
      const turn = await send("Which steps does this article have? Do not change anything.", {
        pageContext: page(docs.install),
      });
      const after = await read("install");
      const refs = (await api.changes(turn.conversationId)).refs ?? [];
      const named = rows(before).filter((r) => turn.text.includes(r.heading)).length;

      return {
        ok: same(before, after) && refs.length === 0 && named === 3,
        details: {
          stepsNamed: named,
          changes: refs.length,
          documentUnchanged: same(before, after),
        },
        turn,
      };
    },
  },
  {
    id: "no-drafts-collection",
    title: "A collection without drafts is written only after the person confirms the live change",
    // The client clicks Confirm on the card by itself (`turn.approvals`).
    uses: [],
    async run({ api, send }) {
      const billing =
        (await api.find("categories", "where[name][equals]=Billing&where[parent][exists]=false"))
          .docs[0] ?? (await api.find("categories", "where[name][equals]=Payments")).docs[0];

      if (billing.name !== "Billing")
        await api.req("PATCH", `/api/categories/${billing.id}`, { name: "Billing" });
      const count = async () => (await api.find("categories", "limit=1")).totalDocs;
      const before = await count();
      const turn = await send('Rename the category "Billing" to "Payments".');
      const after = await api.getDoc("categories", billing.id);
      const details = {
        nameAfter: after.name,
        cards: turn.approvals,
        categories: [before, await count()],
      };

      await api.req("PATCH", `/api/categories/${billing.id}`, { name: "Billing" });

      return {
        ok:
          after.name === "Payments" &&
          turn.approvals.length > 0 &&
          details.categories[0] === details.categories[1],
        details,
        turn,
      };
    },
  },
];
