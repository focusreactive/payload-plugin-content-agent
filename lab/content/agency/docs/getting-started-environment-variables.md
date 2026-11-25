Environment variables connect {{short}} Starter to its database, protect Payload sessions and tell the site which public URL to use. Keep local values in the project root and set production values in your hosting platform. The starter reads these settings on the server, except for variables prefixed with `NEXT_PUBLIC_`, which [Next.js](https://nextjs.org) can include in browser code.

## Before you start

Complete the [installation steps]({{site}}/docs/getting-started/installation/) and create a project with `npx create-headless-starter`. The examples on this page assume you chose npm and are working in the generated project directory.

The starter uses PostgreSQL for its [Payload](https://payloadcms.com) database. Have a local database ready before starting the app. The example below assumes a database named `starter` and a local user named `starter` with access to it. Change the connection string if your database uses different credentials, a different port or a hosted service.

You also need OpenSSL to generate a secret in the setup steps below. If it is not available on your machine, generate a cryptographically secure random value with another tool and add it to the file yourself.

## Create your local environment file

1. Check whether the project already has a `.env` file. If it does, edit that file instead of running the command below, which would overwrite it.
2. From the project root, create `.env` with the local database settings and a newly generated secret:

   ```bash
   cat > .env <<EOF
   DATABASE_URI=postgresql://starter:starter@localhost:5432/starter
   PAYLOAD_SECRET=$(openssl rand -hex 32)
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   EOF
   ```

3. Check that the database connection string matches your PostgreSQL instance. If you already had a `.env` file, add the missing variables and generate a unique secret with `openssl rand -hex 32`.
4. Start the app and visit the local URL shown in the terminal:

   ```bash
   npm run dev
   ```

The `.env` file is local configuration, not a shared source of credentials. The generated project ignores it in Git. Restart the development server after changing a value so the app reads the updated settings.

> **Note:** Use a different `PAYLOAD_SECRET` for each environment. Changing an existing environment’s secret can invalidate Payload sessions, so plan the change for a time when users can sign in again.

## Available variables

The starter reads the following variables. Required values must be set in every environment where the app runs.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URI` | Yes | PostgreSQL connection string used by the Payload database adapter. |
| `PAYLOAD_SECRET` | Yes | Secret used by Payload for security-sensitive operations. Generate a long, random value. |
| `NEXT_PUBLIC_SITE_URL` | Yes | Public origin used by the starter when constructing absolute site URLs. |
| `NEXT_TELEMETRY_DISABLED` | No | Set to `1` to disable Next.js anonymous telemetry. |

For local work, `NEXT_PUBLIC_SITE_URL` should match the origin you use to browse the site. In production, set it to the canonical public origin, including the protocol and without a trailing slash. Do not include a page path.

The database URI and Payload secret must remain server-only. Never add the `NEXT_PUBLIC_` prefix to either variable, put them in a page block or copy them into content. Blocks in `src/blocks/` can consume public configuration where needed; see the [available blocks]({{site}}/docs/reference/blocks/) for their content fields.

## How the site URL is used

The generated `starter.config.ts` exposes the public site URL to the starter’s site configuration:

```ts
const starterConfig = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
}

export default starterConfig
```

The fallback makes local development convenient, but production builds should always receive an explicit value. The starter uses `siteUrl` when it needs an absolute origin, including for metadata. Set the public URL before building, then check the rendered metadata as described in the [guide to SEO metadata]({{site}}/docs/guides/seo-metadata/).

Next.js substitutes `NEXT_PUBLIC_` values into client-side code at build time. If you change `NEXT_PUBLIC_SITE_URL` after a production build, rebuild the app before deploying it again. It is public configuration, not a place for credentials.

## Deploy and troubleshoot

Set the same required variable names in your hosting platform’s environment settings. Use the production database URI, a separately generated Payload secret and the production site origin. Supply the values to the build as well as the running application, and keep the production secret out of logs, commits and deployment scripts.

If the app cannot connect to the database, check that PostgreSQL is running, the credentials are correct and the database accepts connections from the app’s environment. A connection that works on your laptop does not establish that a hosted app can reach the same database.

If links or metadata contain the local origin after deployment, check the value of `NEXT_PUBLIC_SITE_URL` used for the build and rebuild with the correct value. If a changed local setting appears to have no effect, restart the development server and check for a higher-priority environment file or a variable already set in your shell.
