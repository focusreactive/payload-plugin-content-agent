excerpt: Learn how to manage source images, responsive delivery, accessibility, caching, and migration checks across a headless CMS and frontend.

seoTitle: Headless CMS Image Optimization: A Practical Guide
seoDescription: Learn how to optimize images in a headless CMS, from editorial uploads and responsive delivery to caching, accessibility, and migration checks.

I’m Mara Lindqvist, Head of Engineering at {{brand}}. Image optimization in a headless CMS is a shared responsibility: editors choose and describe assets, the CMS stores and exposes them, and the frontend decides what each visitor downloads. A fast image is not just a smaller file. It is the right crop, dimensions, format, and description for the context in which it appears. This guide covers the decisions to make at each layer, plus a practical implementation for [Next.js](https://nextjs.org).

## Map the image pipeline

Start by tracing one image from upload to browser. Identify where the original is stored, which service creates variants, what the API returns, and whether the frontend or an image CDN performs the final transformation. Draw the boundary between those services before adding another optimizer; resizing the same image twice can waste processing time and make quality harder to control.

A useful CMS response includes an asset URL, intrinsic width and height, alternative text, and any crop or focal-point data the frontend needs. If your integration uses {{short}} Starter, check its [REST API reference]({{site}}/docs/reference/rest-api/) for the fields and response shapes available to your application. Do not assume every asset field contains a complete URL or that every relationship is populated automatically.

Decide who owns each operation:

| Operation | Typical owner | Decision to make |
|---|---|---|
| Original upload | CMS or asset storage | Which file types and sizes are accepted? |
| Crop selection | Editor and CMS | Is the focal point preserved for each use? |
| Responsive variants | Image service or frontend | Which widths and formats are generated? |
| Browser layout | Frontend | How is space reserved before the image loads? |
| Cache invalidation | Asset service and CDN | What changes when an image is replaced? |

Keep original uploads separate from generated derivatives where your storage setup permits it. A good original lets you create a new crop or format later without asking an editor to upload the file again.

## Prepare assets for reuse

An image that looks good in a wide hero may fail as a square card. Model those uses explicitly rather than expecting one automatic center crop to work everywhere. In [Sanity](https://www.sanity.io), image fields can carry crop and hotspot information; your frontend must use that information when constructing an image URL. In [Payload](https://payloadcms.com), upload collections can be configured with image sizes and metadata. The exact fields available to the frontend depend on your schema and configuration.

### Give editors clear choices

Define a small set of roles, such as hero, card, and inline image. For each role, document the intended aspect ratio, minimum source dimensions, and whether a different crop can be selected. A portrait may need the subject’s face kept in frame; a product screenshot may need to remain uncropped so its interface stays legible.

Use validation where it prevents predictable mistakes, but do not reject useful images merely because they are larger than a delivery variant. A large original can produce a small derivative. An undersized original cannot reliably produce a sharp large hero.

- Ask for alternative text that describes the image’s purpose in context.
- Allow empty alt text for images that are purely decorative.
- Record dimensions so the frontend can reserve the correct aspect ratio.
- Avoid embedding essential text in an image when HTML can convey it.
- Review crops at narrow and wide viewport sizes before publication.

> **Practical tip:** Put a face or other important subject near the edge of a test image. It makes a broken focal-point implementation much easier to spot than a centered subject does.

Alternative text belongs to the context as well as the asset. If the same photograph appears in two articles for different reasons, consider allowing each usage to override a default description. A caption can provide attribution or context, but it is not automatically a substitute for alt text.

## Deliver responsive images in Next.js

Next.js provides the `Image` component for responsive image delivery and layout handling. Its default image optimization requires remote sources to match configured patterns. Keep those patterns as narrow as your asset service allows; an unrestricted image proxy can create security and cost problems.

### Configure the remote source

The following configuration reads the asset origin from an environment variable. Set `CMS_ASSET_ORIGIN` in each deployment environment to the HTTPS origin used by your public assets.

```ts
// next.config.ts
import type { NextConfig } from "next";

const origin = new URL(process.env.CMS_ASSET_ORIGIN ?? "");

if (origin.protocol !== "https:") {
  throw new Error("CMS_ASSET_ORIGIN must use HTTPS");
}

const config: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: origin.hostname,
        port: origin.port,
        pathname: "/**",
      },
    ],
  },
};

export default config;
```

This example permits paths across the configured host. Restrict `pathname` further if your asset provider uses a dedicated path prefix. It also permits query strings, which some image services need for transformations. If yours does not, consider restricting them too. An invalid or missing environment variable causes the configuration to fail rather than silently allowing an unintended host.

### Match the component to the layout

Pass the source dimensions returned by the CMS and describe the rendered width with `sizes`. The following example assumes the image fills its container up to 768 pixels:

```tsx
import Image from "next/image";

type CmsImage = {
  url: string;
  width: number;
  height: number;
  alt: string;
};

export function ArticleImage({ image }: { image: CmsImage }) {
  return (
    <Image
      src={image.url}
      width={image.width}
      height={image.height}
      alt={image.alt}
      sizes="(max-width: 768px) 100vw, 768px"
      style={{ width: "100%", height: "auto", maxWidth: 768 }}
    />
  );
}
```

The dimensions establish an aspect ratio; CSS controls the displayed size. Adjust `sizes` to the real layout, especially for multi-column cards. A value that claims every card spans the full viewport can cause the browser to select unnecessarily large files.

The default optimizer needs to be able to fetch the source image. Do not assume it forwards authentication headers to a private asset endpoint. For protected media, design an authorized delivery path rather than exposing credentials in a URL. If you use {{short}} Starter, the [3.0 release notes]({{site}}/blog/starter-3-released/) provide context for the starter; its current version is 3.2 and it can be installed with `npx create-headless-starter`.

## Choose formats and loading behavior

Modern formats can reduce transfer size, but format alone does not determine quality. Photographs, illustrations, transparent graphics, and animated assets behave differently under compression. Compare representative files at their intended display size, looking for artifacts around text, gradients, and fine detail.

### Make a delivery policy

Use WebP or AVIF where your delivery stack supports them, with a fallback for clients that need one. Check whether the CMS image service or the frontend optimizer performs format negotiation; configuring both without understanding the chain can produce unnecessary transformations. Preserve transparency when it is needed, and test animation separately rather than assuming a static-image pipeline will retain it.

For an image likely to be the page’s largest visible element, make sure it is discoverable early and avoid lazy-loading it. Lower-page images can generally load lazily. Do not preload every image: competing high-priority requests can delay the resource that actually matters.

Choose compression settings by visual testing, not by a single file-size target. A small hero with visible artifacts is not a successful optimization. Likewise, an image that looks perfect at full resolution may be far larger than necessary when rendered as a card.

### Measure the page, not just the file

Inspect the rendered page in browser developer tools. Check the selected image candidate, its transfer size, its rendered dimensions, and whether it shifts the layout. Use field data when available, because network conditions, devices, and real viewport sizes differ from a developer’s laptop.

Pay particular attention to Largest Contentful Paint when a prominent image is the likely largest element. A smaller file will not fix a slow CMS response, a late-discovered image, or a layout that hides the image behind client-side rendering. Test after deployment as well as locally, since the production cache and image service may behave differently.

## Build an editorial workflow that lasts

Optimization needs to survive staff changes and new page templates. Put asset guidance next to the fields where editors make decisions, rather than relying only on a separate handbook. Explain when to upload a new source, when to reuse an existing asset, and how to preview the crop for each placement.

A plugin can help with a specific task, but it should fit the schema and deployment you already maintain. If you are evaluating options for Payload, our selection of [plugins worth considering]({{site}}/blog/payload-plugins-worth-installing/) is a starting point. Check compatibility with your installed version and test the plugin’s effect on existing assets before adding it to production.

1. Inventory image fields and identify which page components use each one.
2. Agree on source requirements, crops, alt-text rules, and ownership with editors.
3. Implement delivery and cache settings in a staging environment.
4. Test representative images across templates, screen sizes, and assistive technology.
5. Publish the guidance and review the results after editors have used it.

Make failure states explicit. Decide what a component should render when an optional image is missing, and prevent publication when a required image has no usable source. Avoid silently replacing meaningful missing images with a generic placeholder: that can hide a content problem from both editors and visitors.

## Plan caching and migration together

Image URLs often outlive the page templates that created them. During a CMS migration, inventory image references in page content, structured fields, metadata, feeds, and external integrations. Identify which old URLs receive traffic before turning off the previous storage or delivery service.

For immutable, versioned asset URLs, long cache lifetimes can reduce repeat downloads. If an editor replaces a file at the same URL, however, browsers or CDNs may continue serving the old version until their caches expire or are invalidated. Prefer a new versioned URL when your asset workflow supports it, and verify which cache layers must be cleared when it does not.

Redirects can preserve access to old asset URLs, but they add a request and must lead to an accessible equivalent. Test them alongside page redirects, including query strings used by any existing image transformations. Our guide to [managing redirects during a CMS migration]({{site}}/blog/cms-redirects-at-scale/) covers the broader redirect planning process.

Before launch, compare a sample of old and new pages for missing images, changed crops, dimensions, and alt text. After launch, monitor failed asset requests and image-delivery costs. A successful migration preserves the content’s meaning as well as its URLs.

## FAQ

### Should the CMS or the frontend optimize images?

Either can, but assign each transformation a clear owner. A CMS image service may handle crops and format variants, while the frontend handles layout and responsive selection. Avoid resizing and recompressing at multiple layers without a reason.

### What is the best image format for every page?

There is no single best format. WebP and AVIF are useful for many photographic images, while illustrations, transparency, and animation may need different treatment. Test quality and browser support for the assets and delivery service you actually use.

### Does every image need alternative text?

Every HTML image needs an appropriate `alt` decision. Use descriptive text when the image conveys information, and an empty `alt` attribute when it is decorative. Write the description for its context rather than repeating a nearby caption without purpose.

### How can I tell whether optimization worked?

Compare production pages before and after the change. Check image transfer sizes, selected responsive widths, layout shifts, and loading behavior, then review user-facing performance data where available. Also inspect visual quality and crops so a faster page does not come at the expense of useful content.
