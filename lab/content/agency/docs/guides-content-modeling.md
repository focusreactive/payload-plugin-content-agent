Content modeling in {{short}} Starter defines what editors can enter and how that content becomes a page. The starter combines [Payload](https://payloadcms.com) collections with the [Next.js](https://nextjs.org) App Router: a page stores structured fields and an ordered list of blocks, while React components render those blocks. Use collection fields for information shared by every page and blocks for sections editors can add, remove, and reorder.

## Choose fields and blocks

The Pages collection is the starting point for page content. Its `layout` field is a Payload blocks field, so each entry in the list has a block type and the fields defined for that type. Keep fields such as a page title and slug on the collection; put content that belongs to a repeatable section in a block.

Before adding a block, decide what editors need to control. A callout might need a heading, short body, and visual tone. It does not need separate fields for every CSS class: those are presentation details that belong in the component.

The starter keeps block definitions and their components under `src/blocks/`. Collection configuration lives in `src/collections/Pages.ts`. The generator settings in `starter.config.ts` are separate from the Payload schema; changing that file alone does not add a field to an existing collection.

## Define a block

Create `src/blocks/Callout/config.ts` with a Payload block definition:

```ts
import type { Block } from 'payload'

export const Callout: Block = {
  slug: 'callout',
  interfaceName: 'CalloutBlock',
  fields: [
    {
      name: 'heading',
      type: 'text',
      required: true,
    },
    {
      name: 'body',
      type: 'textarea',
      required: true,
    },
    {
      name: 'tone',
      type: 'select',
      required: true,
      defaultValue: 'neutral',
      options: [
        { label: 'Neutral', value: 'neutral' },
        { label: 'Information', value: 'info' },
        { label: 'Warning', value: 'warning' },
      ],
    },
  ],
}
```

These fields control both the editing form and the stored block data:

| Field | Purpose | Behavior |
| --- | --- | --- |
| `heading` | Short callout title | Required text |
| `body` | Supporting message | Required multiline text |
| `tone` | Presentation choice | Required select, defaulting to `neutral` |
| `blockType` | Identifies the block when rendering | Supplied by Payload from the block slug |

Choose the slug carefully. Payload stores it as `blockType`, so changing `callout` later also requires updating existing content or handling the old value during a transition.

## Register and render the block

Add the definition to the Pages collection, then connect it to a component. Follow these steps:

1. Import `Callout` from `src/blocks/Callout/config.ts` into `src/collections/Pages.ts`.
2. Add `Callout` to the `blocks` array on the `layout` field, keeping the existing block definitions in that array.
3. Regenerate Payload types so the new block is included in `src/payload-types.ts`.
4. Create the component below in `src/blocks/Callout/Component.tsx`.
5. Add a `callout` case to `src/blocks/RenderBlocks.tsx` that renders `CalloutComponent` with the stored block fields.

```tsx
import type { CalloutBlock } from '@/payload-types'

export function CalloutComponent({
  heading,
  body,
  tone,
}: CalloutBlock) {
  return (
    <aside className="callout" data-tone={tone}>
      <h2>{heading}</h2>
      <p>{body}</p>
    </aside>
  )
}
```

The renderer should select components using `blockType`, not the block’s position in the layout. Preserve the existing cases when adding the new one. Add styles for the `data-tone` values in the application’s stylesheets; the schema supplies the choice, but it does not provide the visual treatment.

From the project root, regenerate types and start the development server:

```bash
npm run generate:types
npm run dev
```

In the Payload admin, open a page, add a Callout block, and save it. Check the rendered page as well as the editing form: a block registered only in Payload can be saved without appearing on the site if its renderer case is missing.

## Evolve content safely

Treat schema changes as changes to stored content, not just form changes. Adding an optional field is usually less disruptive than making a new field required on blocks that editors have already saved. A default value helps with new entries, but do not assume it has populated every existing document.

Before removing or renaming a field, identify the content that uses it and plan a data migration. Update the renderer and generated types alongside the schema, then test pages containing both old and new content. Keep the old rendering path until the stored data has been migrated.

> **Note:** Regenerating TypeScript types updates the code’s view of the schema; it does not migrate existing content in the database.

## Prepare for deployment

Once the block works locally, commit its schema, component, renderer change, and generated types together. Test a page with more than one block and reorder the blocks to confirm that the displayed order follows the editor’s layout.

When the schema is ready for the target environment, follow the guide to [deploy the starter]({{site}}/docs/getting-started/first-deploy/). For generator commands and flags, consult the [CLI options]({{site}}/docs/reference/cli/). If a page needs restricted access, use the recipe to [add password protection]({{site}}/docs/recipes/protect-a-page/) rather than treating an unpublished or obscure URL as access control.
