import { paragraphs, same } from "../lib/lexical.mjs";

const page = (ref) => ({ collection: ref.collection, documentId: String(ref.id) });
const variants = (doc) =>
  (doc.variants ?? []).map(({ sku, color, stock }) => ({ sku, color, stock }));
const except = (doc, keys) =>
  Object.fromEntries(
    Object.entries(doc).filter(([k]) => !keys.includes(k) && !["updatedAt", "_status"].includes(k))
  );
const grid = (doc) => doc.sections.find((b) => b.blockType === "productGrid");
const banner = (doc) => doc.sections.find((b) => b.blockType === "banner");

export default [
  {
    id: "number-field",
    title: "Change a number",
    uses: ["pack"],
    async run({ docs, read, send }) {
      const before = await read("pack");
      const turn = await send("Change the price of this product to 159. Change nothing else.", {
        pageContext: page(docs.pack),
      });
      const after = await read("pack");

      return {
        ok: after.price === 159 && same(except(before, ["price"]), except(after, ["price"])),
        details: { price: after.price },
        turn,
      };
    },
  },
  {
    id: "array-row-number",
    title: "Change one value in one array row",
    uses: ["pack"],
    async run({ docs, read, send }) {
      const before = await read("pack");
      const turn = await send("Set the stock of the sand variant to 12. Change nothing else.", {
        pageContext: page(docs.pack),
      });
      const after = await read("pack");
      const expected = variants(before).map((v) => (v.color === "sand" ? { ...v, stock: 12 } : v));

      return {
        ok:
          same(variants(after), expected) &&
          after.price === before.price &&
          same(before.description, after.description),
        details: { variants: variants(after) },
        turn,
      };
    },
  },
  {
    id: "select-field",
    title: "Change a select to one of its options",
    uses: ["pack"],
    async run({ docs, read, send }) {
      const before = await read("pack");
      const turn = await send("Mark this product as retired. Change nothing else.", {
        pageContext: page(docs.pack),
      });
      const after = await read("pack");

      return {
        ok:
          after.availability === "retired" &&
          same(except(before, ["availability"]), except(after, ["availability"])),
        details: { availability: after.availability },
        turn,
      };
    },
  },
  {
    id: "relationship-replace",
    title: "Point a relationship at another document",
    uses: ["tote"],
    async run({ docs, read, send }) {
      const before = await read("tote");
      const fjell = (await read("pack")).brand;
      const turn = await send("Change the brand of this product to Fjell. Change nothing else.", {
        pageContext: page(docs.tote),
      });
      const after = await read("tote");

      return {
        ok: after.brand === fjell && same(except(before, ["brand"]), except(after, ["brand"])),
        details: { brandBefore: before.brand, brandAfter: after.brand, fjell },
        turn,
      };
    },
  },
  {
    id: "block-relationship-add",
    title: "Add a reference to a block that lists documents",
    uses: ["landing"],
    async run({ docs, read, send }) {
      const before = await read("landing");
      const turn = await send(
        'Add the product "Market Tote" to the end of the product grid on this page. Keep the other products.',
        { pageContext: page(docs.landing) }
      );
      const after = await read("landing");
      const details = {
        products: grid(after)?.products,
        bannerUnchanged: same(banner(before), banner(after)),
      };

      return {
        ok:
          same(grid(after)?.products, [...grid(before).products, docs.tote.id]) &&
          details.bannerUnchanged &&
          grid(after).title === grid(before).title,
        details,
        turn,
      };
    },
  },
  {
    id: "rich-text-append",
    title: "Add a paragraph to the end of a rich text field",
    uses: ["pack"],
    async run({ docs, read, send }) {
      const before = await read("pack");
      const sentence = "It fits a 15-inch laptop.";
      const turn = await send(
        `Add a third paragraph to the end of the description: "${sentence}" Keep the first two paragraphs as they are.`,
        { pageContext: page(docs.pack) }
      );
      const after = await read("pack");
      const details = { paragraphs: paragraphs(after.description) };

      return {
        ok:
          same(paragraphs(after.description), [...paragraphs(before.description), sentence]) &&
          after.price === before.price &&
          same(variants(before), variants(after)),
        details,
        turn,
      };
    },
  },
  {
    id: "count-question",
    title: "A question across collections that must not change anything",
    uses: ["pack", "shell", "tote"],
    async run({ api, read, send }) {
      const before = await Promise.all(["pack", "shell", "tote"].map((n) => read(n)));
      const turn = await send(
        "Which products does the brand Fjell have? List their names. Do not change anything."
      );
      const after = await Promise.all(["pack", "shell", "tote"].map((n) => read(n)));
      const refs = (await api.changes(turn.conversationId)).refs ?? [];
      const details = {
        namesFjell:
          turn.text.includes("Ridge 28 Backpack") && turn.text.includes("Squall Rain Shell"),
        leavesOutTheOtherBrand: !turn.text.includes("Market Tote"),
        unchanged: same(before, after),
        changes: refs.length,
      };

      return {
        ok:
          details.namesFjell &&
          details.leavesOutTheOtherBrand &&
          details.unchanged &&
          refs.length === 0,
        details,
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
      const review = (await api.find("reviews", "limit=1")).docs[0];
      const rating = review.rating === 4 ? 3 : 4;
      const turn = await send(`Change the rating of the review "${review.title}" to ${rating}.`);
      const after = await api.getDoc("reviews", review.id);
      const { rating: _before, updatedAt: _b, ...restBefore } = review;
      const { rating: _after, updatedAt: _a, ...restAfter } = after;
      const details = {
        ratingAfter: after.rating,
        cards: turn.approvals,
        restUnchanged: JSON.stringify(restBefore) === JSON.stringify(restAfter),
      };

      await api.req("PATCH", `/api/reviews/${review.id}`, { rating: review.rating });

      return {
        ok: after.rating === rating && turn.approvals.length > 0 && details.restUnchanged,
        details,
        turn,
      };
    },
  },
];
