excerpt: Plan, implement, and verify redirects for a CMS migration without losing track of URL ownership, search signals, or the paths visitors rely on.
seoTitle: Managing CMS Migration Redirects at Scale: A Guide
seoDescription: Learn how to inventory old URLs, map destinations, deploy redirect rules, and monitor errors during a CMS migration without creating long redirect chains.

I’m Sofia Marchetti, SEO Lead at {{brand}}. A CMS migration can change thousands of URLs even when the content itself survives. Redirects connect the old addresses people and search engines know to the new ones they need. The work is not just writing rules: it is deciding which pages deserve a destination, choosing where rules run, and proving they work before and after launch.

## Build an inventory before mapping URLs

Start with the URLs that exist today, not just the pages in the CMS. A headless site may expose content through routes assembled by the frontend, including category pages, pagination, localized pages, and older templates that no longer appear in navigation.

Combine a crawl of the current site with a CMS export, sitemap files, server logs, and search analytics where available. Each source has gaps. A crawl finds linked pages but can miss orphaned content; a CMS export may contain unpublished entries; logs show requested paths but do not establish whether each request came from a person, a bot, or an obsolete link.

Keep the raw sources separate, then create a working inventory with one row per distinct URL. Record the source, status code, content type, language, canonical URL, traffic indicators, and proposed migration action. Note whether a URL contains a query string that changes the content. Sorting by traffic alone is not enough: a low-traffic page may still have valuable external links or serve an important customer task.

Check who owns each decision. Content owners can confirm whether an article is being consolidated; SEO can review search intent and link value; engineering can identify routes generated outside the CMS. Record a decision owner and an approval status alongside the proposed destination so unresolved rows do not disappear into an implementation backlog.

Your frontend choice also affects what you can generate and where redirects can run. Compare routing needs while evaluating [frameworks for content-heavy sites]({{site}}/blog/top-frameworks-for-content-sites/), rather than treating URL handling as an afterthought.

## Map by intent, not just by matching slugs

A redirect should take visitors to the closest useful replacement. A matching slug is a helpful clue, not proof that two pages serve the same purpose. Review the title, content, language, and intended audience before accepting an automatic match.

### Choose an action for each URL

| Existing URL type | Preferred action | Review point |
|---|---|---|
| Page moved without a substantive change | Redirect to its new URL | Confirm the destination is live and indexable |
| Several articles consolidated into one guide | Redirect each relevant article to the guide | Check that the guide covers the original topics |
| Retired page with no meaningful replacement | Return a 404 or 410 | Confirm removal is intentional |
| Localized page moved to a new route | Redirect to the matching language | Avoid sending every language to the default locale |
| Filtered or parameterized page | Define a parameter-specific policy | Check whether parameters change content or only tracking |

Do not redirect every retired page to the homepage. It creates a confusing journey and can be interpreted by search engines as a soft 404 when the destination does not answer the original request. A 404 is not inherently a migration failure when a page has genuinely gone and has no substitute.

### Normalize carefully

Decide how the new site handles uppercase characters, trailing slashes, hostnames, and protocols. Make those conventions explicit in the mapping process. Some servers distinguish `/Guide` from `/guide`, while others do not; test the behavior of your actual stack instead of assuming.

Treat query parameters separately from paths. Tracking parameters may be safe to preserve or discard according to your analytics policy. Parameters that select a product, language, or search state need an explicit decision. A blanket rule can silently send distinct old pages to the same irrelevant destination.

Use permanent redirects for moves intended to last, and temporary redirects for genuinely temporary routing. A permanent redirect is a strong signal, not an instruction that guarantees a search engine will transfer every ranking signal immediately.

> **Practical tip:** Add a “reason” column to the mapping sheet. A note such as “content merged into the new guide” makes later reviews much faster than a destination alone.

## Put rules at the right layer

Redirects can run at the CDN or hosting layer, in the application, or in another component that receives requests. Choose the earliest layer that has enough information to make the correct decision. Avoid implementing the same rule independently in multiple places: overlapping rules are difficult to audit and can produce chains or loops.

