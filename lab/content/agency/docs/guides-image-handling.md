Images in {{short}} Starter move from Payload’s Media collection to typed page blocks and, finally, to Next.js image rendering. The starter keeps uploads and their metadata together, generates reusable sizes, and uses [`next/image`](https://nextjs.org) to serve images suited to the reader’s screen. This guide covers the default setup and the changes needed when images are hosted outside the application.

## Create a project and upload an image

1. Create a project and start the development server:

   ```bash
   npx create-headless-starter my-site
   cd my-site
   npm run dev
   ```

2. Open the Payload admin panel, sign in with your local administrator account, and add an image to the Media collection. Enter alternative text that describes the image in its editorial context.

3. Add a Feature block to a page and select the uploaded image. Save the page, then view it on the site.

The starter stores local uploads on disk during development. Payload records the original file, its dimensions and the generated sizes in the Media document. The Feature block stores a relationship to that document rather than copying the file or its metadata into the page.

A fresh project needs a database and the environment variables requested by the CLI before the admin panel can run. Keep uploaded files in persistent storage in production: a local development directory is not a durable upload store on an ephemeral deployment.

## Configure generated sizes

The `media` section of `starter.config.ts` controls the sizes registered with Payload. The starter uses these settings when it builds the Media collection configuration.

```ts
export default {
  media: {
    imageSizes: [
      { name: 'card', width: 960, height: 640 },
      { name: 'hero', width: 1920, height: 1080 },
    ],
    remoteHostname: process.env.MEDIA_HOSTNAME,
  },
}
```

The starter configures these sizes as centered crops. Choose dimensions for the aspect ratios your blocks actually use; a size is a stored derivative, not a separate image editors need to upload. Payload generates the derivatives when an image is uploaded.

| Setting or field | Purpose | Default |
| --- | --- | --- |
| `imageSizes` | Named derivatives generated for uploaded images | `card` and `hero` |
| `name` | Key used to access a derivative in a Media document | Required for each size |
| `width` | Target crop width in pixels | Required for each size |
| `height` | Target crop height in pixels | Required for each size |
| `remoteHostname` | Permitted remote image host for Next.js optimization | Unset for local uploads |

Changing a size affects new uploads. Existing Media documents can retain their old derivatives, so re-upload affected images if you need them generated with the new dimensions. Check representative landscape and portrait images after a crop change, especially where the subject is close to an edge.

> **Note:** `remoteHostname` is a hostname only, without a protocol or path. The starter adds it to the Next.js remote image configuration for HTTPS images at build time. Set `MEDIA_HOSTNAME` before building when your upload storage serves images from a separate host.

## Render a block image

Blocks live in `src/blocks/`. A block that needs a card-shaped image can use the generated `card` derivative, falling back to the original if that derivative is unavailable. The following component accepts a populated Media document and preserves its dimensions for layout stability:

```tsx
// src/blocks/Feature/FeatureImage.tsx
import Image from 'next/image'
import type { Media } from '@/payload-types'

export function FeatureImage({ media }: { media: Media }) {
  const card = media.sizes?.card
  const image =
    card?.url && card.width && card.height ? card : media

  if (!image.url || !image.width || !image.height) return null

  return (
    <Image
      src={image.url}
      alt={media.alt}
      width={image.width}
      height={image.height}
      sizes="(max-width: 768px) 100vw, 50vw"
      style={{ width: '100%', height: 'auto' }}
    />
  )
}
```

The `sizes` value tells the browser that the image occupies the full viewport width on smaller screens and roughly half of it on larger screens. Adjust it if the block’s layout changes; it is not the same setting as Payload’s stored `imageSizes`.

The component expects the relationship to be populated, not just an ID. Fetch the page with a relationship depth that includes the Media document, and handle an empty image field before passing it to the component. The generated `Media` type comes from Payload’s schema; regenerate types after changing the collection.

## Write useful image fields

The starter’s Media collection requires an `alt` field. Write a concise description for an informative image, rather than repeating the surrounding heading or starting with “image of.” If the same asset needs different wording in different contexts, add an optional alt override to the block and use that value before `media.alt`.

For a decorative image, use an empty alternative text in the rendered component. Make that choice explicit in the block schema rather than leaving editors to enter a space. Consider captions separately: a caption can add context visible to everyone, but it does not replace alternative text.

For guidance on deciding which fields belong on the asset and which belong on a block, see the guide to [modeling content]({{site}}/docs/guides/content-modeling/). If editors need localized descriptions, follow the recipe for [adding another language]({{site}}/docs/recipes/add-a-locale/) and localize the relevant text fields.

## Check deployment and older projects

For local uploads, the starter serves relative media URLs from the same application. For remote storage, confirm that the URL saved in the Media document uses the configured HTTPS hostname and that Next.js can fetch the file. The default optimizer cannot forward a visitor’s authentication headers to a protected image source; use publicly readable image URLs or a delivery strategy designed for protected files.

After deployment, inspect a page at mobile and desktop widths. Confirm that the image loads, the intended crop is visible, and the layout does not shift while it loads. A missing derivative should fall back to the original; a missing original URL or dimensions will cause the example component to render nothing.

Projects moving from an earlier starter version should review the [3.x migration guidance]({{site}}/docs/guides/upgrading-to-3/) before changing image configuration. For the underlying upload and collection behavior, consult [Payload’s documentation](https://payloadcms.com).
