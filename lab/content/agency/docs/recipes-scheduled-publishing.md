Scheduled publishing lets an editor prepare a page and make it public at a specified time without being online for the release. This recipe uses [Payload](https://payloadcms.com) for the page records and a protected [Next.js](https://nextjs.org) route to publish due pages. It uses a single working copy of each page, rather than Payload drafts: changes to an already published page are visible immediately.

## Add scheduling fields

Add the following collection to `src/collections/Pages.ts`. The example assumes the starter’s `Hero` and `RichText` block definitions are exported from `src/blocks/`. Register `Pages` in your Payload configuration if it is not already registered.

```ts
import type { CollectionConfig } from 'payload'
import { Hero } from '../blocks/Hero'
import { RichText } from '../blocks/RichText'

export const Pages: CollectionConfig = {
  slug: 'pages',
  access: {
    read: ({ req }) =>
      req.user ? true : { visibility: { equals: 'published' } },
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'private',
      options: ['private', 'scheduled', 'published'],
    },
    {
      name: 'publishAt',
      type: 'date',
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
    { name: 'layout', type: 'blocks', blocks: [Hero, RichText] },
  ],
}
```

The collection gives authenticated users access to all pages and restricts public reads to published pages. Adapt those rules if your project has separate editor roles. The scheduling fields have these responsibilities:

| Field | Purpose |
| --- | --- |
| `title` | Identifies the page in the admin interface and appears on the page. |
| `slug` | Provides the unique path segment used to find the page. |
| `visibility` | Controls whether the page is private, scheduled or published. |
| `publishAt` | Stores the date and time when a scheduled page becomes eligible for publication. |
| `layout` | Holds the page’s blocks; it does not determine publication status. |

A scheduled page must have both `visibility` set to `scheduled` and a `publishAt` value. A missing date leaves it unpublished. Block content can include images; follow the [image handling guide]({{site}}/docs/guides/image-handling/) when preparing them for a page.

## Create the publishing route

Add `src/app/api/publish-scheduled/route.ts`. It finds up to 100 due pages and changes their visibility. A later run picks up any remaining pages.

```ts
import config from '@payload-config'
import { getPayload } from 'payload'

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET

  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const payload = await getPayload({ config })
  const due = await payload.find({
    collection: 'pages',
    overrideAccess: true,
    depth: 0,
    limit: 100,
    sort: 'publishAt',
    where: {
      and: [
        { visibility: { equals: 'scheduled' } },
        { publishAt: { less_than_equal: new Date().toISOString() } },
      ],
    },
  })

  for (const page of due.docs) {
    await payload.update({
      collection: 'pages',
      id: page.id,
      overrideAccess: true,
      data: { visibility: 'published' },
    })
  }

  return Response.json({ published: due.docs.length })
}
```

The route uses Payload’s local API with access checks bypassed, so the bearer secret is essential. Set `CRON_SECRET` to a long, random value on the server; the [environment setup guide]({{site}}/docs/getting-started/environment-variables/) explains where to configure secrets. Never expose it in browser code.

Configure a scheduler to send a `POST` request to `/api/publish-scheduled` with an `Authorization` header containing `Bearer` followed by the secret. Run it once a minute and configure it not to overlap requests. The route is not an atomic claim mechanism: avoid editing scheduled pages while a publishing run is in progress.

> **Note:** The scheduler determines publication accuracy. A page becomes eligible at its chosen time, but it appears only after a successful run. If a run fails, the next successful run retries pages that are still scheduled.

## Read only public pages

The public page route must respect the collection’s read access rule. In `src/app/[slug]/page.tsx`, use `overrideAccess: false` and avoid caching the result so a newly published page can appear on the next request.

```tsx
import config from '@payload-config'
import { getPayload } from 'payload'
import { notFound } from 'next/navigation'
import { RenderBlocks } from '@/components/RenderBlocks'

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'pages',
    overrideAccess: false,
    where: { slug: { equals: slug } },
    limit: 1,
  })

  const page = result.docs[0]
  if (!page) notFound()

  return (
    <main>
      <h1>{page.title}</h1>
      <RenderBlocks blocks={page.layout ?? []} />
    </main>
  )
}
```

This example assumes the starter’s `RenderBlocks` component renders the blocks registered on the collection. When adding another layout, follow the [block creation recipe]({{site}}/docs/recipes/add-a-block/) and register it in both places.

## Schedule and verify a page

1. Create a page, add its blocks and save it with `visibility` set to `private`.
2. Check the content and images in the admin interface. Set `publishAt` to the intended date and time, then change `visibility` to `scheduled` and save.
3. Before the scheduled time, request the page as a logged-out visitor. It should return a not-found response.
4. After the scheduler runs, check that the page appears publicly and that its visibility is `published`.

Keep the scheduler enabled after deployment and monitor failed requests. To withdraw a page, change its visibility to `private`; to schedule it again, set a new date and change its visibility back to `scheduled`. This recipe does not retain a separate unpublished revision of a live page, so use a separate page if substantial changes need review before release.
