excerpt: A 2026 lab benchmark of 60 headless sites examines loading speed, layout stability and image weight, with practical guidance for teams planning their next release.
seoTitle: Headless performance benchmark 2026: 60 sites tested
seoDescription: See how 60 headless sites performed in a 2026 mobile lab benchmark, including loading speed, image weight and practical priorities for improvement.

I’m Mara Lindqvist, Head of Engineering at {{brand}}. For this report, we measured 60 headless sites to see how mobile performance varied across page types and implementation choices. The results point to a familiar conclusion: a headless architecture creates room to optimize, but it does not make pages fast by itself.

## Key findings

1. The median site recorded a 2.3-second Largest Contentful Paint, or LCP, across its tested pages. The slowest quarter began at 3.4 seconds.
2. Forty-two of the 60 sites met all three of our lab thresholds for LCP, Cumulative Layout Shift and Total Blocking Time. That is a benchmark result, not a real-user Core Web Vitals pass rate.
3. Sites with less image data generally performed better. Eleven of the 12 sites in the lightest image-weight band met all three thresholds, compared with two of the eight in the heaviest band.
4. Results varied within every framework group. The framework alone did not explain whether a site passed.
5. The most useful next step is to measure representative page templates, then address the resources and layout decisions responsible for their particular delays.

## Method

We selected 60 publicly accessible headless sites and assigned each to one primary category: commerce, editorial, corporate, services or nonprofit. The sample was not random and should not be treated as representative of every headless site. Categories describe the main purpose of each site, even where a site also publishes articles or sells products.

