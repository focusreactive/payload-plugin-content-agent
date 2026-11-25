Blocks define the sections editors can add to a page in {{short}} Starter. Each block has a Payload schema and a React component: the schema controls the editing form, while the component controls the rendered output. Blocks live in `src/blocks/` and are stored in the order editors arrange them in the page’s `layout` field.

## How blocks fit together

The starter registers its page blocks in the Pages collection and renders them through a shared `RenderBlocks` component. Payload stores each entry with a `blockType` discriminator, which the renderer uses to select the corresponding React component.

The initial scaffold includes Hero and Rich Text blocks. Your project’s `starter.config.ts` records starter configuration, but changing it does not automatically register a new block in an existing Pages collection. Update the Payload schema and renderer together.

[Payload](https://payloadcms.com) manages the block fields and editor interface. The [Next.js](https://nextjs.org) App Router renders the resulting page. A block is content within a page, not a separate route.

## Hero fields

The Hero block is intended for an introduction at the top of a page, although editors can place it elsewhere. Its schema is in `src/blocks/Hero/config.ts`:

```ts
import type { Block } from 'payload'

export const Hero: Block = {
  slug: 'hero',
  fields: [
    { name: 'eyebrow', type: 'text' },
    { name: 'heading', type: 'text', required: true },
    { name: 'body', type: 'textarea' },
    {
      name: 'cta',
      type: 'group',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'href', type: 'text', required: true },
      ],
    },
  ],
}
```

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `eyebrow` | text | No | Short text displayed above the heading |
| `heading` | text | Yes | Main heading for the section |
| `body` | textarea | No | Supporting copy below the heading |
| `cta.label` | text | Within the CTA group | Text displayed on the link |
| `cta.href` | text | Within the CTA group | Destination for the link |

The Hero component renders the CTA only when both its label and destination are present. Keep link destinations consistent with your site’s routing conventions. The schema above accepts text; add validation if your project needs to restrict destinations.

> **Note:** A required heading ensures the field is present in saved content; it does not guarantee that a page has exactly one top-level heading. Establish heading-level conventions across your block components.

## Register blocks with Payload

The Pages collection declares which blocks editors may insert. This example registers the Hero and the starter’s Rich Text block in `src/collections/Pages.ts`:

```ts
import type { CollectionConfig } from 'payload'
import { Hero } from '../blocks/Hero/config'
import { RichText } from '../blocks/RichText/config'

export const Pages: CollectionConfig = {
  slug: 'pages',
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true },
    {
      name: 'layout',
      type: 'blocks',
      blocks: [Hero, RichText],
    },
  ],
}
```

Each block’s `slug` must be unique within the `layout` field. Payload saves that slug as `blockType`; changing it after content exists requires a data migration as well as a code change.

The collection shown here is deliberately small. Your project can add draft settings, access rules and other page fields without changing the block registration pattern. If you are [moving an existing project from version 2 to version 3]({{site}}/docs/guides/upgrading-to-3/), review its migration steps before changing stored block types.

## Render the layout

The starter’s renderer maps each registered block type to a component. This example uses the generated `Page` type and the block components in `src/blocks/`:

```tsx
import type { Page } from '../payload-types'
import { HeroBlock } from '../blocks/Hero/Component'
import { RichTextBlock } from '../blocks/RichText/Component'

export function RenderBlocks({ layout }: { layout: Page['layout'] }) {
  return (
    <>
      {layout?.map((block, index) => {
        const key = block.id ?? index

        switch (block.blockType) {
          case 'hero':
            return <HeroBlock key={key} {...block} />
          case 'richText':
            return <RichTextBlock key={key} {...block} />
          default:
            return null
        }
      })}
    </>
  )
}
```

Pass the fetched page’s `layout` to `RenderBlocks` from the page route. The optional mapping handles pages with no layout entries. The fallback returns nothing for an unrecognised type, so check both registration and rendering if a block appears in the editor but not on the site.

The generated block ID provides a stable React key when present. The array index is a fallback for entries without an ID.

## Add and test a block

1. Create a directory under `src/blocks/` with a Payload block configuration and a React component. Give the block a unique slug and define every field the component needs.
2. Import the configuration into the Pages collection and add it to the `layout` field’s `blocks` array.
3. Add a matching case to `RenderBlocks`, then run `npx payload generate:types` to update the TypeScript definitions.
4. Apply your project’s database migration process if the schema change requires it. For a project using Payload migrations, create and review a migration with `npx payload migrate:create` before applying it.
5. Add the block to a test page, save it and check both the editor and the rendered route. Test empty optional fields as well as populated ones.

Block components should render the data they receive; they should not bypass the page’s access rules. For restricted content, follow the recipe for [adding password protection to a page]({{site}}/docs/recipes/protect-a-page/). To check editing changes before publishing, configure [preview updates for editors]({{site}}/docs/guides/live-preview/) and test the new block there too.
