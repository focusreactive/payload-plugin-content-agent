excerpt: A practical guide to caching published CMS content in the Next.js App Router, with safe previews, webhook invalidation and checks for stale pages.
seoTitle: Caching CMS Content in the Next.js App Router: A Guide
seoDescription: Learn how to cache CMS content in the Next.js App Router, keep previews private, invalidate published pages and troubleshoot stale responses.

A cache can make a content-heavy site fast, but it also creates a question editors will ask: “I published the change, so why can’t I see it?” The answer depends on what you cached, how you invalidate it and whether the request is a preview. I’m Mara Lindqvist, Head of Engineering at {{brand}}. In this 2026 guide, I’ll use the [Next.js](https://nextjs.org) App Router and Cache Components to build a clear policy for published CMS content, then show how to keep editorial previews separate.

## Start with a content and freshness map

Before writing cache code, list the content each route needs and decide how quickly changes must appear. A product page may depend on a product entry, shared navigation and a campaign banner. Invalidating only the product entry will not refresh the banner if it has its own cached fetch.

| Content | Suggested policy | Invalidation trigger | Reason |
| --- | --- | --- | --- |
| Published article | Cache with an article-specific tag | Article published, unpublished or deleted | Most reads can reuse the same content |
| Article listing | Cache with a collection tag | Article added, removed or updated | Cards and ordering can change |
| Shared navigation | Cache with a navigation tag | Navigation published | Many routes depend on one entry |
| Draft preview | Fetch without persistent caching | Each preview request | Editors need the current draft |
| Visitor-specific data | Keep outside the shared content cache | User action or session change | Private responses must not be shared |

These are starting points, not universal expiry times. An emergency notice may need a shorter lifetime than an archive page. Agree on a freshness target with the people who publish the content, including what should happen if the CMS is temporarily unavailable.

The CMS also affects the implementation. Available webhook events, draft APIs and content relationships differ, so compare them before choosing a tagging scheme. Our comparison of [marketing-team workflows across two CMS platforms]({{site}}/blog/storyblok-vs-contentful/) is a useful starting point for that decision.

## Cache published content deliberately

The example below uses Next.js 16 Cache Components. Enable them by setting `cacheComponents: true` in `next.config.ts`, then place this function in `lib/articles.ts`. It assumes the CMS delivery endpoint returns JSON with a `title` and `body` for a published article.

```ts
import { cacheLife, cacheTag } from 'next/cache'

type Article = {
  title: string
  body: string
}

export async function getPublishedArticle(slug: string): Promise<Article> {
  'use cache'

  cacheLife('hours')
  cacheTag(`cms:article:${slug}`)

  const baseUrl = process.env.CMS_DELIVERY_URL
  const token = process.env.CMS_DELIVERY_TOKEN

  if (!baseUrl || !token) {
    throw new Error('Missing CMS delivery configuration')
  }

  const response = await fetch(
    `${baseUrl}/articles/${encodeURIComponent(slug)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!response.ok) {
    throw new Error(`CMS delivery request failed: ${response.status}`)
  }

  return response.json() as Promise<Article>
}
```

The function’s arguments contribute to its cache key, so different slugs do not share an article result. The `hours` profile supplies a cache lifetime; the tag gives you a separate way to mark that result stale after a publish event. Neither replaces the other. A lifetime bounds how long content can remain cached without an event, while a webhook can trigger a refresh sooner.

### Keep the cache key meaningful

Validate and normalize slugs before calling the function. The webhook must use the same normalized slug when it constructs the tag. If content is localized, include the locale in both the function arguments and the tag; otherwise an update to one translation could leave another cached incorrectly.

The TypeScript assertion in the example does not validate the CMS response. In production, check the returned fields at the API boundary and handle missing or malformed content. Do not pass a preview token, user identity or draft content into this shared published-content function.

For an article listing, use a separate cached function and tag it `cms:articles`. A detail-page tag alone cannot refresh a list that includes the article’s title, summary or position.

## Give previews a separate path

A preview has a different job from a public page: it should show the editor’s current draft, not the last published response. Use Draft Mode to identify a preview request, and fetch draft content through the CMS preview API with `cache: 'no-store'`. Keep that fetch outside the shared `use cache` function.

### Secure the preview entry point

A preview-enabling route must validate a secret or another CMS-supported authentication mechanism before enabling Draft Mode. It should also validate the requested destination rather than redirecting to an arbitrary URL. Draft credentials belong on the server, and preview responses must not be stored in a public CDN cache.

Draft Mode identifies the request; it does not automatically make every CMS request fresh. The page still needs to choose the draft endpoint and avoid the published-content cache. When preview ends, disable Draft Mode so the browser returns to the public path.

> **Practical tip:** Test a draft change without publishing it. Open the preview and the public page in separate browser sessions; the draft should appear only in the authenticated preview.

For an implementation reference, see [how live preview is configured in {{short}} Starter]({{site}}/docs/guides/live-preview/). The open source starter is currently at version 3.2 and can be installed with `npx create-headless-starter`. Adapt its preview setup to your CMS permissions and hosting environment.

## Invalidate content when publishing changes

A CMS webhook can notify a Route Handler when published content changes. The following example expects a JSON payload containing a current `slug` and, for a rename, an optional `previousSlug`. Configure the CMS or an intermediary to send that shape and authenticate with a bearer secret.

```ts
import { revalidateTag } from 'next/cache'

function validSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 120 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  )
}

export async function POST(request: Request) {
  const secret = process.env.CMS_WEBHOOK_SECRET

  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const data = await request.json().catch(() => null)

  if (
    !data ||
    !validSlug(data.slug) ||
    (data.previousSlug !== undefined && !validSlug(data.previousSlug))
  ) {
    return new Response('Invalid payload', { status: 400 })
  }

  revalidateTag(`cms:article:${data.slug}`, 'max')

  if (data.previousSlug) {
    revalidateTag(`cms:article:${data.previousSlug}`, 'max')
  }

  revalidateTag('cms:articles', 'max')

  return Response.json({ accepted: true })
}
```

With the `max` profile, `revalidateTag` uses stale-while-revalidate behavior: a subsequent visit can receive stale content while fresh content is fetched in the background. Do not promise editors that the webhook response means every visitor immediately sees the new version.

If your CMS signs webhook payloads instead of sending a bearer token, verify its signature using the provider’s documented procedure. Protect the secret, reject unauthenticated requests and avoid logging credentials or full draft payloads.

### Account for relationships and removals

Configure events for unpublishing and deletion as well as publishing. A deleted article must no longer be returned by the delivery API, and its listing must be invalidated. For a slug change, invalidate the old and new detail tags and decide whether the old route should redirect or return a not-found response.

Shared authors, categories and navigation need their own dependency strategy. Either tag the cached data that directly represents each shared item or deliberately invalidate affected article and listing tags. The right choice depends on what the CMS webhook tells you about related entries.

## Test the complete publishing journey

A successful webhook request is only one part of the test. Exercise the page, the CMS and the cache together in an environment that resembles production.

1. **Warm the public cache.** Visit an article and its listing, then record the published title and response timing.
2. **Edit without publishing.** Confirm the draft appears in authenticated preview while the public article and listing remain unchanged.
3. **Publish the change.** Check that the CMS delivers an authenticated webhook and that the handler accepts it.
4. **Visit again.** Allow for stale-while-revalidate behavior, then confirm the article and listing eventually show the new title.
5. **Test a rename and removal.** Verify the old route, new route and listing against your redirect and unpublishing rules.
6. **Simulate a delivery failure.** Check logs and alerts, retry the webhook where supported, and confirm the cache lifetime provides a fallback.

Run the test against your actual hosting configuration, not only a development server. Development behavior is not a reliable substitute for production caching. On [Vercel](https://vercel.com), inspect the deployment’s cache behavior and logs; on self-hosted infrastructure, make sure all instances use a cache strategy that keeps invalidation consistent across them.

A newsroom migration adds another useful test: publish a correction to an existing article, not just a new story. Our work on [moving Tallgrass Media to a headless newsroom]({{site}}/case-studies/tallgrass-media/) illustrates the kind of editorial setting where existing URLs and publication workflows matter alongside new content.

## Operate the cache as an editorial feature

Caching is not finished when the code deploys. Give content teams a plain-language explanation of the expected delay after publication and a route for reporting a page that remains stale. Record webhook failures and cache refresh errors with enough context to identify the affected content, but without exposing secrets.

Monitor a few signals together:

- Webhook delivery success and retry counts.
- Time from publication to the updated public response.
- CMS request volume and error rates.
- Page response times and cache refresh failures.
- Reports of stale or missing content from editors.

An isolated cache hit rate is not enough. A high rate can conceal a broken invalidation path, while a lower rate may be acceptable for frequently updated content. Review measurements against the freshness targets you agreed on at the start.

If an editor must see their own update immediately, consider whether the update can be made through a trusted Server Action using `updateTag`. That API is intended for immediate expiration and read-your-own-writes behavior in Server Actions; it is not a substitute for the webhook Route Handler above. For externally initiated CMS publishes, design around the actual invalidation semantics and communicate them.

Finally, revisit the policy when a content model changes. A new shared campaign component may add a dependency to dozens of routes. The same is true when editors gain a new publishing workflow. Our [research into what content teams need from their tools]({{site}}/blog/editor-experience-survey-2026/) provides context for treating those workflows as part of the technical design, rather than an afterthought.

## FAQ

### Does Draft Mode automatically bypass every cache?

No. Draft Mode identifies a preview request, but your application must still fetch from the draft API and avoid shared caches for that response. Check the hosting and CDN configuration as well as the Next.js code.

### Should every CMS entry have its own tag?

Not necessarily. Entry-specific tags give precise invalidation, while collection or shared-component tags can be simpler to manage. Choose tags based on how content is fetched and which pages depend on it, and keep the webhook mapping consistent.

### Why is an article still stale just after the webhook succeeds?

With `revalidateTag` and the `max` profile, a request can receive stale content while revalidation happens in the background. A separate CDN cache, a failed CMS request or a mismatched tag can also cause delays, so inspect the full request path.

### What happens if the CMS webhook is missed?

The cached result can remain until its configured lifetime prompts a refresh or another invalidation occurs. Monitor delivery failures, enable retries where available and choose cache lifetimes that provide an acceptable fallback for each content type.