The sample included 24 sites built with [Next.js](https://nextjs.org), 20 with [Astro](https://astro.build) and 16 with [Nuxt](https://nuxt.com). We chose sites where the frontend framework could be identified and tested a home page plus two representative internal pages on each site. Across 180 URLs, we ran five cold-load mobile Lighthouse audits per URL, for 900 audits in total.

For each metric, we took the median of the five runs for each URL, then the median of the three URL values for each site. Group figures are medians of those site values. This approach gives each site equal weight, regardless of how many pages it publishes. The 3.4-second figure is the 75th percentile of the 60 site-level LCP values.

Our combined lab threshold required a site-level LCP of no more than 2.5 seconds, a Cumulative Layout Shift, or CLS, of no more than 0.10, and Total Blocking Time, or TBT, of no more than 200 milliseconds. LCP and CLS thresholds follow the commonly used good boundaries for Core Web Vitals. TBT is a lab diagnostic; it is not a substitute for measuring Interaction to Next Paint, or INP, with real users.

Image weight means the transferred image bytes recorded during each audit, summarized in the same way as the other metrics. Tests used a consistent mobile emulation and throttling profile. They did not capture returning visits, personalized states or interactions beyond the initial page load.

## The baseline differs by site category

The overall median LCP was 2.3 seconds. That is inside the good LCP boundary, but it does not mean every page on the median site was fast: each site value summarizes three pages, and individual routes could perform differently.

| Site category | Sites | Median LCP | Median CLS | Sites meeting all thresholds |
|---|---:|---:|---:|---:|
| Commerce | 16 | 2.7 s | 0.08 | 10 |
| Editorial | 14 | 2.2 s | 0.05 | 10 |
| Corporate | 12 | 2.1 s | 0.04 | 9 |
| Services | 10 | 2.4 s | 0.06 | 7 |
| Nonprofit | 8 | 2.3 s | 0.05 | 6 |
| All sites | 60 | 2.3 s | 0.05 | 42 |

The commerce group had the highest median LCP in this sample. Product imagery, merchandising components and third-party scripts are plausible places to investigate, but the category figures do not establish which resource caused a delay on any individual site. The table also does not compare commerce platforms: a platform choice and a frontend implementation are separate decisions.

For teams weighing those decisions, our comparison of [headless commerce options](#) would be the wrong resource to use unless it leads to the actual comparison. Instead, see how [Shopify and Medusa differ for headless builds]({{site}}/blog/shopify-vs-medusa-headless/), then test the page templates and integrations you expect to ship.

## Image weight has a visible relationship with passing

We grouped sites by their site-level median image transfer. The bands are descriptive, not prescribed budgets: an image-heavy page can still render its main content quickly, and a light page can be delayed by fonts, scripts or server response.

| Median image transfer per site | Sites | Median LCP | Median TBT | Sites meeting all thresholds |
|---|---:|---:|---:|---:|
| Under 250 KB | 12 | 1.7 s | 90 ms | 11 |
| 250–499 KB | 14 | 1.9 s | 120 ms | 12 |
| 500–999 KB | 16 | 2.3 s | 160 ms | 11 |
| 1,000–1,999 KB | 10 | 2.8 s | 230 ms | 6 |
| 2,000 KB or more | 8 | 3.5 s | 310 ms | 2 |
| All sites | 60 | 2.3 s | 160 ms | 42 |

The pattern is useful for prioritization, but it is not proof that image weight alone caused the differences. Heavier pages may also have more scripts, components or third-party requests. We did not hold those variables constant.

Start with the image that appears to be the LCP element on a slow route. Check its rendered dimensions against the file delivered to mobile, make sure the browser can discover it promptly, and avoid loading it lazily if it is needed immediately. Then inspect images farther down the page separately. Reducing total image transfer is valuable, but a smaller total does not guarantee a faster LCP.

Content models can help teams apply those checks consistently. The approach described in [this 40-site clinic project]({{site}}/case-studies/sundari-clinics/) illustrates why shared content structures matter when many sites need to manage the same kinds of page content.

## Framework choice is not a performance guarantee

The sample spans three frameworks, but it is not a controlled framework comparison. The groups differ in size, site purpose, design, hosting and integrations. A ranking of their raw results would risk attributing those differences to the framework itself.

Each framework supports approaches that can produce fast pages. The relevant questions are what gets rendered on the server or at build time, how much JavaScript reaches the browser, when content becomes visible and which resources compete for the network. Those choices can vary substantially between two projects using the same framework.

Measure the production output rather than assuming that a framework feature is active or sufficient. A mostly static page can still load a large client-side component tree. A server-rendered page can still wait on a slow upstream request. Both can shift visibly if space for an image, embed or banner is not reserved.

{{short}} Starter is our open source starter kit for Next.js and a headless CMS. The current version is 3.2, and teams can install it with `npx create-headless-starter`. Existing users moving from 2.x can consult [the upgrade guidance]({{site}}/docs/guides/upgrading-to-3/); an upgrade is also a useful point to rerun the same page-level tests before and after deployment.

## Blocking time and layout stability need their own checks

LCP gets attention because it describes when the main visible content renders, but it is only one part of the experience. A page can show its headline quickly and still be difficult to use while JavaScript occupies the main thread. It can also move after rendering, causing a visitor to tap the wrong control.

In this benchmark, passing required all three lab thresholds. A site with a good LCP could therefore fail the combined test because of CLS or TBT. Conversely, a site that passes these lab checks may still have a poor INP for real visitors, particularly on slower devices or during interactions we did not exercise.

Investigate scripts by purpose, not just by file size. Ask whether a feature must run before a visitor can use the page, whether it can wait until needed, and whether a third-party integration is providing enough value to justify its cost. For layout shifts, inspect late-loading fonts, images without reserved dimensions and elements inserted above existing content.

A useful release review includes:

- A repeatable mobile audit of the home page and important internal templates.
- A comparison against the previous release using the same test conditions.
- A separate review of real-user LCP, CLS and INP where field data is available.
- An owner for each regression and a decision about whether it blocks release.

## What it means for your next project

Use the benchmark as a starting point for questions, not as a target that every page must match. The right performance budget depends on the page’s job, audience and network conditions. A checkout, an article and a location page can have different content needs, but each should make its primary task available without unnecessary delay.

Before changing architecture, establish a baseline for the pages that matter. Record the LCP element, transferred resources, blocking time and visible shifts. Make one meaningful change at a time where practical, then repeat the test. If the lab result improves, check field data after release to see whether visitors benefit too.

That discipline is especially important during a migration. Moving content to a headless CMS does not automatically remove oversized assets or third-party scripts. Our guidance on [moving from WordPress to a headless setup]({{site}}/wordpress-to-headless-migration/) can help frame the migration work, but performance acceptance criteria should be part of the project plan from the beginning.

For an existing site, begin with the slowest important template rather than a broad rebuild. Fixing the LCP image on a widely used template may help more visitors than optimizing an infrequently viewed page.

## About the data

The figures in this report describe the 60-site sample and the lab conditions used in 2026. They are not a census of headless websites, a comparison of hosting providers or a forecast of user experience on every device. Medians conceal outliers, and three URLs cannot capture every template on a large site.

The framework groups were identified for context, not assigned experimentally. Likewise, the image-weight bands show an association within this sample; they do not isolate the effect of images from other page characteristics. The combined threshold uses TBT as a lab diagnostic and should not be reported as a Core Web Vitals assessment.

{{brand}} was founded in 2015 and has 46 people across offices in Amsterdam and Berlin. The team has delivered 180 projects. Those agency figures are separate from the 60 sites measured here; the benchmark should be read on its own methodological terms.

## FAQ

### Does headless architecture make a site faster?

Not by itself. Headless architecture separates content management from the frontend, which gives teams flexibility in how they render and deliver pages. Actual performance still depends on implementation, assets, hosting, scripts and visitor conditions.

### Are these results based on real-user data?

No. They come from repeatable mobile lab audits of three URLs per site. Real-user measurements can show different results because devices, networks, page visits and interactions vary.

### Why use Total Blocking Time instead of INP?

TBT is available in a controlled initial-load lab audit and can flag main-thread work worth investigating. INP measures responsiveness across actual interactions, so it should also be assessed using field data when available.

### Which metric should a team improve first?

Start with the metric that most affects an important page and its users. If the main content appears late, inspect LCP; if elements move, inspect CLS; if interactions feel delayed, investigate responsiveness with field INP and supporting diagnostics.
