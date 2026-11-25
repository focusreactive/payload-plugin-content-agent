Redirects send visitors from an old path to a new one without requiring an editor to keep an obsolete page online. {{short}} Starter stores redirect rules in [Payload](https://payloadcms.com) and checks them in the [Next.js](https://nextjs.org) App Router before rendering a page. Use a temporary redirect while a move is being tested and a permanent redirect when the old address should no longer be indexed.

## Enable redirects

For a new project, create the starter with `npx create-headless-starter`. In an existing starter project, enable the redirects feature in `starter.config.ts`:

```ts
import { defineStarterConfig } from './src/starter/defineStarterConfig'

export default defineStarterConfig({
  redirects: {
    enabled: true,
    defaultStatus: 307,
  },
})
```

The starter’s Payload configuration reads this file and registers the `redirects` collection when the feature is enabled. Restart the development server after changing the config. Existing redirect records are retained if you later disable the feature, but they are not available to the route handler until you enable it again.

The starter also includes page blocks in `src/blocks/`. Redirects are separate from those blocks: they resolve a request before the destination page and its blocks are rendered.

## Redirect fields

Create and edit rules in the **Redirects** collection in the Payload admin. The source must be unique, even when a rule is disabled.

| Field | Purpose | Example |
| --- | --- | --- |
| Source | Exact path to match, starting with `/` | `/old-services` |
| Destination | Internal path to send the visitor to | `/services` |
| Status | Temporary `307` or permanent `308` | `308` |
| Enabled | Controls whether the rule applies | `true` |

Paths are case-sensitive. Enter a path without a trailing slash, except for the root path `/`. The collection validates this format and rejects query strings, fragments and external URLs in both path fields. Query strings on incoming requests are not included in the lookup or forwarded to the destination.

The configured default status applies to new records. Changing it does not update existing rules. A `307` preserves the request method and is useful for a move you may reverse. A `308` also preserves the method and tells clients and search engines that the move is permanent. Browsers can cache permanent redirects, so test a rule with `307` before switching it to `308`.

> **Note:** Rules match the complete path, not a prefix. A redirect from `/old-services` does not also redirect `/old-services/design`; create a separate rule for that path.

## Resolve rules in the App Router

The following optional catch-all route checks enabled rules before asking the starter to render a page. Add it at `src/app/[[...slug]]/page.tsx`, replacing the starter’s existing catch-all page if you have one:

```tsx
import config from '@payload-config'
import { getPayload } from 'payload'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { renderPage } from '@/starter/renderPage'

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>
}) {
  const { slug = [] } = await params
  const path = slug.length ? `/${slug.join('/')}` : '/'
  const payload = await getPayload({ config })

  const result = await payload.find({
    collection: 'redirects',
    where: {
      and: [
        { source: { equals: path } },
        { enabled: { equals: true } },
      ],
    },
    limit: 1,
    depth: 0,
  })

  const rule = result.docs[0]

  if (rule?.status === '308') permanentRedirect(rule.destination)
  if (rule) redirect(rule.destination)

  const page = await renderPage(path)
  if (page === null) notFound()

  return page
}
```

The `renderPage` helper supplied by the starter returns the matching page or `null`. Regenerate Payload types after enabling the collection so that `redirects` is available in the generated types. The starter’s type-generation command is `npx payload generate:types`.

The dynamic route reads the current rule on each request, so an enabled change takes effect without a rebuild. It also means the route needs access to the Payload database at runtime. Explicit App Router routes take precedence over the catch-all, so this handler does not redirect paths handled by a separate route file.

## Add and test a rule

1. Open **Redirects** in the Payload admin and create a record with the old path as its source.
2. Set the destination to an existing internal page. Leave the status at `307` and enable the rule.
3. Save the record, then request the old path without following redirects:

   ```bash
   curl -I http://localhost:3000/old-services
   ```

4. Check for a `307` response and a `Location` header containing the destination. Visit the destination directly to confirm that it renders the intended page.
5. Once the move is final, change the status to `308` and test again.

Avoid redirecting a destination back to its source, either directly or through another rule. The handler performs one lookup per request; it does not detect chains or loops. Review both paths before enabling a rule, especially when replacing an older redirect.

## Coordinate with publishing and locales

Redirects and pages have separate lifecycles. If a destination is not published yet, visitors can arrive at a not-found page even though the redirect itself works. Publish the destination first, then enable the rule. For timed launches, review how to [schedule a page for publication]({{site}}/docs/recipes/scheduled-publishing/) before choosing when to activate the redirect.

Locale prefixes are part of the source path. For example, `/fr/ancien` and `/en/old` require separate records. Use the same convention for destinations, and check the project’s [locale routing setup]({{site}}/docs/guides/localization/) before adding rules.

If you add custom validation or audit behavior to the collection, keep it in a Payload hook rather than in the page route. The [guide to collection hooks]({{site}}/docs/reference/hooks/) explains where those checks run.
