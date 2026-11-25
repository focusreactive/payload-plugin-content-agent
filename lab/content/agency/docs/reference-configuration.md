{{short}} Starter uses `starter.config.ts` to configure the site address, available page blocks and preview behavior in one place. The file connects the starter’s [Next.js App Router application](https://nextjs.org) with its [Payload CMS installation](https://payloadcms.com); it does not replace either framework’s own configuration files. The settings below apply to projects created with `npx create-headless-starter`.

## Configuration file

Place `starter.config.ts` at the project root, alongside `package.json`. The starter loads it when the application starts and checks its values before initializing Payload. The generated project includes a `StarterConfig` type, so TypeScript can flag misspelled properties and incompatible values.

A typical configuration looks like this:

```ts
import type { StarterConfig } from './src/lib/starter/types'
import { Hero } from './src/blocks/Hero/config'
import { RichText } from './src/blocks/RichText/config'

const config = {
  siteUrl: process.env.SITE_URL ?? '',
  blocks: [Hero, RichText],
  preview: {
    enabled: true,
    allowedOrigins: [process.env.SITE_URL ?? ''],
    secretEnv: 'PREVIEW_SECRET',
  },
} satisfies StarterConfig

export default config
```

The configuration is server-side code. It can read environment variables, but do not import it into a client component or put secrets directly in the file. The starter reads the secret from the environment when preview is requested.

## Options

The starter validates these properties at startup. An invalid required value stops initialization with an error identifying the property.

| Option | Type | Description |
| --- | --- | --- |
| `siteUrl` | `string` | Required absolute origin used for canonical URLs and preview links. Do not include a path or trailing slash. |
| `blocks` | `Block[]` | Required ordered array of Payload block definitions available in the Pages layout field. |
| `preview.enabled` | `boolean` | Enables the starter’s draft preview route when `true`. |
| `preview.allowedOrigins` | `string[]` | Origins permitted to receive preview messages. Each entry must be an absolute origin without a path. |
| `preview.secretEnv` | `string` | Name of the server environment variable containing the preview secret. |

When preview is disabled, the starter does not require a preview secret. Keep `allowedOrigins` limited to the origins where editors actually open the site. Adding an origin does not make the site public; it controls which origins can participate in the starter’s preview messaging.

`siteUrl` should match the public origin for the current environment. Set it separately for local development, staging and production rather than committing an environment-specific value to the repository. If a deployment uses a custom domain, update `SITE_URL` for that deployment and restart the application.

## Registering blocks

Each entry in `blocks` is a Payload block definition. The starter uses the array to populate the Pages collection’s layout field, in the order shown in the editor. Definitions live under `src/blocks/`; their `slug` values must be unique because saved page content identifies its block type by slug.

For example, `src/blocks/Hero/config.ts` can define a simple hero:

```ts
import type { Block } from 'payload'

export const Hero: Block = {
  slug: 'hero',
  fields: [
    {
      name: 'heading',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
  ],
}
```

A block definition controls the fields editors can enter, not how the block is rendered. Add a corresponding component to the starter’s block renderer before publishing pages that use a new block. The guide to [working with block definitions and renderers]({{site}}/docs/reference/blocks/) covers that mapping.

Removing a block from the configuration prevents editors from adding it to new layouts. It does not automatically remove existing instances from saved pages. Migrate or remove those instances before deleting the definition and renderer, or affected pages may no longer render correctly.

## Preview settings

With `preview.enabled` set to `true`, the starter provides a draft preview route and uses `siteUrl` to construct links to it. `preview.secretEnv` is the name of an environment variable, not the secret itself. In the example, the application reads the value of `PREVIEW_SECRET` on the server.

Use a long, randomly generated secret and supply the same value to every application instance in an environment. Rotate it through your deployment’s secret store, then restart all instances. Editors with an older preview link may need to open a new one after rotation.

> **Note:** The preview secret protects access to draft content. Never prefix it with `NEXT_PUBLIC_`, add it to client-side code or commit it to version control.

For editor setup and the message flow between the admin interface and the site, see [how to enable draft updates]({{site}}/docs/guides/live-preview/).

## Applying changes

After creating a project, follow these steps to configure and run it:

1. Create the project and install its dependencies, following the [project setup instructions]({{site}}/docs/getting-started/installation/) if you need the prerequisites.
2. Set `SITE_URL` and `PREVIEW_SECRET` in your local environment. For a deployment, add them through the hosting provider’s environment settings instead.
3. Edit `starter.config.ts` and register the blocks your pages need.
4. Start the application, then open the Pages editor and confirm that the layout field lists the registered blocks.

For example, a shell session using the generated npm scripts can start a new project as follows:

```bash
npx create-headless-starter my-site --skip-install
cd my-site
npm install
export SITE_URL="{{site}}"
export PREVIEW_SECRET="$(openssl rand -hex 32)"
npm run dev
```

The exported values last only for that shell session. Restart the development server after changing configuration or environment values so the starter loads and validates them again. Before deploying a block change, test an existing page as well as a newly created one; both need a renderer that recognizes their saved block types.
