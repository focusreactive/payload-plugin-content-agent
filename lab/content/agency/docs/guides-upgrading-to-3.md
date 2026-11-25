{{short}} Starter 3.x reorganizes configuration and block registration while keeping the Next.js App Router and Payload CMS at the center of the project. This guide covers an upgrade of an existing 2.x site, including its content and custom blocks. Work in a branch and test against a copy of your production database before deploying.

## Before you begin

Record the versions of [Next.js](https://nextjs.org) and [Payload](https://payloadcms.com) used by your current project. The 3.x starter may bring newer versions of both, so review their upgrade requirements alongside the starter changes. Do not assume that updating the starter alone upgrades your application code or database schema.

Back up the database and uploaded media separately. A database backup may contain references to files without containing the files themselves. Keep a copy of your 2.x lockfile and configuration so you can reproduce the previous build if you need to roll back.

> **Note:** Do not run migration commands against production during the initial upgrade. Generate and review migrations locally, then test them on a restored database before scheduling deployment.

## Create a clean 3.x project

Use a fresh starter as the reference for generated files and dependencies. The CLI prompts for a project directory:

```bash
npx create-headless-starter
```

Choose an empty directory rather than your existing repository. Then follow these steps:

1. Compare the generated `package.json` and lockfile with your 2.x versions. Bring over the dependency changes, retaining packages your application still needs.
2. Compare the generated App Router and Payload configuration files with your own. Preserve custom routes, access rules, collections and plugins.
3. Move your starter settings into the 3.x shape described below. Remove the old keys after checking where they are used.
4. Update custom block definitions and rendering registrations. Keep existing block slugs unless you have planned a content migration.
5. Build and test against a restored database and a copy of your media. Review any schema migrations before applying them to staging.

Copy changes selectively. Replacing the entire application directory can remove project-specific behavior, including redirects, authentication and editorial workflows.

## Update starter configuration

In 3.x, `starter.config.ts` groups related settings instead of keeping them at the top level. The following example enables two blocks and uses the site URL from the environment:

```ts
const config = {
  site: {
    url: process.env.NEXT_PUBLIC_SITE_URL!,
  },
  api: {
    basePath: '/api',
  },
  blocks: ['hero', 'richText'],
  images: {
    remoteHosts: [],
  },
}

export default config
```

Set `NEXT_PUBLIC_SITE_URL` in each deployment environment before building. Check the generated project’s required values against your existing secrets and the guide to [setting variables for each environment]({{site}}/docs/getting-started/environment-variables/). Do not commit secrets to the repository.

| 2.x field | 3.x field | Upgrade action |
| --- | --- | --- |
| `siteUrl` | `site.url` | Move the public site URL into `site`. |
| `apiPath` | `api.basePath` | Preserve your existing API path if clients depend on it. |
| `enabledBlocks` | `blocks` | Move the list of enabled block slugs. |
| `imageHosts` | `images.remoteHosts` | Move allowed remote image hostnames into `images`. |

An empty `images.remoteHosts` list does not allow remote image hosts. Add only the hosts your site needs, and check the generated Next.js image configuration as well. For the handling of uploaded and remote assets, see [working with images]({{site}}/docs/guides/image-handling/).

## Move and register blocks

Blocks live in `src/blocks/` in 3.x. The generated project places each block’s Payload definition and React component together, with the rendering registry in `src/blocks/index.tsx`. Compare that registry with your 2.x block renderer and add an entry for every custom block that editors can use.

The `blocks` array in `starter.config.ts` controls which registered starter blocks are enabled; adding a slug there does not create its Payload fields or its React component. Carry over both parts of each custom block and update imports to their new locations. Also check any shared field definitions and generated Payload types.

Keep stored slugs and field names stable where possible. Renaming a component file is different from renaming a Payload block slug: existing documents contain the stored slug, and a renderer that only recognizes the new value cannot render old content. If a schema change is necessary, write and test a data migration before removing support for the old shape.

## Verify the upgrade

Install dependencies using the package manager and lockfile you selected, then run a production build and start the development server. For a project using npm:

```bash
npm install
npm run build
npm run dev
```

Open representative pages containing each block, including pages with optional fields left empty. Test editing and publishing in Payload, preview behavior, redirects and media uploads. Compare rendered pages with the 2.x site rather than relying on a successful build alone.

Check integrations that read or write content through the API. Confirm their paths, authentication and expected field shapes using the [request and response details]({{site}}/docs/reference/rest-api/). A block schema change can affect consumers even when the API base path stays the same.

Once staging passes these checks, deploy the application and reviewed database migrations together. Keep the database and media backups until the new release has been verified, and retain the 2.x build so you can restore it if the deployment needs to be reversed.
