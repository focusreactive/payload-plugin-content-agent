Add a locale when you want editors to maintain another language for the same pages. {{short}} Starter uses [Payload](https://payloadcms.com) to store localized content and the [Next.js](https://nextjs.org) App Router to serve locale-prefixed routes. This recipe adds French alongside English, localizes fields in a page block, and checks the published result. It assumes you already have a starter project with the default PostgreSQL database and a working English site.

## Configure the locale

Open `starter.config.ts` and add French to the localization settings. Keep English as the default so existing content remains the fallback for fields that have not yet been translated.

```ts
const starterConfig = {
  localization: {
    locales: [
      { code: 'en', label: 'English' },
      { code: 'fr', label: 'French' },
    ],
    defaultLocale: 'en',
    fallback: true,
  },
}

export default starterConfig
```

The starter passes this localization object to the Payload configuration in `src/payload.config.ts`. Restart the development server after changing it so both the CMS and the application pick up the new locale.

| Option or field | Purpose | Value in this recipe |
| --- | --- | --- |
| `locales` | Lists the locales available to editors and routes | English and French |
| `code` | Identifies a locale in content queries and route segments | `en` or `fr` |
| `label` | Names the locale in the Payload admin interface | `English` or `French` |
| `defaultLocale` | Sets the locale used as the default for content | `en` |
| `fallback` | Allows a missing localized value to fall back to the default locale | `true` |

With the starter’s routing convention, an English page with the shared slug `about` is served at `/en/about`, and its French version is served at `/fr/about`. The route’s locale is passed to the Payload query. Page slugs and block order are shared across locales in this setup; only fields marked as localized can have different values.

For more on fallback and content queries, read [how localization works in the starter]({{site}}/docs/guides/localization/).

## Mark block fields as localized

Adding a locale does not automatically make every field translatable. Open a block in `src/blocks/` and mark the fields editors should translate. For example, a hero block can have localized text while sharing its image across languages:

```ts
import type { Block } from 'payload'

export const Hero: Block = {
  slug: 'hero',
  fields: [
    {
      name: 'heading',
      type: 'text',
      required: true,
      localized: true,
    },
    {
      name: 'body',
      type: 'richText',
      localized: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
    },
  ],
}
```

Apply the same decision to the other blocks your pages use. A shared image is useful when the artwork is language-neutral; mark the upload field as localized instead if editors need a different asset for each language. Translate any text embedded in images as well as text stored in the CMS.

The block layout itself remains shared in this example. Editors can change the French heading and body, but adding or removing a hero changes the page structure for every locale. If a page needs a different structure in each language, plan that schema change separately rather than assuming localized fields provide separate layouts.

## Update the database and types

Changing existing fields to localized fields changes how their values are stored. Back up the database before applying the change, and review the generated migration for your existing content. The migration should be committed with the schema changes so it can be applied in other environments.

Run these commands from the project root:

```bash
npm run payload -- migrate:create
npm run payload -- migrate
npm run generate:types
npm run dev
```

The starter includes the `payload` and `generate:types` scripts used here. The first command creates a migration; the second applies pending migrations to the configured database. Type generation then updates the Payload types used by the application.

> **Note:** Review the migration and test it against a copy of production data before deployment. Do not assume that changing an existing field to `localized: true` will automatically put every existing value into the right locale.

If you are starting a new project rather than changing an existing one, use `npx create-headless-starter` to scaffold it. The [available scaffold commands]({{site}}/docs/reference/cli/) describe its options.

## Add translations and verify routes

1. Open the Payload admin and select a page that uses the updated hero block. Confirm that its English content is still present after the migration.
2. Switch the admin locale to French. Enter a French heading and body, then save and publish the page.
3. Visit the page under both `/en/` and `/fr/`. Confirm that each route shows the expected text and that the shared image appears in both versions.
4. Test a field without a French value. With fallback enabled, the French route can display the English value until an editor supplies a translation.
5. Repeat the check for other blocks and pages, including navigation and metadata fields if your project localizes them.

Fallback prevents empty fields from appearing on a French page, but it does not translate content. Review pages for mixed-language text before announcing the new locale. Also check links within rich text: an English internal link may need a French destination even when the page slug is shared.

Publishing workflow is separate from locale fallback. If your team schedules releases, review [how to schedule a publish]({{site}}/docs/recipes/scheduled-publishing/) and verify that the intended translations are saved before the scheduled time.
