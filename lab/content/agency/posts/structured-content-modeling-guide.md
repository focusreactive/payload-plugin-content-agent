excerpt: A practical approach to modeling content for a headless CMS, from choosing content types and relationships to testing how editors and channels use them.
seoTitle: Content Modeling for a Headless CMS: A Practical Guide
seoDescription: Learn how to structure content types, relationships, localization and validation in a headless CMS, with examples and a practical modeling workflow.

A headless CMS separates content management from presentation, but that separation only pays off when the content is structured well. A useful model helps editors understand what to enter and gives applications predictable data to display. In this guide, Ines Okafor, Content Strategist at {{brand}}, explains how to move from real publishing needs to a model you can test, maintain and change.

## Start with content and decisions

Before defining fields, collect examples of what the organization publishes and where that content appears. Include finished pages, but also look at the material behind them: article summaries, event details, product descriptions, images and translations. A page is often a combination of several pieces of content rather than a single reusable unit.

For example, an announcement about [our Berlin office opening]({{site}}/blog/berlin-office-opening/) has a title and body, but it may also have a summary for an article listing and an image with context-specific alternative text. Those uses are clues for the model. They are not proof that every visual element needs its own content type.

Ask the people who create, approve and use the content:

- Which information must be entered for every item, and which is genuinely optional?
- Where does the same information appear in more than one place?
- Who is responsible for keeping each piece accurate?
- Which channels and languages need the content now?

Document the answers alongside a few representative examples. Note exceptions rather than designing around every possible future use. A model for ten article formats can still begin with one article type if their differences are mostly presentational.

