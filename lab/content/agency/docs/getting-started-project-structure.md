{{short}} Starter separates the public site, the Payload admin and the content models that connect them. It uses the [Next.js](https://nextjs.org) App Router for routes and [Payload](https://payloadcms.com) for content management. The structure below is what you get when you create a project with `npx create-headless-starter`; your generated project can then be changed independently of the starter.

## Top-level layout

The project keeps application code in `src/`, while configuration and package files stay at the root. The most important paths are:

```bash
# starter.config.ts
# next.config.ts
# package.json
# src/
#   app/
#     (frontend)/
#       page.tsx
#       [slug]/page.tsx
#     (payload)/
#       admin/[[...segments]]/page.tsx
#       api/[...slug]/route.ts
#   blocks/
#     Hero/
#       config.ts
#       Component.tsx
#     RichText/
#       config.ts
#       Component.tsx
#   collections/
#     Pages.ts
#   components/
#     RenderBlocks.tsx
#   payload.config.ts
#   payload-types.ts
```

The `(frontend)` and `(payload)` directories are route groups: their names organize the code without becoming part of the URL. The frontend group owns the homepage and single-segment page routes. The Payload group contains the admin and API routes, which should remain available when you add frontend routes.

`src/payload.config.ts` registers collections and other Payload settings. `src/payload-types.ts` is generated from that configuration; regenerate it after changing a collection or block rather than editing it by hand.

## Configure the project

`starter.config.ts` holds defaults shared by the frontend. Its initial shape is:

```ts
export const starterConfig = {
  siteName: '{{short}} Starter',
  siteUrl: process.env.SITE_URL,
  defaultLocale: 'en',
  trailingSlash: false,
}
```

The starter imports these values into its metadata helpers, page rendering and Next.js configuration. They do not replace settings in `src/payload.config.ts`.

| Field | Purpose |
| --- | --- |
| `siteName` | Default site name used by the metadata helpers. |
| `siteUrl` | Public origin used to build absolute metadata URLs. Set it through `SITE_URL` in deployed environments. |
| `defaultLocale` | Default language for frontend output. This does not enable Payload localization. |
| `trailingSlash` | Controls the corresponding Next.js routing setting. |

Set `SITE_URL` to the public origin for each environment. The [metadata guide]({{site}}/docs/guides/seo-metadata/) explains how the frontend uses it for canonical URLs and other metadata. Before releasing the site, follow the [deployment steps]({{site}}/docs/getting-started/first-deploy/) to configure environment variables and build the application.

> **Note:** `starter.config.ts` is application code, not content in Payload. Changing a value requires a new application build or restart; editors cannot change it from the admin panel.

## Follow a page request

The homepage route in `src/app/(frontend)/page.tsx` loads the home page record. The `[slug]` route loads a published page matching the requested slug. Both routes pass the page's layout to `RenderBlocks`, which chooses a React component for each saved block.

The page schema is defined in `src/collections/Pages.ts`. Its `layout` field registers the available block configurations. Each block's `config.ts` defines what editors can enter, while its `Component.tsx` defines how that data appears on the site.

Payload also exposes collection data through its API routes. Use the [API documentation]({{site}}/docs/reference/rest-api/) when consuming that data outside the frontend, and check collection access rules before assuming a record is publicly readable.

## Render the block library

`src/components/RenderBlocks.tsx` is the bridge between a saved layout and the React components. The generated `Page` type keeps the renderer aligned with the registered block schemas:

```tsx
import type { Page } from '@/payload-types'
import { Hero } from '@/blocks/Hero/Component'
import { RichText } from '@/blocks/RichText/Component'

type Block = NonNullable<Page['layout']>[number]

export function RenderBlocks({ blocks }: { blocks: Block[] }) {
  return blocks.map((block, index) => {
    const key = block.id ?? index

    switch (block.blockType) {
      case 'hero':
        return <Hero key={key} {...block} />
      case 'richText':
        return <RichText key={key} {...block} />
      default:
        return null
    }
  })
}
```

The `blockType` values must match the slugs in the block configurations. The fallback returns nothing for an unhandled block, so register a renderer whenever you add a schema. Stable block IDs are used as React keys when Payload supplies them.

## Add a block

Keep a block's editor fields and frontend component together under `src/blocks/`. To add one:

1. Create a directory under `src/blocks/` with a `config.ts` defining a Payload block and a `Component.tsx` rendering its fields.
2. Import the block configuration into `src/collections/Pages.ts` and add it to the `layout` field's block list. Give it a unique slug.
3. Run `npx payload generate:types` to update `src/payload-types.ts` from the registered schema.
4. Import the component into `RenderBlocks.tsx` and add a case for the new block slug.
5. Start the project with `npm run dev`, add the block to a page in the admin, and check the published page on the frontend.

Commit the schema, component, renderer change and regenerated types together. That keeps editor options and frontend rendering in step when another developer checks out the project.
