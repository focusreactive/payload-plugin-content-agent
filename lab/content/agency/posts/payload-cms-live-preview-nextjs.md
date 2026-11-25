excerpt: Give editors a safe, responsive preview of unpublished Payload content in Next.js, with a practical setup for draft access, live updates, and testing.

seoTitle: Payload CMS Live Preview with Next.js: Setup Guide

seoDescription: Set up Payload live preview in Next.js with draft access, an editor iframe, and instant updates, then test the workflow before launch.

[Payload](https://payloadcms.com) can show editors an up-to-date version of a page while they work, and [Next.js](https://nextjs.org) can render that preview using the same components as the public site. The useful distinction is that a draft is not automatically a live preview: you need a protected way to load unpublished content, an iframe in the editor, and a listener that applies changes without waiting for a public deployment.

## Decide what the preview should show

This guide uses a `pages` collection with a title, slug, and plain-text body. Payload and the Next.js site run in the same application and share an origin, so the editor’s authentication cookie can reach the preview route. The example assumes TypeScript, the Next.js App Router, and Payload’s local API.

An editor opens an existing page in Payload, enters live preview, and sees the site at `/pages/[slug]`. The initial page is loaded from the latest saved draft. As the editor changes fields, Payload sends updates to the preview window, where a React hook updates the displayed content.

| Part | Responsibility | What to check |
|---|---|---|
| Payload drafts | Store unpublished changes | Drafts are enabled on the collection |
| Preview route | Authenticate the editor and enable draft mode | Unauthenticated requests are rejected |
| Next.js page | Fetch the appropriate version | Public requests cannot read drafts |
| Live preview hook | Apply editor changes in the browser | The iframe updates as fields change |
| Exit route | End the preview session | Draft mode can be disabled |

This is an editorial preview, not a replacement for checking the published site. A draft can depend on relationships, locale settings, or external services that behave differently in production. Keep those dependencies visible in your testing plan.

If you are moving existing content, identify the fields and URL patterns before wiring up the iframe. A [move from WordPress to a headless architecture]({{site}}/wordpress-to-headless-migration/) often exposes differences between a stored slug and the public route that editors expect to see.

## Configure drafts and the preview entry point

Enable drafts on the collection first. Then configure the live preview URL to send editors through a route that checks their session and enables Next.js draft mode. The following example also restricts anonymous reads to published documents.

### Collection and route

Set `PAYLOAD_PUBLIC_URL` to the shared application origin and `PREVIEW_SECRET` to a long, random server-side value. Generate Payload types after adding the collection. The route uses the Payload config alias commonly provided by a Payload application; adjust the import if your project uses a different alias.

```ts
// collections/Pages.ts
import type { CollectionConfig } from 'payload'

export const Pages: CollectionConfig = {
  slug: 'pages',
  versions: { drafts: true },
  access: {
    read: ({ req: { user } }) =>
      user ? true : { _status: { equals: 'published' } },
  },
  admin: {
    livePreview: {
      url: ({ data }) => {
        const url = new URL('/api/preview', process.env.PAYLOAD_PUBLIC_URL!)
        url.searchParams.set('secret', process.env.PREVIEW_SECRET!)
        url.searchParams.set('slug', String(data.slug ?? ''))
        return url.toString()
      },
    },
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'body', type: 'textarea' },
  ],
}

// app/api/preview/route.ts
import config from '@payload-config'
import { draftMode } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  const slug = request.nextUrl.searchParams.get('slug') ?? ''

  if (
    !process.env.PREVIEW_SECRET ||
    secret !== process.env.PREVIEW_SECRET ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) {
    return new NextResponse('Invalid preview request', { status: 401 })
  }

  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return new NextResponse('Sign in required', { status: 401 })

  const result = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
    draft: true,
    user,
    overrideAccess: false,
  })
  if (!result.docs[0]) {
    return new NextResponse('Page not found', { status: 404 })
  }

  const draft = await draftMode()
  draft.enable()
  return NextResponse.redirect(new URL(`/pages/${slug}`, request.url))
}
```

Register `Pages` in your Payload configuration. The two file comments in the block mark separate files; they are not intended to be pasted into one module.

The route checks both the secret and the Payload session, then uses collection access control when looking up the page. It constructs the redirect from a validated slug rather than accepting an arbitrary destination. The example grants every authenticated Payload user read access to every page; replace that rule with your organization’s roles and document permissions before using it with restricted content.

The secret appears in the iframe URL, so it is not sufficient authorization on its own. It may also appear in browser tools or server logs. Restrict log access, avoid recording query strings where possible, and rotate the secret if it is exposed. A production implementation can instead issue short-lived, scoped preview tokens.

### Prepare the content model

Create and save a page with a slug such as `about` before opening its preview. The route needs a saved document to find; a brand-new document without a saved slug cannot resolve through this example. Changing the slug can also require saving and reopening preview so that its URL matches the stored document.

For multilingual sites, decide whether the locale belongs in the path or another explicit part of the request. The same locale must be used for the initial draft fetch and for live updates. Our guide to [fields, locales, and fallbacks]({{site}}/blog/headless-cms-localization-guide/) covers the modeling decisions behind that choice.

## Render the draft and listen for changes

Install `@payloadcms/live-preview-react` in the application and set `NEXT_PUBLIC_PAYLOAD_URL` to the Payload server origin. In this same-origin example, that is the same origin as `PAYLOAD_PUBLIC_URL`. The public variable contains an address, not a secret.

The server component below fetches published content for normal visitors and draft content only when draft mode is enabled and a Payload user is authenticated. The client component subscribes to live updates only in draft mode.

```tsx
// app/pages/[slug]/page.tsx
import config from '@payload-config'
import { draftMode, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import { PageView, PreviewPage } from './preview-page'

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { isEnabled } = await draftMode()
  const payload = await getPayload({ config })
  const { user } = isEnabled
    ? await payload.auth({ headers: await headers() })
    : { user: null }

  if (isEnabled && !user) notFound()

  const result = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 1,
    draft: isEnabled,
    user: user ?? undefined,
    overrideAccess: false,
  })
  const page = result.docs[0]
  if (!page) notFound()

  return isEnabled ? <PreviewPage initialData={page} /> : <PageView page={page} />
}

// app/pages/[slug]/preview-page.tsx
'use client'

import { useLivePreview } from '@payloadcms/live-preview-react'
import type { Page } from '@/payload-types'

export function PageView({ page }: { page: Page }) {
  return (
    <main>
      <h1>{page.title}</h1>
      <p>{page.body}</p>
    </main>
  )
}

export function PreviewPage({ initialData }: { initialData: Page }) {
  const { data } = useLivePreview<Page>({
    initialData,
    serverURL: process.env.NEXT_PUBLIC_PAYLOAD_URL!,
    depth: 1,
  })

  return <PageView page={data} />
}
```

Adjust the generated type import to match your project. The `depth` values match so that the initial fetch and live preview use a consistent relationship depth. This small example has no relationship fields, but the setting becomes important when a page renders linked documents.

The hook receives messages from the Payload admin and updates React state. It does not publish a document, and it does not make a draft available to anonymous visitors. The normal page still asks Payload for published content with access control enabled.

> **Practical tip:** Open a private browser window and request a known draft URL. A not-found response there is a useful check that preview access has not leaked into the public route.

## Give editors a predictable workflow

A preview is useful only if editors know what it represents. Agree on the difference between a saved draft, an unsaved field change, and a published version. Then document that distinction beside the publishing process, not just in developer notes.

1. Create or open a page, add its title and slug, and save it as a draft.
2. Open live preview and confirm that the iframe shows the intended route.
3. Change the title or body and check that the preview updates without publishing.
4. Save the draft, leave the document, and return to confirm that the saved version persists.
5. Publish when the content is approved, then check the public page in a separate session.

Live updates can expose layout issues earlier than a save-and-refresh workflow, but they are still a representation of one viewport and one route. Give editors a way to check narrow screens and long content, especially for navigation labels, cards, and headings.

For commerce pages, make clear which parts come from Payload and which come from the commerce platform. A changed editorial heading may update immediately while price or stock still comes from a separate service. The distinction matters whether the team is [comparing Shopify and Medusa]({{site}}/blog/shopify-vs-medusa-headless/) or integrating an existing store.

## Protect the preview in production

Draft mode sets a browser cookie; it is not an identity system. Keep the session check on every draft page request, as in the example, rather than relying solely on the initial preview route. Apply Payload access control to local API calls with `overrideAccess: false`, and test the actual permissions of each editor role.

Add an authenticated route that calls `draftMode().disable()` and redirects to a safe public path. Link it from a visible preview banner so editors can tell when they are viewing draft content and can exit without clearing browser cookies. Do not let that route redirect to an arbitrary URL supplied by a visitor.

Before release, review these conditions:

- The editor and preview use HTTPS in production, with cookies configured for the intended origin.
- The iframe can be embedded by the Payload admin under your Content Security Policy.
- Draft responses are not stored in a shared cache or served to anonymous visitors.
- Unauthorized users cannot fetch drafts through another API endpoint.
- Environment variables and preview credentials differ between environments.

If Payload and the frontend move to separate origins, revisit authentication and browser cookie behavior rather than assuming this example still works. Cross-origin iframe restrictions can prevent the Payload session cookie from reaching the frontend. Use an explicit, reviewed authentication design and test it in the browsers your editors use.

These decisions are also useful when evaluating delivery partners. Ask how they handle preview permissions, caching, and handover; our [agency selection questions]({{site}}/blog/questions-to-ask-headless-cms-agency/) provide a starting point for that conversation.

## Test the complete path

Start with one page and trace it from an editor change to the rendered iframe. If the initial page loads but changes do not appear, check the browser console, the Payload server URL passed to the hook, and whether the preview is running inside the Payload iframe. If the iframe never loads, inspect the preview route response, session cookie, and framing policy before changing React code.

Test published and draft states separately. An editor should see the saved draft after entering preview; an anonymous visitor should see the last published version, or a not-found response if none exists. Sign out while draft mode is active and confirm that the page no longer renders unpublished content.

Then test the content that makes your site distinctive: optional fields, long text, relationships, and any custom blocks. Compare the initial saved draft with the live state after an edit. A preview that updates a title but silently omits a related image is not ready for editorial use.

For a new project, {{brand}} maintains the open source {{short}} Starter for Next.js and a headless CMS. Version 3.2 is installed with `npx create-headless-starter`. Treat a starter as a foundation rather than proof that your own access rules, content model, and preview workflow have been configured.

## FAQ

### Does draft mode publish the page?

No. Next.js draft mode changes how the application handles a preview request; publication remains a Payload content operation. An editor can inspect draft content without making it the public version.

### Why does the preview show a not-found page?

The document may not have a saved slug, the slug may have changed, or the signed-in user may lack read access. Check the preview route response and Payload permissions first, then confirm that the route and stored slug match.

### Can a public visitor see a draft by guessing its URL?

Not with the intended rules in this example: the draft request also requires an authenticated Payload user, and anonymous collection reads are restricted to published documents. Verify those controls across every API and page route in your application.

### Do live updates replace saving a draft?

No. Live updates let an editor inspect changes in the preview, but saving persists the draft for a later session. Test both behaviors so editors do not mistake an updated iframe for a saved document.
