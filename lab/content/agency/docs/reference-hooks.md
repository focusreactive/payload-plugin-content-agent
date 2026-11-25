Hooks let you run server-side code around block resolution in a {{short}} Starter project. Use them for tasks such as logging which blocks a request resolves, or use Payload’s collection hooks to respond to content changes. Starter hooks and Payload hooks are separate: the former run when a page is requested, while the latter run during CMS operations.

## Hook locations

Configure Starter hooks in `starter.config.ts`. The generated page renderer reads that file and calls the hooks as it resolves blocks from `src/blocks/`. Each hook receives the current block and request context; neither requires changes to an individual block component.

Payload collection hooks belong in the Payload collection configuration. They do not run through the Starter hook configuration. For the underlying CMS APIs, see the [Payload documentation](https://payloadcms.com); for the server rendering and cache APIs used by the starter, see the [Next.js documentation](https://nextjs.org).

The Starter hooks run on the server, including for draft previews. They do not run again when a client component updates in the browser. Avoid using them for browser analytics or work that depends on a component having mounted.

## Starter hook fields

The generated `defineStarterConfig` helper provides types for the configuration and hook arguments. All hooks are optional.

| Field | Type | Purpose |
| --- | --- | --- |
| `hooks.beforeBlockResolve` | Function | Receives a block before component lookup and returns the block to resolve. |
| `hooks.afterBlockResolve` | Function | Runs after the block component has returned an element. Its return value is ignored. |
| `block.blockType` | String | Identifies the registered block component. |
| `context.pathname` | String | Contains the requested pathname without the query string. |
| `context.preview` | Boolean | Indicates whether the request is using draft preview. |

Both hooks may be asynchronous. `beforeBlockResolve` must return a block, even if it makes no changes. Preserve `blockType` and the fields required by that block’s schema; the resolver uses `blockType` to select a component and does not validate hook output. `afterBlockResolve` receives the block returned by the before hook and the same context.

The after hook signals that the component has returned an element, not that the response has finished streaming or that a browser has displayed it. If a hook throws, resolution stops and the error propagates to the route’s error handling. The starter does not retry hooks.

## Configure a hook

This example records each resolved block without changing its content. The helper import is relative to the config file at the project root.

```ts
import { defineStarterConfig } from './src/starter/define-config'

export default defineStarterConfig({
  hooks: {
    beforeBlockResolve: async ({ block, context }) => {
      if (context.preview) {
        console.info('Resolving preview block', block.blockType)
      }

      return block
    },
    afterBlockResolve: async ({ block, context }) => {
      console.info('Resolved block', block.blockType, context.pathname)
    },
  },
})
```

The hooks run once per block, in page order. For each block, the before hook completes before component lookup, and the after hook runs only if the component resolves successfully. Keep per-block work inexpensive: a slow network call in either hook adds latency to page rendering.

> **Note:** Hook context is request-specific. Do not store it in a module-level variable or use it to share state between requests.

To try the configuration in a new project:

1. Create a project with the starter CLI:

   ```bash
   npx create-headless-starter my-project
   cd my-project
   ```

2. Configure the environment variables described in the generated project’s `.env.example`, then install dependencies and start the development server using the commands in its README.
3. Add the configuration above, request a page containing blocks, and check the server logs. Open the page in preview to see the additional before-hook message.
4. Add or change a block using the [block authoring recipe]({{site}}/docs/recipes/add-a-block/). Registering a block makes it available to the resolver; hooks do not register components.

## Revalidate after content changes

A Payload `afterChange` hook is a suitable place to invalidate a rendered path when an editor saves a page. In the generated starter, attach the following function to the Pages collection’s `hooks.afterChange` array. This example assumes a top-level `slug` field and a `home` slug for the root page.

```ts
import { revalidatePath } from 'next/cache'
import type { CollectionAfterChangeHook } from 'payload'

export const revalidatePage: CollectionAfterChangeHook = ({ doc }) => {
  const path = doc.slug === 'home' ? '/' : `/${doc.slug}`

  revalidatePath(path)
  return doc
}
```

This invalidates the current slug’s path; it does not invalidate an old path after a slug change, nested routes, or other pages that reference the document. Extend the hook for those cases using your project’s routing rules. It also runs for draft saves, so decide whether that behavior suits your publishing workflow.

The example assumes Payload and the Next.js frontend run in the same application and can use the same Next.js cache. If they are deployed separately, use a deployment-specific invalidation mechanism instead. Review the [deployment walkthrough]({{site}}/docs/getting-started/first-deploy/) before relying on cache behavior in production.

## Upgrading hook code

Starter hook signatures are part of the generated project, so check `src/starter/define-config` when upgrading. Keep custom hook code in separate files if it is shared across configurations, and test both published and preview requests after an upgrade.

Projects moving from an earlier major version should follow the [migration guide for version 3]({{site}}/docs/guides/upgrading-to-3/) before copying examples into an existing config. In particular, verify the block shape and request context against the types installed in that project rather than assuming an older hook receives the same arguments.
