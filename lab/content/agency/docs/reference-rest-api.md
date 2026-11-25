{{short}} Starter exposes page content through the REST API provided by [Payload](https://payloadcms.com). The API runs alongside the [Next.js](https://nextjs.org) application, so the same deployment can serve rendered pages and JSON responses. Use it to retrieve page fields, inspect block data, or build a separate frontend. This reference covers the starter’s `pages` collection and its public read workflow.

## Endpoint and content model

The collection endpoint is `/api/pages`. A request to `/api/pages/{id}` returns one page by its Payload document ID; the collection endpoint returns a paginated list. The starter uses a `slug` field to look up pages by route, rather than treating the slug as the document ID.

Each page has a `title`, a `slug`, and a `layout` array. The array contains blocks in editorial order. Each block includes a `blockType` that identifies its schema; for example, a `hero` block has a `heading` field. Block definitions live in `src/blocks/`, and the pages collection includes them in its layout field.

The API routes are mounted at `/api` by the Payload route handler in the App Router. The starter’s `starter.config.ts` holds project-level settings; it is not the schema for API responses. For the surrounding files, see [how the repository is organized]({{site}}/docs/getting-started/project-structure/).

## Query a page by slug

Set `SITE_URL` in your shell to the origin of the running application, then request the collection endpoint. This example asks for the page whose slug is `home` and prevents relationship fields from being expanded:

```bash
curl -G "${SITE_URL}/api/pages" \
  --data-urlencode 'where[slug][equals]=home' \
  --data-urlencode 'depth=0'
```

A successful collection response has a `docs` array even when the filter matches only one page. An empty array means no accessible page matched the query; it is not the same as a failed request. A shortened response looks like this:

```json
{
  "docs": [
    {
      "id": "65f2a8c41b6e7d0098123456",
      "title": "Home",
      "slug": "home",
      "layout": [
        {
          "id": "65f2a8c41b6e7d0098123457",
          "blockType": "hero",
          "heading": "Make content work harder"
        }
      ],
      "_status": "published"
    }
  ],
  "totalDocs": 1,
  "limit": 10,
  "totalPages": 1,
  "page": 1,
  "hasNextPage": false,
  "hasPrevPage": false
}
```

Payload may return additional fields, including timestamps and fields added to the collection schema. Read the fields your application needs rather than relying on this example as a complete response schema.

## Query options

These parameters apply to collection reads. Combine them in the query string to narrow results or control the response size.

| Parameter | Purpose | Example |
| --- | --- | --- |
| `where[slug][equals]` | Returns documents with an exact slug match. | `home` |
| `depth` | Controls how deeply related documents are populated. Use `0` for IDs instead of populated relationships. | `0` |
| `limit` | Sets the maximum number of documents in a response. | `10` |
| `page` | Selects a page of results, starting at `1`. | `2` |
| `sort` | Sorts by a field; prefix the field with `-` for descending order. | `-createdAt` |
| `draft` | Requests draft content when drafts are enabled and the caller has access. | `true` |

Pagination applies after filtering. Check `hasNextPage` before requesting another page, and avoid assuming that a collection response contains every document. Use a low `depth` for listing pages when you do not need populated relationships.

## Read from a server component

The following helper queries the API from server-side application code. Set `SITE_URL` in the application environment as well as in your shell if you use the earlier curl command. The helper checks the HTTP response before reading the JSON and returns `null` for an empty result.

```ts
type Page = {
  id: string
  title: string
  slug: string
}

type PageResult = {
  docs: Page[]
}

export async function getPage(slug: string): Promise<Page | null> {
  const origin = process.env.SITE_URL
  if (!origin) throw new Error('SITE_URL is required')

  const url = new URL('/api/pages', origin)
  url.searchParams.set('where[slug][equals]', slug)
  url.searchParams.set('depth', '0')
  url.searchParams.set('limit', '1')

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Page request failed: ${response.status}`)
  }

  const result = (await response.json()) as PageResult
  return result.docs[0] ?? null
}
```

The type in this example covers only the fields the helper returns to its caller; it does not validate JSON at runtime. Add the block fields your renderer consumes and validate responses at the boundary if the data comes from a deployment you do not control. The uncached fetch favors fresh content; choose a caching strategy separately if your application needs one.

## Access, drafts, and changes

The starter’s public read access is limited to published pages. A public slug query therefore does not expose an unpublished draft. Editors can request draft content through an authenticated Payload session, subject to the collection’s access rules.

> **Note:** Do not place editor credentials or privileged API tokens in browser-side code. Keep authenticated requests on the server and grant each caller only the access it needs.

When changing the content model, follow this sequence:

1. Update the page or block schema and check the collection’s access rules.
2. Create or edit a page in the Payload admin and publish it for public access.
3. Query the endpoint with the page slug and inspect the returned `layout`.
4. Update the frontend renderer to handle the block types and fields it receives.

For a new block, follow the guide to [building another page block]({{site}}/docs/recipes/add-a-block/). If the consumer also renders search metadata, see the guide to [setting page titles and descriptions]({{site}}/docs/guides/seo-metadata/). Treat schema changes as API changes: update consumers before removing or renaming fields they depend on.
