Deploying {{short}} Starter puts your [Next.js](https://nextjs.org) site and [Payload](https://payloadcms.com) admin in the same application. This guide uses PostgreSQL for content and S3-compatible object storage for uploads, so both survive application restarts. You will create a project, configure its production environment, run database migrations and publish the application on a Node.js host.

## Create the project

Generate a project with the PostgreSQL and S3 storage adapters selected:

```bash
npx create-headless-starter my-site --database postgres --storage s3
cd my-site
npm install
```

The command creates a TypeScript project with the Next.js App Router, Payload configuration and a set of page blocks in `src/blocks/`. It also includes the initial database migration. Commit the generated files, including the migration files, to your repository before connecting it to a host.

The starter includes a page collection and a block-based layout field. Editors can assemble pages from the supplied blocks; see the [available block fields]({{site}}/docs/reference/blocks/) before changing the page structure.

## Configure the application

Open `starter.config.ts` and set the production options. This example reads the public site origin from an environment variable and enables the storage adapter selected during setup.

```ts
import { defineStarterConfig } from './src/starter'

export default defineStarterConfig({
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  database: 'postgres',
  media: {
    adapter: 's3',
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION,
  },
})
```

Use the public origin of the deployed site for `NEXT_PUBLIC_SITE_URL`, without a trailing slash. The starter uses it when generating absolute URLs. Set it to your preview origin in a preview environment and to your production origin in production.

Keep credentials out of `starter.config.ts` and out of your repository. The generated adapter reads the database and storage credentials from the environment at runtime.

## Set environment variables

Create a PostgreSQL database and an S3-compatible bucket before deploying. Give the storage credentials access to that bucket, and configure public read access for published media through your storage provider. The application needs a stable public media URL so browsers can load images.

Add these variables to your hosting provider’s production environment:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public origin used for absolute site URLs |
| `DATABASE_URI` | PostgreSQL connection string, including the database name |
| `PAYLOAD_SECRET` | Long, random secret used by Payload to sign tokens |
| `S3_BUCKET` | Bucket name for uploaded media |
| `S3_REGION` | Region used by the storage adapter |
| `S3_ENDPOINT` | S3-compatible API endpoint; omit it when using Amazon S3 |
| `S3_ACCESS_KEY_ID` | Access key for the bucket |
| `S3_SECRET_ACCESS_KEY` | Secret key paired with the access key |
| `S3_PUBLIC_URL` | Public base URL from which uploaded files are served |

Generate a unique `PAYLOAD_SECRET` of at least 32 characters for each environment. Make sure the host can connect to the database and storage endpoint, including any network allowlists required by your providers.

> **Note:** Use a separate database and bucket for previews. Running a preview against production resources can change published content or overwrite media.

## Deploy and initialize

Choose a Node.js host that can run a Next.js application, provide the environment variables above and execute a release command. The application process must be able to reach PostgreSQL and the storage service.

1. Connect your repository to the host and select the branch you want to deploy.
2. Add the production environment variables to the host. Make them available to both the build and the running application.
3. Configure the release process to run the committed Payload migrations against the production database before serving the new version.
4. Build the application and start it using the host’s Node.js process settings.
5. Open `/admin` on your deployed site and create the first admin user. Do this promptly: a fresh installation allows the first user to be created through the admin screen.

The generated project provides the following commands. Run the migration with production environment variables in a controlled release step; do not run it from a developer shell pointed at an unintended database.

```bash
npm run payload -- migrate
npm run build
npm run start
```

For later schema changes, generate and commit a migration during development, then apply it in the release step before the updated application starts. Back up the production database before applying migrations to an existing site.

## Check the published site

In the admin panel, create a page, add a block and publish it. Open the corresponding page on the public site and confirm that its content renders. Upload an image, add it to the page and check that it loads in a browser; this verifies the bucket configuration as well as the application.

If the build fails, check that the environment variables are available during the build, not just at runtime. If the site starts but content is missing, check the database connection and migration output. For missing images, check the bucket permissions and `S3_PUBLIC_URL`.

Once the first page works, you can [configure locales]({{site}}/docs/guides/localization/) for a multilingual site or [add password protection to a page]({{site}}/docs/recipes/protect-a-page/) before sharing restricted content.
