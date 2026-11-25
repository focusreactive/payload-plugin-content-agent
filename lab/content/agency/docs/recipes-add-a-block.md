{{short}} Starter combines [Next.js](https://nextjs.org) App Router with [Payload CMS](https://payloadcms.com), TypeScript, and a library of page blocks. This recipe adds a feature intro block: editors enter an optional eyebrow and a required heading, and the page renderer displays them. You will define the Payload fields, create a React component, and register both in `starter.config.ts`.

## Plan the block

Blocks are stored as items in a page’s `layout` field. Each item has a `blockType` that identifies its schema and renderer. Give the new block a unique slug and keep it stable after editors start using it.

1. Create a folder for the block under `src/blocks/`.
2. Define its fields in a Payload block schema.
3. Create a component that accepts the saved field values.
4. Add the schema and component to the starter configuration.
5. Create a page in the admin, add the block, and check the rendered result.

If you are unfamiliar with the starter’s directories, read [how the project is organized]({{site}}/docs/getting-started/project-structure/) before making changes.

## Define the fields

Create `src/blocks/FeatureIntro/schema.ts`:

```ts
import type { Block } from 'payload'

export const FeatureIntroBlock: Block = {
  slug: 'featureIntro',
  labels: {
    singular: 'Feature intro',
    plural: 'Feature intros',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
    },
    {
      name: 'heading',
      type: 'text',
      required: true,
    },
  ],
}
```

Payload uses the schema to build the editing form and validate saved content. The following properties determine how this block is identified and edited:

| Property | Purpose | Value in this recipe |
| --- | --- | --- |
| `slug` | Identifies the block in stored page data | `featureIntro` |
| `labels` | Names the block in the admin interface | Feature intro and Feature intros |
| `eyebrow` | Provides optional text above the heading | A text field |
| `heading` | Provides the main visible heading | A required text field |
| `blockType` | Records which block schema an item uses | Set by Payload from the slug |

`blockType` is not a field you need to add to the schema. Payload includes it in each saved block item so the starter can select the corresponding renderer.

For more on the starter’s block conventions, see [the field and rendering reference]({{site}}/docs/reference/blocks/).

## Create the renderer

Create `src/blocks/FeatureIntro/Component.tsx`:

```tsx
type FeatureIntroProps = {
  eyebrow?: string | null
  heading: string
}

export function FeatureIntro({ eyebrow, heading }: FeatureIntroProps) {
  return (
    <section>
      {eyebrow && <p>{eyebrow}</p>}
      <h2>{heading}</h2>
    </section>
  )
}
```

The component receives the saved fields as props. The optional eyebrow can be absent or `null`, so it is rendered only when it has a value. The heading is required by the schema and is rendered as an `h2`.

Use an `h2` here because the starter’s page template supplies the page-level `h1`. If your page design needs a different heading hierarchy, change the component to match the surrounding content. React renders these text values as text rather than interpreting editor input as HTML.

## Register the block

Add the block to `starter.config.ts` at the project root. Keep the built-in entries in the array so existing pages can continue to render them:

```ts
import { defineStarterConfig } from '@/starter/defineStarterConfig'
import { builtInBlocks } from '@/blocks/registry'
import { FeatureIntroBlock } from '@/blocks/FeatureIntro/schema'
import { FeatureIntro } from '@/blocks/FeatureIntro/Component'

export default defineStarterConfig({
  blocks: [
    ...builtInBlocks,
    {
      slug: 'featureIntro',
      schema: FeatureIntroBlock,
      Component: FeatureIntro,
    },
  ],
})
```

The starter reads this list when it builds the Pages collection’s block field and when it selects a component to render each saved item. The registration slug must match the schema slug and the saved `blockType`. A mismatch can leave a block available in the editor but without a matching renderer.

Restart the development server after changing the configuration. This ensures the admin form and page renderer both load the updated registry.

> **Note:** Changing or removing a slug after pages have been saved does not rename their existing `blockType` values. Plan a content migration before changing a slug on a site with published pages.

## Verify the result

In the Payload admin, open a page and add **Feature intro** to its layout. Enter “Explore the collection” as the heading, leave the eyebrow empty, and save. Open the page and confirm that the heading appears without an empty paragraph above it. Then add an eyebrow, save again, and confirm that both values appear.

Also check an existing page that uses a built-in block. This catches accidental removal of the `builtInBlocks` entries during registration. If the new block does not appear in the editor, check the schema import and restart the server. If it appears in the editor but not on the page, check that the registration slug matches `featureIntro`.

The fields in this example are shared across locales. If each locale needs its own text, enable localization for the relevant fields and follow [the localization setup]({{site}}/docs/guides/localization/) before entering translated content.
