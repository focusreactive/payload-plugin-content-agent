Install {{short}} Starter to run a Next.js App Router site and Payload CMS from one TypeScript project. The starter includes a page collection, a block-based page editor and the components that render those blocks. This guide takes you from an empty directory to a local site with your first administrator account.

## Before you begin

You need Node.js 22 LTS, npm and access to a PostgreSQL 15 or later database. The database can run on your machine or on a development server. Have its connection string ready, and use a database dedicated to this project: the starter creates its own tables during development.

You should also be comfortable running commands in a terminal and editing environment variables. The generated application uses [Next.js](https://nextjs.org) for routing and rendering, with [Payload](https://payloadcms.com) providing the admin interface and content API.

## Create the project

1. Run the CLI from the directory where you want the project folder to be created. The command generates the files but leaves dependency installation to you.

   ```bash
   npx create-headless-starter my-site
   cd my-site
   npm install
   cp .env.example .env
   ```

   The generated `my-site` directory contains the application, Payload configuration and starter settings. Use a different directory name in the first command if you prefer; the remaining commands should be run from that directory.

2. Open `.env` and set `DATABASE_URI` to your PostgreSQL connection string. Set `PAYLOAD_SECRET` to a long, random value. You can generate one with:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Copy the output into `PAYLOAD_SECRET`. Keep `.env` out of version control and use a different secret for each deployed environment.

3. Run `npm run dev`. On the first run, the development database adapter creates the tables required by the generated collections. The terminal prints the local address when the server is ready.

4. Open the local address shown in the terminal and visit the `/admin` route. Create the first administrator account when prompted. Then create a page, add a block and save it to confirm that the editor and database are working.

> **Note:** Automatic schema updates are enabled for local development only. Treat the development database as disposable, and use reviewed database migrations when deploying changes to an existing environment.

## Configure the starter

The project reads `starter.config.ts` when it builds the Payload configuration and the page renderer. Start with the generated defaults, then change the site name or the blocks available to editors.

```ts
import { defineStarterConfig } from './src/starter/defineStarterConfig'

export default defineStarterConfig({
  siteName: 'Editorial',
  defaultLocale: 'en',
  blocks: ['hero', 'richText', 'callToAction'],
})
```

| Option | Purpose | Default |
| --- | --- | --- |
| `siteName` | Name used in the admin interface and default page metadata. | `Editorial` |
| `defaultLocale` | Locale used for content and HTML language attributes. | `en` |
| `blocks` | Block types available in the page editor. | `hero`, `richText`, `callToAction` |
| `navigationDepth` | Maximum number of nested navigation levels in the admin editor. | `2` |

Restart the development server after changing this file so that both the admin schema and the renderer use the same settings. Changing `blocks` controls which registered blocks editors can add; it does not remove block data already saved in the database. Before removing a block type, update pages that use it and check their rendered output.

## Work with page blocks

Block definitions and their React components live in `src/blocks/`. Each block has a Payload definition for its fields and a component that renders the saved data. For example, the generated `hero` block contains a heading and optional link fields, while `richText` is intended for longer editorial content.

The page collection stores blocks in an ordered layout field. Editors can add, reorder and remove them in Payload; the App Router page reads that layout and renders the corresponding components in order. A newly created page will not have a useful layout until an editor adds content.

To add a block, create its definition and component under `src/blocks/`, register it in the generated block registry, and add its key to the `blocks` array in `starter.config.ts`. Keep the registry key consistent across the configuration and renderer. After restarting the server, check the block in the admin editor and on a published page.

## Check the installation

Create a page with a slug and at least one block, then publish it. Visit the matching route on the local site and confirm that the content appears. If the admin interface loads but saving fails, check the terminal output and verify that `DATABASE_URI` points to a database your user can write to.

If the server fails before it is ready, check the Node.js version and confirm that both required environment variables are set. After editing `.env`, stop and restart `npm run dev`; changes to server environment variables are not applied to an already running process.

## Next steps

When the local site is working, follow the guide to [prepare your first deployment]({{site}}/docs/getting-started/first-deploy/), including its environment and migration checks. To serve content in another language, learn how to [add a locale]({{site}}/docs/recipes/add-a-locale/). If you are bringing an existing 2.x project forward instead of starting fresh, read the instructions for [upgrading to version 3]({{site}}/docs/guides/upgrading-to-3/).
