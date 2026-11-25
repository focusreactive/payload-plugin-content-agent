{{short}} Starter uses locale-prefixed routes to serve content in multiple languages from one project. [Payload](https://payloadcms.com) stores the localized content, and the [Next.js](https://nextjs.org) App Router selects the locale from the URL. This guide sets up English and French pages, with English as the fallback when a localized block field has no value.

## Configure locales

Create a project with the starter CLI, then open `starter.config.ts` at the project root. The starter uses this file to configure Payload localization and its locale-aware routing helpers.

```bash
npx create-headless-starter my-site
cd my-site
npm run generate:types
npm run dev
```

Replace the localization settings in `starter.config.ts` with:

```ts
import { defineStarterConfig } from './src/starter/config'

export default defineStarterConfig({
  localization: {
    locales: [
      { code: 'en', label: 'English' },
      { code: 'fr', label: 'French' },
    ],
    defaultLocale: 'en',
    fallback: true,
  },
})
```

Run `npm run generate:types` again after changing the locale list. The command regenerates Payload types used by the routing helpers and content queries. Restart the development server so it picks up the new configuration.

The starter applies these settings when it builds the Payload configuration. Keep locale codes stable once editors have started entering content: changing a code does not migrate existing localized values.

| Option | Purpose | Example |
| --- | --- | --- |
| `locales` | Languages available in the admin and on the site | `en` and `fr` |
| `code` | Locale identifier used in URLs and queries | `fr` |
| `label` | Name shown to editors in the admin | `French` |
| `defaultLocale` | Locale used as the default for content operations | `en` |
| `fallback` | Allows missing localized values to fall back to the default locale | `true` |

## How pages and blocks are localized

The starter’s `pages` collection has a shared `path` field and a localized `layout` field. The path identifies the same page in every language; the layout contains the page’s blocks. For example, `/en/about` and `/fr/about` both query the page whose path is `/about`.

Because `layout` is localized, editors manage a separate block array for each locale. They can change block order, add blocks, or remove blocks in French without changing the English layout. Block definitions live in `src/blocks/`; their fields belong to the localized layout rather than needing individual localization settings.

This approach also means a translation is not automatically synchronized when the source layout changes. Review the other locales after adding a block to an existing page. The [directory layout]({{site}}/docs/getting-started/project-structure/) explains where the collection and block renderers live.

> **Note:** Fallback supplies the English layout when the requested localized layout has no value. It does not translate text or merge individual blocks from the two layouts.

## Route requests by locale

The starter places its page route at `src/app/(frontend)/[locale]/[[...slug]]/page.tsx`. The optional catch-all segment handles both the locale home page and nested paths. A locale helper validates the URL before the query runs.

The route follows this pattern:

```tsx
import config from '@payload-config'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import { RenderBlocks } from '@/blocks/RenderBlocks'
import { isStarterLocale } from '@/starter/locales'

type Props = {
  params: Promise<{ locale: string; slug?: string[] }>
}

export default async function Page({ params }: Props) {
  const { locale, slug } = await params

  if (!isStarterLocale(locale)) notFound()

  const path = slug?.length ? `/${slug.join('/')}` : '/'
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'pages',
    where: { path: { equals: path } },
    locale,
    fallbackLocale: 'en',
    draft: false,
    limit: 1,
  })

  const page = result.docs[0]
  if (!page) notFound()

  return <RenderBlocks blocks={page.layout ?? []} />
}
```

The explicit `fallbackLocale` makes the query’s fallback clear. If you change the default locale, update this value as well. An unsupported locale or an unknown page path returns a 404. A known path with a missing French layout can still render the English layout through fallback.

## Add and check a translation

1. In the Payload admin, create a page with the path `/about`. Add and publish its English layout.
2. Switch the admin locale to French. Add the French blocks and save the page.
3. Publish the page after checking the translated layout. Saving a draft alone does not make it available to the public query above.
4. Visit `/en/about` and `/fr/about`. Check the text, block order, links, and any locale-specific media.
5. Test a page without a French layout to confirm that the English fallback is acceptable.

The shared path must begin with `/` and must not include a locale prefix. Use `/` for the home page. This starter does not translate path segments, so choose paths that work for every configured language.

If a block displays an image with text embedded in it, supply an appropriate image in each localized layout. The guide to [preparing and delivering images]({{site}}/docs/guides/image-handling/) covers the starter’s media workflow.

## Publishing and fallback checks

Fallback is useful while a site is being translated, but it can make an incomplete translation look like a finished page. Before launch, review every supported path in every locale and confirm which pages are intentionally using fallback.

Keep any locale-aware publishing checks in the page collection rather than in individual renderers. For example, a validation hook can warn editors when a required locale has no layout. See [how hooks run]({{site}}/docs/reference/hooks/) before adding that check, especially if it should behave differently for drafts and published pages.
