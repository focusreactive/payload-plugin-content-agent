// Many collections, to show how the tool list grows with the schema, and structured data the other schemas lack.
import type { Block, CollectionConfig, GlobalConfig } from "payload";
import { creator, p, richText } from "../seedHelpers";
import type { LabSchema } from "./types";

const drafts = { versions: { drafts: true } };
const simple = (slug: string, textField: string, withDrafts = true): CollectionConfig => ({
  slug,
  admin: { useAsTitle: "name" },
  ...(withDrafts ? drafts : {}),
  fields: [
    { name: "name", type: "text", required: true },
    { name: textField, type: "textarea" },
  ],
});

const Brands = simple("brands", "story");
const Categories = simple("categories", "description");
const Materials = simple("materials", "care");
const Stores = simple("stores", "address");
const Promotions = simple("promotions", "terms");
const SizeGuides = simple("size-guides", "notes");
const Policies = simple("policies", "text");
const Faqs: CollectionConfig = {
  slug: "faqs",
  admin: { useAsTitle: "question" },
  ...drafts,
  fields: [
    { name: "question", type: "text", required: true },
    { name: "answer", type: "textarea", required: true },
  ],
};
const Reviews: CollectionConfig = {
  slug: "reviews",
  admin: { useAsTitle: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "rating", type: "number", min: 1, max: 5, required: true },
    { name: "text", type: "textarea" },
    { name: "product", type: "relationship", relationTo: "products" },
  ],
};
const Products: CollectionConfig = {
  slug: "products",
  admin: { useAsTitle: "name" },
  ...drafts,
  fields: [
    { name: "name", type: "text", required: true },
    { name: "sku", type: "text", required: true, unique: true },
    { name: "price", type: "number", required: true },
    {
      name: "availability",
      type: "select",
      options: ["available", "preorder", "retired"],
      defaultValue: "available",
    },
    { name: "description", type: "richText" },
    { name: "brand", type: "relationship", relationTo: "brands" },
    { name: "categories", type: "relationship", relationTo: "categories", hasMany: true },
    {
      name: "variants",
      type: "array",
      fields: [
        { name: "sku", type: "text", required: true },
        {
          name: "color",
          type: "select",
          options: ["black", "sand", "forest", "rust"],
          required: true,
        },
        { name: "stock", type: "number", required: true },
      ],
    },
  ],
};
const Banner: Block = {
  slug: "banner",
  fields: [
    { name: "headline", type: "text", required: true },
    { name: "text", type: "textarea" },
  ],
};
const ProductGrid: Block = {
  slug: "productGrid",
  fields: [
    { name: "title", type: "text" },
    { name: "products", type: "relationship", relationTo: "products", hasMany: true },
  ],
};
const LandingPages: CollectionConfig = {
  slug: "landing-pages",
  admin: { useAsTitle: "title" },
  ...drafts,
  fields: [
    { name: "title", type: "text", required: true },
    { name: "slug", type: "text", required: true },
    { name: "sections", type: "blocks", blocks: [Banner, ProductGrid] },
  ],
};
const Header: GlobalConfig = {
  slug: "header",
  ...drafts,
  fields: [{ name: "announcement", type: "text" }],
};

export const shop: LabSchema = {
  name: "shop",
  collections: [
    Products,
    Brands,
    Categories,
    Materials,
    Reviews,
    Faqs,
    Stores,
    Promotions,
    SizeGuides,
    Policies,
    LandingPages,
  ],
  globals: [Header],
  async seed(payload) {
    const create = creator(payload);
    const brand = await create("brands", {
      name: "Fjell",
      story: "Outdoor gear made for wet weather.",
    });
    const brandB = await create("brands", {
      name: "Loam",
      story: "Everyday bags from recycled fabric.",
    });
    const bags = await create("categories", { name: "Bags", description: "Backpacks and totes." });
    const jackets = await create("categories", {
      name: "Jackets",
      description: "Shells and insulated jackets.",
    });

    const pack = await create("products", {
      name: "Ridge 28 Backpack",
      sku: "RDG-28",
      price: 149,
      availability: "available",
      brand: brand.id,
      categories: [bags.id],
      description: richText(
        p("The Ridge 28 carries a day of gear and keeps it dry."),
        p("The back panel is padded and the hip belt comes off for city use.")
      ),
      variants: [
        { sku: "RDG-28-BLK", color: "black", stock: 14 },
        { sku: "RDG-28-SND", color: "sand", stock: 3 },
        { sku: "RDG-28-FOR", color: "forest", stock: 0 },
      ],
    });
    const shell = await create("products", {
      name: "Squall Rain Shell",
      sku: "SQL-01",
      price: 219,
      availability: "available",
      brand: brand.id,
      categories: [jackets.id],
      description: richText(
        p("A light shell with taped seams."),
        p("It packs into its own pocket.")
      ),
      variants: [
        { sku: "SQL-01-BLK", color: "black", stock: 8 },
        { sku: "SQL-01-RST", color: "rust", stock: 5 },
      ],
    });
    const tote = await create("products", {
      name: "Market Tote",
      sku: "MKT-10",
      price: 59,
      availability: "preorder",
      brand: brandB.id,
      categories: [bags.id],
      description: richText(p("A wide tote for the weekly shop.")),
      variants: [{ sku: "MKT-10-SND", color: "sand", stock: 0 }],
    });

    await create("reviews", {
      title: "Dry after a full day of rain",
      rating: 5,
      text: "Wore it for eight hours in the hills.",
      product: shell.id,
    });
    const faq = await create("faqs", {
      question: "How long does delivery take?",
      answer: "Three to five working days inside the country.",
    });

    await create("policies", {
      name: "Returns",
      text: "You can return an unused item within 30 days.",
    });
    const landing = await create("landing-pages", {
      title: "Autumn Gear",
      slug: "autumn-gear",
      sections: [
        {
          blockType: "banner",
          headline: "Ready for the wet season",
          text: "Shells and packs that keep the rain out.",
        },
        { blockType: "productGrid", title: "Our picks", products: [pack.id, shell.id] },
      ],
    });

    await payload.updateGlobal({
      slug: "header" as never,
      data: { announcement: "Free delivery over 100", _status: "published" } as never,
    });

    return {
      documents: {
        pack: { collection: "products", id: pack.id },
        shell: { collection: "products", id: shell.id },
        tote: { collection: "products", id: tote.id },
        loam: { collection: "brands", id: brandB.id },
        faq: { collection: "faqs", id: faq.id },
        landing: { collection: "landing-pages", id: landing.id },
      },
    };
  },
};
