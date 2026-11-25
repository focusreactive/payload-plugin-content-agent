excerpt: Plan a headless CMS migration that preserves content, relationships, URLs, and editorial workflows while giving your team a safe route to launch.

seoTitle: A practical guide to migrating your headless CMS safely
seoDescription: Learn how to map content, move assets, validate pages, and plan a reversible cutover when changing the CMS behind an existing website.

Moving from [Sanity](https://www.sanity.io) to [Payload](https://payloadcms.com) is more than an export and import. You need to translate document types, references, assets, and publishing rules while keeping the website usable for editors and visitors. This guide walks through a staged migration, from inventory to cutover, with a small import example you can adapt to your own schemas.

By Daniel Whitlock, Solutions Architect at {{brand}}.

## Start with an inventory and a migration boundary

Before writing a script, agree on what the new system must contain on launch day. Export a list of Sanity document types and count published documents, drafts, assets, and references. Record which fields are required, which are localized, and which are populated by integrations rather than editors.

Include the frontend in the inventory. A schema may contain fields that no page uses, while a page may rely on a GROQ query, image transformation, or preview behavior that is not obvious from the schema alone. Trace each important page template back to its query and document types.

Set a clear boundary for historical content. You might migrate all published articles but archive obsolete campaign pages separately. Get an editorial owner to approve exclusions; deleting unused-looking content without checking can break old links or remove material needed for compliance.

Also confirm that Payload fits the intended hosting and operating model. It runs in your own application environment, so the team needs a plan for the database, file storage, deployments, secrets, and backups. If you are still evaluating CMS options, our [comparison of Payload and Strapi]({{site}}/blog/payload-vs-strapi/) covers some of those trade-offs.

A useful inventory includes:

- Document types, counts, and owners.
- Published and draft states, including scheduled work.
- References, reusable objects, and localized fields.
- Asset types, storage requirements, and image metadata.
- Routes, redirects, previews, and external integrations.

## Design the target content model

Create the Payload collections and globals before importing production content. A collection is appropriate for repeatable records such as articles; a global can hold a singleton such as site navigation. Match editorial intent rather than copying every Sanity field mechanically.

| Sanity source | Payload target | Decision to make |
|---|---|---|
| Document type | Collection or global | Is this repeatable content or a singleton? |
| Document reference | Relationship field | Which collection does it point to, and can it have multiple values? |
| Portable Text | Rich text field or structured blocks | How will marks, embedded objects, and links be represented? |
| Image or file asset | Upload collection | Which metadata and crop information must survive? |
| Language-specific value | Localized field or separate record | How will missing translations and fallback work? |
| Slug | Text or slug field | Must the existing public path remain unchanged? |

### Preserve identity and relationships

Give each migrated record a `legacyId` field containing its Sanity document ID. Make it unique in Payload. This gives import scripts a stable lookup key and lets you rerun them without relying on a title or slug that an editor may change.

References need a separate plan. A Sanity reference stores a document ID, but a Payload relationship must point to an ID in the target collection. Import records first, build a mapping from legacy IDs to Payload IDs, then resolve relationships in a second pass. Report missing targets rather than silently dropping links.

### Decide how rich text and localization work

Portable Text is structured data, not HTML. Map its blocks, spans, marks, and embedded objects to the rich text format configured in Payload. Test links, lists, headings, inline annotations, and custom embeds individually. A plain-text conversion may be acceptable for a limited field, but it is not a lossless migration.

For multilingual sites, document the source and target locale codes and the fallback behavior for every field. Decide whether an untranslated value remains empty or inherits another locale. For a broader view of the content-model decisions involved, see [how Verdan Health brought six languages onto one platform]({{site}}/case-studies/verdan-health/).

## Export content and assets

Take an export from the intended Sanity dataset and store it securely. The Sanity CLI can export documents and assets together; the dataset name below is an example and should match your project:

```bash
npx sanity dataset export production ./sanity-export.tar.gz
```

Keep the original archive unchanged. Extract a working copy in a restricted environment, identify the NDJSON document file, and make a separate list of referenced assets. If your dataset is large, check available disk space before extracting it and avoid placing the archive in a public web directory.

Sanity draft IDs use the `drafts.` prefix. A published document and its draft can therefore appear as separate records in an export. Decide whether to migrate the latest draft, the published version, or both into a Payload collection configured for drafts and versions. Do not treat them as unrelated articles.

Assets deserve their own reconciliation. For each referenced file, record its source ID, filename, MIME type, and relevant metadata. Transfer the binary into a Payload upload collection, then replace source asset references with the new upload IDs. Preserve alt text where it is stored in content, not just metadata on the asset itself. Check image crops and hotspots too: the frontend may need equivalent transformations rather than a simple file copy.

> **Practical tip:** Run the first export and import on a representative subset containing a draft, a translation, an embedded object, and an image with a crop. Fix the mapping before processing the full dataset.

## Import in repeatable passes

Build the importer for the target schema, not the other way around. The following example handles only published Sanity `post` documents with a title and slug. It assumes a Payload `articles` collection with required `title` and `slug` text fields, plus a unique `legacyId` text field. It deliberately does not migrate bodies, assets, drafts, or relationships.

Run it against a staging environment from a Payload project where `@payload-config` resolves and `tsx` is available. Place the extracted document file at the path shown, and ensure that its records are safe to import under the target collection’s publishing configuration.

```ts
import { readFile } from 'node:fs/promises'
import { getPayload } from 'payload'
import config from '@payload-config'

type SanityPost = {
  _id: string
  _type: string
  title?: string
  slug?: { current?: string }
}

async function main() {
  const payload = await getPayload({ config })
  const input = await readFile('./export/production.ndjson', 'utf8')
  const lines = input.split('\n').filter((line) => line.trim())

  for (const line of lines) {
    const doc = JSON.parse(line) as SanityPost
    if (doc._type !== 'post' || doc._id.startsWith('drafts.')) continue

    if (!doc.title || !doc.slug?.current) {
      throw new Error(`Missing title or slug for ${doc._id}`)
    }

    const data = {
      legacyId: doc._id,
      title: doc.title,
      slug: doc.slug.current,
    }
    const existing = await payload.find({
      collection: 'articles',
      where: { legacyId: { equals: doc._id } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    if (existing.docs[0]) {
      await payload.update({
        collection: 'articles',
        id: existing.docs[0].id,
        data,
        overrideAccess: true,
      })
    } else {
      await payload.create({
        collection: 'articles',
        data,
        overrideAccess: true,
      })
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
```

The lookup makes this small pass repeatable, but it is not a complete migration framework. It stops on the first malformed record, reads the file into memory, and assumes no concurrent imports. For a large dataset, stream the input, log failures with source IDs, and reconcile counts after every run.

Add separate passes for uploads, rich text, and relationships. Do not run an update pass over records that editors have already changed in Payload unless you have agreed which system is authoritative. Local API calls with access overridden are privileged; keep the script and its credentials in a controlled environment.

## Validate content and the website

A successful script proves that records were written, not that the site works. Compare source and target counts by type, locale, and publishing state. Investigate every difference, including intentionally excluded records. Check for missing required fields, duplicate slugs, unresolved references, and assets that exist in the database but cannot be served.

Give editors a sample set to review in the Payload admin. Include complex pages, not only the newest articles. Ask them to open previews, edit a relationship, replace an image, and verify that their roles grant the intended access. Test publishing and unpublishing in staging without exposing unfinished content publicly.

Then compare rendered pages. Check headings, links, images, structured data, canonical URLs, and metadata against the existing site. Confirm that old paths either remain valid or have intentional redirects to the closest relevant destination. Our [headless SEO checks]({{site}}/blog/headless-seo-technical-checklist/) provide a useful launch review for these frontend details.

Measure performance on representative pages before and after the change, using the same test conditions where possible. CMS choice alone does not determine page speed: queries, caching, image delivery, and frontend code all matter. Use the [2026 headless performance findings]({{site}}/blog/headless-performance-benchmark-2026/) as context, not as a substitute for testing your own deployment.

## Plan the cutover and rollback

Write down the sequence, owners, and decision points before launch. Rehearse it on staging, including the time needed for the final data transfer and cache refresh. A straightforward cutover can follow these steps:

1. **Freeze source edits.** Tell editors when Sanity becomes read-only and record any scheduled publishing that needs special handling.
2. **Take a final export.** Back it up and run the agreed import passes, including assets and relationship resolution.
3. **Reconcile changes.** Compare counts and review failures, then confirm that the latest approved content is present.
4. **Switch the application.** Deploy the frontend and configuration that read from Payload, with production secrets and storage settings in place.
5. **Verify public pages.** Test critical routes, redirects, images, forms, previews, and publishing with the responsible owners.
6. **Release the editorial freeze.** Allow changes in Payload only after the team agrees that the launch checks have passed.

Keep the previous application deployment and the Sanity dataset available for the agreed rollback window. Define who can call a rollback and what conditions trigger it. Switching the frontend back is only part of the work: once editors publish changes in Payload, those changes will not automatically exist in Sanity. Either keep editing frozen until confidence is high or document how to capture and replay changes if you revert.

After launch, monitor failed requests, missing assets, redirect errors, and publishing issues. Close the migration only when editorial owners have signed off and the team has confirmed backup and restore procedures for the new environment.

## FAQ

### Can I migrate Sanity drafts to Payload?

Yes, but model draft behavior first. Sanity draft documents use a separate ID prefix, while Payload can use drafts and versions when configured for the collection. Decide how each draft relates to its published document, then test preview and publication without making unfinished content public.

### Will my existing URLs stay the same?

They can, if you preserve the fields and routing rules that produce them. Compare a full route inventory before launch. Where a path must change, create and test a redirect to the relevant new page rather than sending every old URL to the homepage.

### Do I need to convert Portable Text to HTML?

Not necessarily. Payload’s configured rich text representation may be a better target because it remains editable and structured. Map Portable Text blocks and annotations explicitly, including custom objects. Use HTML or plain text only when the loss of structure is acceptable for that field.

### How should I handle edits made during migration?

Choose one authoritative CMS for each phase. Import test data while Sanity remains live, then freeze source edits for the final export and reconciliation. Once Payload becomes authoritative, avoid rerunning an old import over editorial changes. If a freeze is impractical, design and test a change-capture process before launch.