For an application-level example, [Next.js](https://nextjs.org) supports redirects in its configuration. The following rules cover two known paths:

```js
// next.config.js
module.exports = {
  async redirects() {
    return [
      {
        source: '/old-guide',
        destination: '/guides/current',
        permanent: true,
      },
      {
        source: '/old-pricing',
        destination: '/pricing',
        permanent: true,
      },
    ];
  },
};
```

In Next.js, `permanent: true` uses a 308 response, while `permanent: false` uses a 307. Both preserve the request method. A redirect intended for an old content page should not inadvertently affect an API endpoint or a form submission, so review route scope and methods as well as destinations.

### Separate application rules from platform rules

Hosting platforms such as [Vercel](https://vercel.com) and [Netlify](https://www.netlify.com) offer redirect capabilities, but configuration formats, precedence, and limits vary. Check the documentation for the platform and deployment mode you use. A rule that works in local application development may behave differently when another layer handles the request first.

For a large migration, keep the approved mapping in a version-controlled source of truth and generate or import rules into the chosen layer. Validate the generated output against platform constraints before deployment. Do not assume a configuration file can hold an unlimited number of individual redirects.

If you use {{short}} Starter, the [guide to organizing its project files]({{site}}/docs/getting-started/project-structure/) can help your team decide where application-owned migration code belongs. The redirect inventory itself should remain accessible to the content and SEO teams, not only to developers.

## Test destinations and redirect behavior

A valid mapping sheet does not guarantee a valid deployment. Test the actual HTTP response, the `Location` header, and the final page. A destination may have been renamed after approval, require authentication, or return a 200 response with the wrong content.

Run checks against a staging environment that resembles production, including the CDN and relevant hostname behavior where possible. Then repeat representative checks on production after launch. At minimum, test:

- High-value pages and pages with known external links.
- Every rule pattern, not only individual examples.
- Localized URLs, trailing-slash variants, and case variants.
- URLs with meaningful query parameters.
- Removed pages that should return 404 or 410.
- Routes near application boundaries, including APIs and static assets.

Use a request that does not automatically follow redirects when checking the first response. Set `ORIGIN` to the environment under test before running:

```bash
curl -sS -o /dev/null \
  -w 'status=%{http_code} location=%{redirect_url}\n' \
  "${ORIGIN}/old-guide"
```

Inspect the reported destination, then request that destination separately. It should resolve to the intended final page without another avoidable redirect. For bulk checks, compare actual status codes and destinations with the approved inventory and report mismatches for review.

Test content workflows too. If publishing or changing a slug triggers a rebuild or invalidation, verify that the old and new paths behave correctly after the change. For teams using {{short}} Starter, review the [available hook behavior]({{site}}/docs/reference/hooks/) when planning that workflow. Do not assume a content update automatically creates a redirect unless your implementation explicitly does so.

## Keep chains and performance under control

The ideal migration redirect goes directly from the old URL to the final canonical URL. Chains often appear when an old rule points to an intermediate route that is then redirected again by a hostname, slash, or application rule. Each extra hop adds another request and another opportunity for a rule to fail.

Before launch, resolve each destination through the full stack and update the original mapping to point directly to the final address where practical. Check for loops as well: two rules can send a visitor back and forth even if each looks reasonable in isolation.

Redirects are only part of the performance picture. A quick redirect to a slow destination still leaves the visitor waiting. Review the destination pages alongside your [Core Web Vitals priorities for headless sites]({{site}}/blog/core-web-vitals-headless-sites/), and measure the complete journey rather than just the redirect response.

Also check internal links, XML sitemaps, and canonical tags. They should generally reference final URLs rather than relying on redirects. This reduces unnecessary hops for visitors and crawlers and makes it easier to distinguish legacy traffic from links the new site still needs to fix.

## Launch with an owner and a rollback plan

A redirect release needs a clear handoff between content, SEO, engineering, and operations. Agree on the production configuration, the person authorized to change it, and the signals that would justify a rollback. Keep the last known-good rules and deployment procedure available; a mapping file alone is not a rollback plan.

1. Freeze and approve the migration mapping, including intentional removals and unresolved exceptions.
2. Deploy the rules with the new routes, checking the order in which hosting and application layers process requests.
3. Run production smoke tests for priority URLs, localized paths, known edge cases, and expected 404 or 410 responses.
4. Review error logs, redirect responses, search reporting, and support reports for missed or incorrect mappings.
5. Fix verified issues, document each change, and repeat tests for affected patterns.

Expect monitoring to continue beyond launch day. Logs can reveal requests for URLs absent from the original crawl, while support teams may hear about broken links from documents or bookmarks. Search reporting can help identify indexing changes, but allow time for discovery and processing; a single day of movement is not enough to diagnose the migration.

Retain useful legacy redirects as long as they serve real links or requests and do not create unacceptable operational cost. Review them periodically rather than deleting the entire migration set on an arbitrary date. When a destination later changes, update the original rule as well so the old URL does not accumulate another hop.

## FAQ

### Should every old URL redirect?

No. Redirect URLs that have a meaningful replacement. When content has been permanently removed and no comparable page exists, an intentional 404 or 410 is usually clearer than sending visitors to an unrelated page. Document that decision so it can be distinguished from a missed rule.

### Is a 301 different from a 308?

Both indicate a permanent redirect, but their handling of request methods differs. A 308 explicitly preserves the method and request body. Test the behavior of your server, clients, and routes, particularly if a rule could affect requests other than ordinary page loads.

### How can I detect redirect chains?

Request each old URL without automatically following the response, inspect its destination, and then test that destination. For a large inventory, automate the comparison and flag destinations that redirect again. Include hostname and trailing-slash behavior, because those layers can add hops outside the application.

### When should migration redirects be removed?

There is no universal expiry date. Keep redirects while they support valuable links, bookmarks, or ongoing requests, and review their usage and maintenance cost periodically. If you remove a rule, confirm that the resulting response is intentional and monitor for unexpected breakage.
