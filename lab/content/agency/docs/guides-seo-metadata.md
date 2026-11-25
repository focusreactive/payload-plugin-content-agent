{{short}} Starter builds page metadata from fields in Payload CMS and returns it through the Next.js App Router metadata API. Editors can override the title, description and social image for each page, while site-wide defaults cover pages that do not need custom values. This guide covers the fields, the metadata function and the checks to make before publishing.

## Set site-wide defaults

The starter combines [Payload](https://payloadcms.com) for content editing with [Next.js](https://nextjs.org) for rendering. Keep the public site URL and fallback metadata in `starter.config.ts`. Set `SITE_URL` in each deployment environment to the public origin of that environment.

```ts
const siteUrl = process.env.SITE_URL

if (!siteUrl) {
  throw new Error('SITE_URL is required to generate metadata')
}

export const starterConfig = {
  seo: {
    siteUrl,
    defaultTitle: 'Website',
    defaultDescription: 'Explore our pages and services.',
    defaultOgImage: '/images/social-default.png',
  },
} as const
```

The default image path is relative to the site origin. Add the file at `public/images/social-default.png` so it is available in every deployment. Use an image large enough for social sharing; a 1200 by 630 pixel image is a practical starting point.

The starter config is ordinary TypeScript: the metadata function imports it rather than relying on an automatic configuration loader. See the [configuration options]({{site}}/docs/reference/configuration/) for the rest of the starter settings.

## Add fields to the page model

The starter’s `Pages` collection stores metadata in an `seo` group. The group is optional, so an editor can publish a page without filling in every field. Add the group when defining the collection, and regenerate Payload types after changing the schema. The [content modeling guide]({{site}}/docs/guides/content-modeling/) explains where collection fields belong.

| Field | Type | Behavior |
| --- | --- | --- |
| `seo.title` | Text | Overrides the page title in search and social metadata. |
| `seo.description` | Textarea | Supplies the description used for search and social previews. |
| `seo.canonicalPath` | Text | Overrides the canonical URL with a root-relative path. |
| `seo.ogImage` | Text | Supplies a root-relative or absolute image URL for social previews. |
| `seo.noIndex` | Checkbox | Asks search engines not to index or follow the page. |

Keep titles descriptive and distinct. A title of roughly 50 to 60 characters and a description of roughly 150 to 160 characters are useful editing targets, not guaranteed display limits. Search engines may choose different text or truncate it.

For `canonicalPath`, enter a path such as `/services/`, not a full URL. Leave it empty when the current page is the canonical version. For `ogImage`, use a published image URL that a social crawler can access without signing in.

> **Note:** The `noIndex` field controls a robots directive; it does not make a page private. Use access control for content that must not be publicly available.

## Generate metadata for each page

In `src/app/[[...slug]]/page.tsx`, resolve the page from the route segments and return its metadata. The starter’s `getPageBySlug` helper in `src/lib/getPageBySlug.ts` accepts a slash-separated slug and a draft option; an empty slug resolves the home page.

```tsx
import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'
import { starterConfig } from '@/../starter.config'
import { getPageBySlug } from '@/lib/getPageBySlug'

type Props = {
  params: Promise<{ slug?: string[] }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug = [] } = await params
  const { isEnabled } = await draftMode()
  const page = await getPageBySlug(slug.join('/'), { draft: isEnabled })

  if (!page) notFound()

  const currentPath = slug.length ? `/${slug.join('/')}/` : '/'
  const requestedPath = page.seo?.canonicalPath
  const canonicalPath =
    requestedPath?.startsWith('/') && !requestedPath.startsWith('//')
      ? requestedPath
      : currentPath
  const title = page.seo?.title || page.title || starterConfig.seo.defaultTitle
  const description =
    page.seo?.description || starterConfig.seo.defaultDescription
  const image = page.seo?.ogImage || starterConfig.seo.defaultOgImage
  const noIndex = isEnabled || page.seo?.noIndex === true

  return {
    metadataBase: new URL(starterConfig.seo.siteUrl),
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: { title, description, images: [image] },
    robots: { index: !noIndex, follow: !noIndex },
  }
}
```

The route’s page component can use the same helper to load and render its blocks. Keep the helper’s draft behavior consistent between rendering and metadata: preview requests should read draft content, and normal requests should read published content only.

`metadataBase` resolves relative canonical and image paths against `SITE_URL`. The canonical check falls back to the current route if the editor enters a value that is not root-relative. It does not check whether the destination exists, so review canonical overrides before publishing.

## Publish and verify

Follow these steps for a new page or a metadata change:

1. Enter a page title and, where needed, fill in the SEO fields in Payload.
2. Preview the page and confirm that the title, description and image match the content.
3. Publish the page, then inspect the public response. If publication is scheduled, follow the [scheduled publishing recipe]({{site}}/docs/recipes/scheduled-publishing/) and check after the scheduled time.
4. Confirm that the canonical URL uses the intended production origin and that the social image is publicly accessible.

With `SITE_URL` set to the environment you want to inspect, fetch a published page and look for its metadata in the HTML:

```bash
curl -sL "$SITE_URL/services/" | grep -Eo '<(title|meta|link)[^>]*>'
```

Check the `title`, description, Open Graph image, canonical link and robots directive in the output. This command inspects the server response rather than a browser preview. If metadata is stale after a publish, check the page-fetching cache and revalidation behavior before changing the editor’s fields.
