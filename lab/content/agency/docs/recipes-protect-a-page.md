Protect a published page when you need to share it with a limited audience without creating individual accounts. This recipe adds a password field to the page settings, keeps the password in a server environment variable, and checks a signed cookie before rendering the page’s blocks. The password applies to the page route, not to files linked from the page.

## Before you start

This recipe assumes you have a {{short}} Starter project with the App Router, a Pages collection with drafts enabled, and a block renderer at `src/components/RenderBlocks.tsx`. Pages have a unique `slug`, a `title`, and a `layout` field containing blocks from `src/blocks/`.

The implementation uses the server APIs in [Next.js](https://nextjs.org) and the Local API in [Payload](https://payloadcms.com). If you are creating a project, check the available starter commands in the [CLI options]({{site}}/docs/reference/cli/).

## Restrict the Pages API

Add the following exports to `src/collections/pageProtection.ts`. In your Pages collection configuration, add `pageProtectionField` to `fields` and assign `pageReadAccess` to `access.read`.

```ts
import type { Access, Field } from 'payload'

export const pageProtectionField: Field = {
  name: 'passwordProtected',
  type: 'checkbox',
  defaultValue: false,
  admin: {
    description: 'Require the page password on the public route.',
  },
}

export const pageReadAccess: Access = ({ req }) => {
  // The users collection is reserved for trusted editors.
  if (req.user?.collection === 'users') return true

  return {
    passwordProtected: {
      not_equals: true,
    },
  }
}
```

This rule keeps protected page documents out of unauthenticated Payload REST and GraphQL responses. Trusted editors can still manage them in the admin panel. Do not grant untrusted users accounts in the `users` collection with this rule unchanged.

| Field or setting | Purpose | Value for this recipe |
| --- | --- | --- |
| `slug` | Identifies the public route and password variable | Lowercase letters, numbers, and hyphens |
| `title` | Supplies the page heading | Any editorial title |
| `layout` | Stores the page blocks | Blocks registered in the Pages collection |
| `passwordProtected` | Enables the password gate | `true` for protected pages |
| Draft status | Determines whether the public route can find the page | Published |

Keep passwords out of page fields: even a field hidden in the admin interface is not a safe place for a shared secret. For guidance on separating editorial fields from application settings, see the [modeling guide]({{site}}/docs/guides/content-modeling/).

## Add the server-side gate

Replace the frontend page route at `src/app/(frontend)/[slug]/page.tsx` with the following. Adapt the `RenderBlocks` import if your project uses a different renderer.

```tsx
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { RenderBlocks } from '@/components/RenderBlocks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function getPage(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) notFound()
  if (slug.length > 64) notFound()

  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 1,
    draft: false,
    overrideAccess: true,
  })

  return result.docs[0]
}

function secrets(slug: string) {
  const key = `PAGE_PASSWORD_${slug.toUpperCase().replaceAll('-', '_')}`
  const password = process.env[key]
  const signingKey = process.env.PAGE_GATE_SECRET

  if (!password) throw new Error(`Missing ${key}`)
  if (!signingKey) throw new Error('Missing PAGE_GATE_SECRET')
  if (signingKey.length < 32) throw new Error('PAGE_GATE_SECRET is too short')

  return { password, signingKey }
}

function token(slug: string, password: string, signingKey: string) {
  return createHmac('sha256', signingKey)
    .update(JSON.stringify([slug, password]))
    .digest('hex')
}

function equal(a: string, b: string) {
  const hash = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(a), hash(b))
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const page = await getPage(slug)
  if (!page) notFound()

  if (page.passwordProtected) {
    const { password, signingKey } = secrets(slug)
    const expected = token(slug, password, signingKey)
    const supplied = (await cookies()).get('page-access')?.value

    if (!supplied || !equal(supplied, expected)) {
      async function unlock(formData: FormData) {
        'use server'

        const current = await getPage(slug)
        if (!current) notFound()
        if (!current.passwordProtected) redirect(`/${slug}`)

        const { password, signingKey } = secrets(slug)
        const submitted = formData.get('password')
        if (typeof submitted !== 'string') redirect(`/${slug}?error=1`)
        if (submitted.length > 1024) redirect(`/${slug}?error=1`)
        if (!equal(submitted, password)) redirect(`/${slug}?error=1`)

        const store = await cookies()
        store.set('page-access', token(slug, password, signingKey), {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: `/${slug}`,
          maxAge: 60 * 60 * 24,
        })
        redirect(`/${slug}`)
      }

      return (
        <main>
          <h1>Enter the page password</h1>
          <form action={unlock}>
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" maxLength={1024} required />
            <button type="submit">Continue</button>
          </form>
        </main>
      )
    }
  }

  return (
    <main>
      <h1>{page.title}</h1>
      <RenderBlocks blocks={page.layout} />
    </main>
  )
}
```

The route deliberately bypasses Payload access control to fetch the document on the server. It renders neither the title nor the blocks until the cookie has been checked. A changed page password or signing key invalidates existing cookies.

## Configure and test

1. Create a page with the slug `partner-preview`, enable **Password protected**, and publish it.
2. Add secrets to your local environment. Run this once in the project root:

   ```bash
   printf 'PAGE_GATE_SECRET=%s\nPAGE_PASSWORD_PARTNER_PREVIEW=%s\n' \
     "$(openssl rand -hex 32)" "$(openssl rand -hex 16)" >> .env.local
   ```

3. Restart the development server. Retrieve the generated page password from `.env.local` and enter it at `/partner-preview`.
4. Test in a private browser window: an incorrect password must not reveal the content. Also confirm that an unauthenticated request to the Payload Pages API does not return the protected document.
5. Set the same two variables in your deployment environment before publishing. Keep `.env.local` out of version control.

> **Note:** This gate does not protect direct URLs to uploaded files, content copied into another collection, or alternate routes that bypass the check. Use private storage and authorized file delivery for confidential assets. Do not cache protected responses in a shared CDN.

When adding a new block, check that it does not expose protected content through a separate endpoint. The [block recipe]({{site}}/docs/recipes/add-a-block/) covers registering and rendering blocks.
