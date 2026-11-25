excerpt: Learn how to diagnose Core Web Vitals on headless sites, prioritize the fixes that affect visitors, and prevent regressions as content changes.
seoTitle: Core Web Vitals for Headless Sites: What to Fix First
seoDescription: Improve LCP, INP, and CLS on a headless site with a practical guide to field data, image delivery, JavaScript, caching, and content workflows.

A fast headless site is not guaranteed by choosing a fast framework. Content, images, third-party scripts, hosting, and editorial workflows all affect what visitors experience. Start with the pages and devices where real users struggle, then fix the bottleneck that makes the biggest difference.

*By Mara Lindqvist, Head of Engineering at {{brand}} · 2026*

## Measure before changing the architecture

Core Web Vitals are three measures of user experience: Largest Contentful Paint (LCP), Interaction to Next Paint (INP), and Cumulative Layout Shift (CLS). They describe loading, responsiveness, and visual stability. A headless CMS can contribute to all three, but it is rarely useful to blame the CMS without measuring the whole delivery path.

Use field data first. The Chrome User Experience Report collects eligible, anonymized Chrome user data over a rolling 28-day period. PageSpeed Insights can show that data for a URL when enough visits are available, or fall back to origin-level data. Check both mobile and desktop, and look at the 75th percentile rather than an average.

| Metric | Good threshold at the 75th percentile | What to investigate first |
|---|---:|---|
| LCP | 2.5 seconds or less | The largest visible image or text block and its delivery path |
| INP | 200 milliseconds or less | Slow interaction handlers and work blocking the main thread |
| CLS | 0.1 or less | Elements that appear or change size after rendering |
| TTFB | 0.8 seconds or less is a useful target | Server response, cache misses, and upstream requests |

TTFB is a diagnostic measure, not a Core Web Vital. A slow server response can delay LCP, but a good TTFB does not prove that the rest of the page loads quickly.

### Separate field evidence from lab clues

A lab test is a controlled reproduction, not a substitute for visits from real people. Use it to inspect requests, identify the LCP element, and record a performance trace. Repeat the test on representative templates, especially a content-heavy article, a landing page, and a page with interactive controls.

