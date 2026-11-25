summary: Brightharbor Pay brought {{brand}} in to examine slow builds and recurring incidents across its headless publishing stack. The audit led to focused changes that made releases faster and the site more responsive.

## The client

Brightharbor Pay is a Swedish fintech company whose website supports its product and communicates with prospective customers. Its content team needs to publish information that is accurate, easy to maintain and available without putting routine releases at risk.

The site uses [Strapi](https://strapi.io) to manage content and [Next.js](https://nextjs.org) to render the frontend. That separation gives editors control over content while allowing developers to build the experience around the needs of the site. It also means that content models, API requests and build behavior have to work together.

Brightharbor Pay asked {{brand}} for an audit and support ahead of its 2025 launch. The aim was not to replace the stack, but to find the work slowing it down and make the existing system more dependable.

## The challenge

The team had reached a point where publishing and development were taking more effort than they should. Problems appeared across the workflow rather than in a single isolated component:

- Builds took too long, making it harder to release changes with confidence.
- Interactions on the site needed to feel more responsive to visitors.
- Recurring incidents interrupted the team and made it difficult to distinguish symptoms from underlying causes.
- Content delivery and frontend build processes needed a shared review rather than separate fixes.

A slow build affects more than a deployment queue. It lengthens the feedback loop for developers checking changes and can leave editors waiting for content to appear. Meanwhile, incidents draw attention away from planned work. Brightharbor Pay needed a practical way to address both without disrupting the content team’s day-to-day work.

## The approach

{{brand}} organized the engagement around an audit followed by targeted support. The team looked at how content moved from Strapi into the Next.js site, then used the findings to prioritize changes that could be checked against the project’s goals.

1. **Inspect the workflow.** Review the build process, content requests and incident patterns to understand where delays and operational friction were occurring.
2. **Prioritize the findings.** Separate issues affecting release speed and user experience from changes that could wait, so the team could focus its effort.
3. **Support implementation.** Work with Brightharbor Pay on changes to the existing stack, checking their effect on builds, interactions and day-to-day operations.
4. **Prepare for handover.** Document the decisions and checks the client team would need to maintain the improvements after launch.

The audit considered the connection between the CMS and the frontend. A content request that seems reasonable on its own can become expensive when repeated across a build. Equally, a frontend improvement is harder to sustain if the team cannot see how it affects the publishing workflow.

## The solution

The work focused on reducing unnecessary processing and making the content delivery path easier to understand. The team reviewed how the site requested content, how those requests contributed to builds and where the frontend was doing work that could be handled more efficiently.

For the developers maintaining the integration, the [REST API reference]({{site}}/docs/reference/rest-api/) provided a way to check request behavior against the documented interface. That made the review useful beyond the immediate build problem: future changes could be assessed with a clearer understanding of what the frontend asks the CMS to return.

The frontend work also addressed responsiveness. Rather than treating page delivery as the end of the performance story, the team checked how the site behaved when visitors interacted with it. Interaction to Next Paint became a useful measure for that part of the experience.

Operational support was part of the solution, not an afterthought. {{brand}} worked with the client team to make incident investigation more repeatable and to keep release checks visible. The goal was to leave Brightharbor Pay with a workflow its own team could operate, rather than a collection of changes that depended on outside knowledge.

## The results

The launch work produced improvements in build speed, responsiveness and incident reduction. The brief did not provide baseline values, so the table records the reported outcomes without inventing a before measurement.

| Metric | Before | After |
|---|---|---|
| Build time | Not supplied | 52 % reduction |
| Interaction to Next Paint | Not supplied | 140 ms |
| Incidents | Not supplied | 80 % reduction |

The shorter build process gave the team a faster route from change to release. The interaction result gave Brightharbor Pay a concrete measure of responsiveness, while the reduction in incidents meant less disruption to planned work.

## What comes next

Brightharbor Pay can use the audit findings as a reference when adding content or changing the frontend. Checking the effect of new requests and components before release will help the team protect the gains made during the project.

As the site evolves, redirects also need deliberate ownership. The guidance on [managing redirects during a CMS migration]({{site}}/blog/cms-redirects-at-scale/) offers a useful starting point for keeping that work orderly. The longer-term aim is straightforward: preserve a publishing system that remains fast to release, responsive to use and manageable for the people who run it.
