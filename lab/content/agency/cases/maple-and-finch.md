summary: Maple & Finch launched a custom ecommerce platform in 2024, bringing commerce, content and the storefront into a headless architecture. {{brand}} delivered the development work, taking the project from planning to launch in 6 months.

## The client

Maple & Finch is a Canadian ecommerce company. It needed a platform that could support its storefront without tying its content and commerce operations to a single, closed system.

The company worked with {{brand}} on a custom build using open source technology. The project brought together [Medusa](https://medusajs.com) for commerce, [Payload](https://payloadcms.com) for content management and [Next.js](https://nextjs.org) for the customer-facing storefront. The new platform launched in 2024.

## The challenge

A commerce site has to serve several audiences at once. Shoppers need a straightforward route from product discovery to checkout, while the people running the business need a reliable way to maintain products and publish content.

Maple & Finch wanted more control over that experience and over the systems behind it. The development work had to address several connected problems:

- Build a checkout experience that could be adapted to the business rather than constrained by a fixed storefront.
- Give content editors a place to manage pages without requiring a developer for every change.
- Keep product and commerce data connected to the storefront while giving each system a clear responsibility.
- Move to a platform where the business could make informed decisions about platform fees and future development.
- Coordinate the build, testing and launch of the new experience.

Those needs made the boundaries between systems important. A flexible storefront would have limited value if editors could not maintain it, or if product information was difficult to keep consistent across the buying journey.

## The approach

{{brand}} organized development around the way information and customers would move through the platform:

1. **Define responsibilities.** The team mapped the storefront, commerce and content requirements to the systems best suited to handle them. Product and transaction workflows belonged with Medusa; editorial content belonged with Payload.
2. **Build the foundations.** Development established the connections needed for the Next.js storefront to retrieve commerce and content data. This gave subsequent page and checkout work a consistent basis.
3. **Develop the experience.** The team built the customer-facing pages and connected them to the underlying services, paying particular attention to the journey from a product page to checkout.
4. **Test and launch.** The team checked the connected experience before launch, including whether content could be published and whether the storefront could use the data it needed.

The separation also made it possible to consider changes in context. An editorial page could evolve in the content system without treating every content update as a commerce change. Conversely, commerce behavior could be developed without making the content model responsible for transactions.

For teams planning a move from an existing WordPress site, {{brand}} has also documented [the checks it uses for a headless migration]({{site}}/blog/wordpress-to-headless-migration-checklist/). That resource covers migration planning; it is not a description of Maple & Finch’s previous platform.

## The solution

The finished platform uses Next.js to present the shopping experience, with Medusa and Payload providing separate sources of commerce and editorial data. The storefront brings that information together where customers need it: on pages that support browsing, product evaluation and purchasing.

Payload gives the client a dedicated content-management environment. The development work established a structure for content that the storefront could consume, so publishing was not dependent on changing the storefront code for every editorial update.

Medusa handles the commerce side of the architecture. Keeping that responsibility distinct from editorial content gives the development team a clearer place to work on commerce behavior and its connection to checkout.

This is an open source stack, not a promise that maintenance disappears. The application and its integrations still need ownership, testing and deployment. The benefit for Maple & Finch is a platform whose components can be developed to suit its needs.

> The storefront brings commerce and editorial content together where customers need them.

## The results

The project launched in 2024 after 6 months. The reported figures are shown below. The brief does not specify baseline values or whether the percentages represent rates or changes, so the table does not infer either.

| Metric | Before | After |
| --- | --- | --- |
| Checkout completion | Not provided | 16 % |
| Platform fees | Not provided | 40 % |
| Time to launch | Not provided | 6 months |

The figures provide a starting point for discussing the launch, but they do not establish a direction of change on their own. Assessing checkout performance or fees over time would require a consistent definition of each metric and a comparable baseline.

## What comes next

The architecture gives Maple & Finch distinct places to develop its shopping experience, commerce workflows and editorial content. Future work can be evaluated against those boundaries: a storefront change, for example, may need different testing from a change to checkout behavior or content structure.

Hosting is another ongoing decision rather than a feature settled permanently at launch. For teams reviewing their options after the project, {{brand}}’s [guide to choosing a Next.js hosting platform]({{site}}/blog/best-nextjs-hosting-platforms-2026/) offers a later perspective on that choice.
