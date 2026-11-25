excerpt: A practical checklist for moving from WordPress to a headless CMS, covering content models, migration scripts, redirects, editorial workflows, and launch checks.
seoTitle: WordPress to Headless: A Practical Migration Checklist
seoDescription: Plan a WordPress to headless migration with a practical checklist covering content audits, redirects, editorial previews, testing, and a safe launch.

Moving from [WordPress](https://wordpress.org) to a headless CMS is not just an export followed by a new frontend. The hard work is preserving the relationships, URLs, editorial habits, and integrations that make the existing site useful. I’m Daniel Whitlock, Solutions Architect at {{brand}}. This is the checklist I use to keep those decisions visible from discovery through launch. It assumes you want a separate frontend and content backend, but it does not assume every page or plugin deserves to move. The outcome should be a site editors can operate and visitors can navigate without noticing the machinery has changed.

## 1. Inventory what exists before choosing what moves

Start with evidence, not the current navigation menu. Export a list of published and draft content, then compare it with analytics, search performance, and the sitemap. Include custom post types, taxonomies, reusable blocks, media, forms, and content stored by plugins. A page can be absent from the menu and still receive valuable search traffic or support an important customer journey.

For each content type, identify its owner, volume, update frequency, and dependencies. Record whether it should migrate, be rewritten, be archived, or redirect to a suitable replacement. Have an editor and a stakeholder review that decision together: technical teams can spot dependencies, but they may not know why an old page still matters.

| Item | What to record | Migration decision |
| --- | --- | --- |
| Posts and pages | Status, author, dates, URL, traffic | Migrate, rewrite, archive, or redirect |
| Custom post types | Fields, relationships, templates | Model explicitly or retire |
| Media | File usage, captions, alt text, ownership | Copy, replace, or remove |
| Plugins | Data stored, integrations, editorial purpose | Rebuild, replace, or retire |
| Forms | Fields, recipients, consent, submissions | Reconnect and test separately |

Take a baseline of important URLs and page behavior before changing anything. Capture representative pages on desktop and mobile, including a complex article, a landing page, and a form. These become comparison points for acceptance testing, not an instruction to reproduce every old design choice.

If the target platform is still open, compare editorial requirements and operating costs against the options in our [open-source CMS roundup]({{site}}/blog/best-open-source-cms-2025/). A familiar admin interface is useful, but it should not outweigh missing workflow or data-model requirements.

## 2. Design the content model with editors

A headless model should describe content, not duplicate the old page templates field by field. Start with the pieces editors need to create and reuse: articles, people, categories, calls to action, and media assets, for example. Define required fields, validation rules, relationships, and ownership before writing import code.

### Separate content from presentation

A heading, summary, and image can be meaningful fields. A field named after a particular screen position may become a constraint when the design changes. Use structured components where they support reuse or validation, and rich text where editors genuinely need freedom. For each component, specify which variations are allowed and what the frontend should do when optional fields are empty.

Do not flatten relationships into text just because it makes the first import easier. An author reference should point to an author record; categories should remain identifiable even if their labels change. Preserve source IDs during migration so a rerun can update the right records.

### Agree on editorial acceptance criteria

Walk editors through a real task before building every content type. Ask them to create an article, add an image with alt text, preview it, request review, and publish it. Record the steps that require a developer or an undocumented workaround.

Decide who can create, review, publish, and unpublish content. If scheduled publishing, localization, or revision history matters, test those capabilities in the proposed setup rather than assuming a feature list covers the workflow. The model is ready when editors can explain how they will use it and the frontend team can render its supported states.

## 3. Choose the architecture and replace plugin responsibilities

With requirements in hand, decide which system owns each function. A common setup pairs [Payload](https://payloadcms.com) as the content backend with [Next.js](https://nextjs.org) as the frontend. That pairing is not mandatory: the right choice depends on hosting, team skills, editorial requirements, and the integrations that must survive.

Make an explicit decision for every important WordPress plugin. Some responsibilities belong in the CMS, some in the frontend, and some in a separate service. Search, form delivery, authentication, redirects, analytics, and image processing all need an owner. Document secrets, access controls, failure handling, and who receives operational alerts.

For teams evaluating Payload, our [partner program announcement]({{site}}/blog/payload-partner-program/) explains {{brand}}’s relationship with the platform. We also maintain {{short}} Starter, an open-source starter kit for Next.js and a headless CMS. Version 3.2 is installed with `npx create-headless-starter`. Treat a starter as a foundation to assess, not proof that your redirects, integrations, or editorial model are already complete.

Before committing, run a small technical spike. Render one representative content type, test authenticated preview, and confirm how published changes reach the frontend. Measure the time to build and deploy, and establish where logs and backups live. These checks expose operational constraints while changing direction is still relatively inexpensive.

## 4. Build a repeatable migration, not a one-off import

The migration should be safe to run in a test environment more than once. Keep extraction, transformation, and loading separate so you can inspect intermediate output and identify where a failure occurred. Store a source identifier on every imported record and use it to find existing target records on subsequent runs.

### Map deliberately and preserve evidence

The following TypeScript illustrates a small transformation, not a complete importer. Its input is assumed to have already been extracted and validated. The target field names are examples to adapt to your schema.

```ts
type SourcePost = {
  id: number;
  slug: string;
  status: string;
  date: string;
  title: { rendered: string };
  content: { rendered: string };
};

function mapPost(post: SourcePost) {
  return {
    sourceId: String(post.id),
    slug: post.slug,
    sourceStatus: post.status,
    publishedAt: post.date,
    titleHtml: post.title.rendered,
    bodyHtml: post.content.rendered,
  };
}
```

Rendered HTML is not automatically safe or suitable for a new rich-text editor. Decide how to sanitize it, convert supported blocks, and flag unsupported shortcodes or embedded content for review. Preserve the original source alongside the transformed output during testing so editors can compare the two. Do not render imported HTML blindly.

Use an ordered process:

1. Extract content, taxonomies, media references, and relevant metadata into a stable snapshot.
2. Validate required fields and report records that need editorial decisions.
3. Import independent records, such as authors and categories, before records that reference them.
4. Import content and media, then resolve relationships using the saved source IDs.
5. Compare counts and sample records; investigate failures rather than silently skipping them.
6. Rerun the import in a clean test environment and verify that updates do not create duplicates.

Plan for changes made after the snapshot. Depending on the site, that may mean a second incremental import or a short editorial freeze followed by a final export. Agree on the method with editors early; discovering a week before launch that drafts are still changing is avoidable.

## 5. Protect URLs, search signals, and accessibility

A headless rebuild can change routing, markup, image delivery, and metadata at once. Treat each as a migration risk. Produce a redirect map from the inventory, including old URLs that are no longer linked internally but still receive visits. Redirect retired pages to the closest relevant destination; do not send every missing page to the homepage.

This small check catches duplicate source paths and missing targets in a redirect dataset. It does not prove the deployed server actually redirects correctly, so follow it with HTTP checks in the target environment.

```ts
type Redirect = { from: string; to: string };

function validateRedirects(rows: Redirect[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.from)) errors.push(`Duplicate: ${row.from}`);
    if (!row.to) errors.push(`Missing target: ${row.from}`);
    seen.add(row.from);
  }

  return errors;
}
```

Check canonical URLs, page titles, descriptions, structured data where used, sitemaps, and indexing controls. Compare the rendered page with the old baseline: content that exists in the CMS but is missing from the rendered output is still a problem for visitors and search engines.

For multilingual or regional sites, record language variants and their relationships rather than inferring them from slugs. Our work as a [headless CMS agency in Germany]({{site}}/headless-cms-agency-germany/) sits alongside our Amsterdam and Berlin offices; location-specific requirements should still be checked for each project.

Test keyboard navigation, heading order, focus states, form errors, captions, and image alternatives. Automated accessibility checks are useful, but they do not replace a person completing important journeys with a keyboard and assistive technology.

## 6. Rehearse launch and give editors a safe handover

A launch plan needs named owners, a timeline, and a decision point. Rehearse the final import, deployment, redirect checks, and rollback in an environment that resembles production. Record how long each step takes and what evidence is needed before the team approves the switch.

> **Practical tip:** Give editors a short list of representative pages to approve after the final import, including one with embedded media, one with relationships, and one with a complex layout.

Keep the pre-launch checklist specific:

- Confirm the content freeze or incremental import window and tell editors when publishing resumes.
- Back up the source and target data, and verify who can restore each system.
- Test forms, search, previews, permissions, redirects, analytics, and important journeys on the deployed site.
- Check logs, indexing controls, and a sample of high-value pages immediately after the switch.
- Assign owners to monitor errors and correct content during the first days after launch.

A rollback is more than redeploying the old frontend. Decide what happens to content created in the new CMS after launch and whether it must be copied back before reverting. Set the conditions for rollback in advance so the team does not have to negotiate them during an incident.

Finally, hand over the operating model: publishing instructions, support contacts, integration ownership, backup procedures, and known limitations. Editorial speed is an outcome worth testing, as the [Fjordline Ferries case study]({{site}}/case-studies/fjordline-ferries/) illustrates through its focus on timetables editors can update in minutes. The migration is complete when the team can maintain the site, not merely when the new homepage is live.

## FAQ

### Can we keep WordPress and still go headless?

Yes. WordPress can remain the content backend while a separate frontend consumes its data. That may reduce the amount of content administration you need to replace, but you still need to assess previews, authentication, plugin-provided data, caching, and the operational cost of maintaining both systems.

### How long should editors stop publishing?

There is no universal freeze period. Determine it by rehearsing the final export, import, validation, and deployment. An incremental migration can reduce the freeze, but only if you can reliably identify and transfer every change made after the initial snapshot.

### Should we migrate every draft and media file?

Not necessarily. Ask content owners which drafts remain useful and check whether media files are referenced or needed for legal, editorial, or operational reasons. Archive or remove items only after agreeing on retention requirements and keeping an appropriate backup.

### What should we measure after launch?

Monitor errors, redirect behavior, indexing, important page traffic, form submissions, and performance against the pre-launch baseline. Also ask editors whether they can complete routine tasks without developer help. Assign owners to investigate changes rather than treating a dashboard alone as proof of success.
