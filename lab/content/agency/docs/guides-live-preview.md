Live preview lets editors see changes to a page’s blocks beside the editing form, before publishing them. {{short}} Starter connects [Payload](https://payloadcms.com) to the [Next.js](https://nextjs.org) App Router through an authenticated preview route and Payload’s live preview client. The iframe starts with the saved draft, then updates as an editor changes fields in the form.

## Start the project

Create a project and start the development server:

```bash
npx create-headless-starter
cd headless-starter
npm run dev
```

The CLI creates a Payload admin, a Pages collection and a block renderer. Set `SERVER_URL` in your environment to the project’s public origin before starting the server. The starter uses this value for the admin and preview origins. In local development, use the same origin to access both the admin and the site.

The starter also includes the `@payloadcms/live-preview-react` package, an authenticated preview route and a draft page renderer. If you add live preview to an existing project, make sure those pieces are present before enabling it.

## Configure preview

The starter reads preview settings from `starter.config.ts`. This example enables preview for the Pages collection and requests related content one level deep:

```ts
import { defineStarterConfig } from './src/starter/config'

export default defineStarterConfig({
  livePreview: {
    enabled: true,
    collection: 'pages',
    depth: 1,
    showViewportControls: true,
  },
})
```

Restart the development server after changing this file. The starter uses these settings when it builds the Payload admin configuration and when its preview route loads a draft.

| Option | Default | Purpose |
| --- | --- | --- |
| `enabled` | `false` | Enables the live preview iframe and preview route. |
| `collection` | `'pages'` | Selects the collection whose documents can open in preview. |
| `depth` | `1` | Sets the depth used to populate related documents in the preview. |
| `showViewportControls` | `true` | Shows the admin controls for switching preview viewport sizes. |

Keep `depth` as low as your blocks allow. A block that displays fields from a related document needs enough depth to receive those fields; increasing it can also make draft requests more expensive.

> **Note:** Preview is available only to signed-in users who can read the page. It is not a public share link. The preview route checks the Payload session and collection access before enabling Next.js draft mode.

## Open a draft

1. Sign in to the Payload admin and open a page in the Pages collection.
2. Save the page as a draft if it has not been saved yet. The preview route needs a document ID to load the initial draft.
3. Open the live preview pane. The starter loads the draft through its preview route and displays the page in the iframe.
4. Edit a field or reorder a block. The iframe updates from the form state without publishing the page.
5. Save the draft when you want to keep the changes. Publishing remains a separate action.

The iframe’s initial render comes from the saved draft. Changes sent from the editor are temporary until the editor saves them. If the iframe is reloaded before a change is saved, the preview starts again from the saved draft.

## Render live block data

The starter’s preview page passes the initial page document and server origin to a client component. That component subscribes to Payload’s preview messages and renders the latest document with the same block renderer used by the site:

```tsx
'use client'

import { useLivePreview } from '@payloadcms/live-preview-react'
import type { Page } from '@/payload-types'
import { BlockRenderer } from '@/blocks/BlockRenderer'

type Props = {
  initialPage: Page
  serverURL: string
}

export function LivePage({ initialPage, serverURL }: Props) {
  const { data } = useLivePreview<Page>({
    initialData: initialPage,
    serverURL,
    depth: 1,
  })

  return <BlockRenderer blocks={data.layout ?? []} />
}
```

Keep the hook’s `depth` aligned with the value in `starter.config.ts`. The `serverURL` passed to this component must be the Payload origin, so the client accepts preview messages from the expected server.

Blocks live in `src/blocks/`. When adding one, register its Payload schema and its renderer so that saved drafts and live updates use the same block type. Follow the steps for [adding a block]({{site}}/docs/recipes/add-a-block/) before testing it in the preview pane. For blocks with uploads, check the guidance on [handling images]({{site}}/docs/guides/image-handling/) as well.

## Deploy and troubleshoot

Preview requests must reach the application server: a static export cannot run the authenticated preview route or enable draft mode. Set `SERVER_URL` to the deployed project’s origin and complete the checks in [the first deployment guide]({{site}}/docs/getting-started/first-deploy/) before inviting editors.

If the pane stays blank, first confirm that the editor is signed in on the same origin and can read the page. Then check that the page has a saved draft, `livePreview.enabled` is `true`, and the server was restarted after configuration changes. A reverse proxy or security policy must also allow the admin to embed the preview page in an iframe.

If the page loads but changes do not appear, check the browser console for message-origin errors and confirm that `serverURL` matches the Payload origin. For a missing block, check its renderer registration and the shape of its `layout` data. Changes to related documents are not a substitute for saving those documents; save them, then reload the preview to verify the populated result.