The CMS influences how you implement the model. [Sanity](https://www.sanity.io) defines schemas in code, [Payload](https://payloadcms.com) uses a code-first approach to configuration, and [Contentful](https://www.contentful.com) provides content modeling through its interface and APIs. Compare their capabilities against your requirements before committing to a design.

## Define types and fields

A content type describes a recurring kind of thing, not necessarily a page template. Start with nouns that have a clear purpose and a reason to exist independently. An article can have its own publishing lifecycle; a heading within that article usually does not.

### Choose a small set of types

For an editorial site, a first pass might look like this:

| Type | Purpose | Example fields | Typical relationship |
| --- | --- | --- | --- |
| Article | A publishable editorial item | Title, slug, summary, body | References an author |
| Person | Information about a contributor | Name, role, biography | Referenced by articles |
| Topic | A way to group related content | Name, slug, description | Referenced by articles |
| Image | A reusable media asset | File, dimensions, credit | Used with context-specific alt text |
| Landing page | A curated entry point | Title, introduction, sections | References selected content |

This is a starting point, not a universal schema. A landing page may need editorial curation while an article listing is generated from topics. Decide which behavior is required before adding fields for it.

### Make each field earn its place

For every field, specify its meaning, format, required status and intended uses. A summary, for example, might be required for listing cards and optional elsewhere. Give editors guidance on what it should communicate, rather than relying only on a character limit.

Keep meaning separate from display. A field named “card text” assumes a particular interface; “summary” can also serve a search result or social preview. Conversely, do not combine distinct facts into a single rich-text field merely because they sit close together on a page.

When planning [a bilingual university site]({{site}}/case-studies/campus-nord/), the distinction matters: a course title, its language and a translated description need clear roles even if a page displays them as one unit.

## Model relationships and boundaries

A reference connects one item to another without copying its contents. Use one when the referenced item has its own identity, is maintained independently or needs to appear in multiple places. An author profile is a good candidate: correcting a person’s role should not require editing every article.

Embedding is often better for content that belongs only to its parent. A short section heading and paragraph within an article may never need to be found or published on their own. Keeping them together makes the editing task simpler and avoids filling the CMS with fragments that have no clear owner.

For each relationship, decide whether it is optional or required, whether it accepts one item or several, and who controls the order. Also decide what happens when a referenced item is unpublished or deleted. An application should handle a missing reference deliberately, rather than failing when it tries to render a page.

Avoid references solely to eliminate every repeated word. Two articles can each have a different summary even if their subject is similar. Reuse is valuable when the same fact should remain consistent, not when it forces editors to share wording that serves different purposes.

> Practical tip: Ask an editor to explain what would happen if they changed a shared item. If the answer is unclear, label the relationship and its consequences in the editing interface.

## Design for channels and languages

### Store meaning before presentation

A headless model may feed a website, an app and other interfaces. Those channels do not necessarily need the same layout or the same amount of text. Store a title, summary and body as meaningful fields, then let each channel decide how to present them.

This does not mean banning all layout choices. Editors may need to order sections or choose a featured item. The distinction is between an editorial decision that carries meaning and a visual detail that belongs to a particular implementation. A reusable content model should not require an email client to understand a website’s grid settings.

In [headless ecommerce]({{site}}/headless-ecommerce/), for instance, product information may be displayed alongside editorial content. Establish which system owns prices, availability and product identifiers before copying those values into the CMS. If another system is authoritative, define how the application retrieves and handles that information.

### Plan localization explicitly

Decide which fields need translation, which are shared and whether each language is published independently. A product identifier might remain the same across locales, while a title, description and slug need localized values.

Also define fallback behavior. If a translation is missing, should a visitor see a default-language version, a notice or no page? The right answer depends on the content and audience. Make the rule visible to editors and implement it consistently across channels.

Test the model with languages that differ in length and structure. A field limit that works for one language may truncate another, and a slug strategy should account for the routing rules of each locale.

## Validate the model with real examples

A diagram is useful, but entering and consuming content reveals problems that diagrams miss. Take a representative article from the inventory and create a draft using the proposed fields. Then ask a developer to render a listing and a detail view from it.

The following TypeScript describes a small, CMS-independent shape. It is an application contract, not a schema for a particular product:

```ts
type TextSection = {
  heading: string;
  text: string;
};

type Article = {
  id: string;
  locale: string;
  title: string;
  slug: string;
  summary: string;
  authorId: string;
  sections: TextSection[];
};
```

A draft that satisfies that shape could look like this:

```json
{
  "id": "article-open-day",
  "locale": "en",
  "title": "Planning an open day",
  "slug": "planning-an-open-day",
  "summary": "How to prepare for a visit and make the most of it.",
  "authorId": "person-editor",
  "sections": [
    {
      "heading": "Before you arrive",
      "text": "Make a list of the questions you want to ask."
    }
  ]
}
```

The example exposes decisions to resolve: whether an article must have an author, whether sections can be reordered, and whether the slug must be unique within a locale. TypeScript alone does not enforce editorial rules in the CMS or guarantee that an API response matches the type. Add validation at the appropriate boundaries and test the actual response.

If you use {{short}} Starter, the open source starter kit for Next.js and a headless CMS, version 3.2 can be installed with `npx create-headless-starter`. Consult the [configuration reference]({{site}}/docs/reference/configuration/) when adapting the starter to a project; keep your content decisions separate from assumptions about its defaults.

## Govern and evolve the model

A model is a shared agreement, not a one-off developer deliverable. Record the purpose of each type, the rules for its fields and the owner responsible for changes. Include examples of good entries and explain where shared content appears. This documentation is most useful when editors can find it while doing their work.

Use a repeatable process before releasing a change:

1. Identify the publishing problem and collect examples of affected content.
2. Propose the smallest change that solves it, including field rules and ownership.
3. Test the change with editors and with each application that consumes the content.
4. Plan how existing entries will be migrated, reviewed or left unchanged.
5. Release the change, monitor its effects and update the documentation.

Adding a required field to an established type can make existing entries incomplete. Renaming or removing a field can also break consumers that expect the old shape. Inventory those dependencies, coordinate the migration and allow for a transition where necessary.

Review the model after editors have used it for a while. Empty fields may indicate unnecessary complexity, unclear guidance or a legitimate optional use. Repeated workarounds can reveal a missing type or relationship. Investigate the reason before changing the schema: the problem may be the interface or the workflow rather than the underlying model.

## FAQ

### What is a content model in a headless CMS?

A content model defines the types of content an organization manages, their fields and the relationships between them. It gives editors a structure for creating content and gives applications a predictable way to retrieve and use it.

### Should every page have its own content type?

No. Pages with the same editorial purpose can often share a type even when they look different. Create a separate type when the content has meaningfully different fields, validation, ownership or publishing requirements, not simply because it uses a different layout.

### How much content should be reusable?

Reuse content when it represents the same information and should be maintained in one place. Keep content local when its meaning depends on a particular context or when editors need to change it independently. The goal is reliable reuse, not the maximum number of references.

### When should a content model change?

Change it when evidence shows that it no longer supports publishing or consumption needs. Before making the change, check affected entries and applications, plan any migration, and test the revised workflow with the people who maintain the content.