For a [Next.js](https://nextjs.org) deployment on [Vercel](https://vercel.com), inspect both application behavior and the hosting cache. A page can be fast on a warm cache and slow when it needs to fetch content and render. Segment your own measurements by route template and device type, while avoiding personal data in analytics.

## Fix the largest visible element first

LCP is often an image, but it can also be a text block. Identify the actual LCP element in a trace before changing image settings. If a hero image is the culprit, follow its path from the HTML response to the moment it paints: late discovery, a slow image response, excessive file size, and render-blocking resources can each be responsible.

Make the hero discoverable in the initial HTML. Avoid inserting it only after client-side JavaScript has fetched CMS data. Do not lazy-load an image that is expected to be visible immediately. Serve an appropriately sized responsive image, and check that mobile visitors are not downloading a desktop-sized original.

### Give the browser useful image information

For a Next.js page using `next/image`, a hero component can specify dimensions, responsive sizing, and a high fetch priority:

```tsx
import Image from "next/image";

type HeroImageProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

export function HeroImage({ src, alt, width, height }: HeroImageProps) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes="(max-width: 768px) 100vw, 1200px"
      loading="eager"
      fetchPriority="high"
      style={{ width: "100%", height: "auto" }}
    />
  );
}
```

Set `sizes` to match the rendered layout, not merely the source image. Remote image sources also need to be allowed in the Next.js image configuration. Reserve eager loading and high priority for genuinely important images; applying them everywhere creates competition rather than speed.

If the LCP element is text, look for slow font downloads, CSS that delays rendering, and server-side content fetches. Use a sensible font fallback and test the result on a constrained connection.

The [Quillstack landing-page workflow]({{site}}/case-studies/quillstack/) is a useful reminder that performance must survive frequent publishing. A fast template can regress when an editor adds a large hero, so image handling belongs in the publishing workflow as well as the initial build.

## Reserve space for content that arrives later

CLS measures unexpected movement during the page lifecycle, not just during the first second. Common causes on headless sites include images without dimensions, embeds, banners, and fonts whose fallback text occupies different space.

Give images and video known dimensions or an aspect ratio before they load. Reserve space for embeds and consent-dependent components when their size is predictable. For variable-height content, place it where expansion is less disruptive, or let the visitor request it rather than inserting it above content they are already reading.

Font changes deserve attention too. A fallback font with very different character widths can push headings and buttons around when the web font arrives. Choose a compatible fallback, limit font variants, and test long headings as well as short ones.

For [Astro](https://astro.build) sites, the choice between local content and a CMS affects how content is fetched and published, but neither choice automatically prevents layout shift. The [comparison of content collections and CMS workflows]({{site}}/blog/astro-content-collections-vs-cms/) can help frame that decision. Whichever source you use, make dimensions and embed behavior part of the content model.

> **Practical tip:** Test with the longest plausible headline, a portrait image, and a delayed embed. A stable page with ideal sample content can still jump when editors publish real material.

## Make interactions responsive

INP captures the delay between an interaction and the next visual update, including time spent waiting for the main thread, running event handlers, and rendering. Slow JavaScript is a common cause, but expensive layout and rendering work can contribute too.

Start with the interactions visitors actually use: navigation menus, search, filters, forms, and consent controls. In a browser performance trace, reproduce the interaction and inspect long tasks around it. Then remove unnecessary work from the critical path.

- Reduce JavaScript shipped for components that do not need to be interactive.
- Split expensive work into smaller tasks so the browser can respond between them.
- Defer nonessential third-party scripts and audit what each one contributes.
- Avoid recalculating large layouts after every keystroke or pointer event.
- Show immediate feedback for an action, then complete slower work asynchronously.

Do not assume that moving a task into an asynchronous function makes it cheap. Work still blocks the main thread when it runs there. Measure after each change and check that the interaction remains correct, especially for keyboard and assistive-technology users.

### Keep preview code out of the public path

Editorial preview can introduce polling, client-side subscriptions, and extra rendering. Those features are useful to editors but may be unnecessary for ordinary visitors. Separate preview behavior from published-page behavior, and verify the production build rather than only the editing session.

If you use Payload CMS, the guide to [connecting its live preview to Next.js]({{site}}/blog/payload-cms-live-preview-nextjs/) explains the preview workflow. Treat preview as a distinct route through the application when profiling, and ensure that disabling it for public visitors does not break the editor’s experience.

## Shorten the path from request to page

A headless request may pass through a CDN, application server, CMS API, image service, and third-party providers. Each dependency can add latency or fail independently. Map which calls are needed before the initial response and which can happen later.

Cache published content where freshness requirements allow it. Decide what should invalidate a page when an editor publishes, unpublishes, or corrects content. Test both a warm request and a cache miss; otherwise a fast repeat visit can conceal a slow first request. Keep preview and personalized responses separate from shared public caches.

Redirects also deserve a place in the audit. A redirect may be necessary after a content move, but chains add round trips before the destination can begin loading. Update internal links to point directly to the final URL, preserve needed query parameters, and test important migrations before release. For the starter, follow the [redirect configuration guidance]({{site}}/docs/guides/redirects/).

Avoid fetching the same CMS data separately for a layout, navigation, and page component when one well-scoped request can supply it. Equally, do not fetch an entire content collection to render a single card. Select the fields the template needs and check the size of the response as well as its timing.

## Build a repeatable performance check

A one-off audit will not protect a site from a new campaign image or a script added next month. Give the team a small set of representative pages and a clear owner for regressions.

1. **Choose templates and baselines.** Record field data where available and run repeatable lab tests for key mobile and desktop pages.
2. **Find the limiting element or task.** Use traces and network requests to connect a poor metric to a specific cause.
3. **Change one major variable at a time.** For example, fix hero discovery before redesigning the entire image pipeline.
4. **Verify in the lab and after release.** Field data changes more slowly, so compare the same pages and device categories over time.
5. **Add a publishing check.** Review image dimensions, embeds, and new scripts before they reach high-traffic templates.

For more detail than an aggregate report provides, the `web-vitals` library can report individual measurements in the browser. Install it as an application dependency, then initialize reporting once per page load:

```ts
import { onCLS, onINP, onLCP } from "web-vitals";

onCLS((metric) => console.log("CLS", metric.value));
onINP((metric) => console.log("INP in ms", metric.value));
onLCP((metric) => console.log("LCP in ms", metric.value));
```

This example logs locally; it does not send data to an analytics service. If you add collection, define consent and retention rules, avoid sending personal information, and use the library’s metric identifiers when handling updates. Some measurements are finalized when a page becomes hidden, so account for that when designing delivery.

## FAQ

### Which Core Web Vital should we fix first?

Fix the metric that fails for real visitors on an important page, then investigate its specific cause. If several fail, prioritize the issue with the clearest evidence and broadest impact. A slow hero shared by many landing pages may be a better first fix than a rare interaction on one low-traffic route.

### Does a headless CMS make Core Web Vitals worse?

Not inherently. A CMS supplies content, while rendering, caching, images, scripts, and hosting determine much of the visitor experience. A slow CMS request can delay a server-rendered page, but oversized images or client-side JavaScript can be equally important. Measure the full path before changing platforms.

### How quickly will field scores improve after a fix?

Lab tests can show an improvement immediately, but Chrome User Experience Report data uses a rolling 28-day window. The visible score will depend on traffic and on how quickly new visits replace older observations. Compare equivalent URLs and device categories, and check whether enough URL-level data is available.

### Can we use one performance budget for every page?

Use shared minimum standards, but set template-specific budgets where page behavior differs. A campaign landing page and an interactive search page have different needs. Track resources and interactions that matter for each, while applying the same Core Web Vitals thresholds to the user experience you want to protect.
