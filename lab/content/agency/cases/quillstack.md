summary: Quillstack’s 2026 marketing site gives its team a reusable way to design, publish and maintain landing pages. {{brand}} delivered the design and development, with a reported 140 pages launched and publishing speed of 6 x.

## The client

Quillstack is a software-as-a-service company based in the Netherlands. Its marketing team uses landing pages to speak to different audiences, introduce product capabilities and turn interest into demo requests.

The company needed a site that could keep pace with campaign work without making every new page a development project. For its 2026 launch, Quillstack partnered with {{brand}} on both design and development. The goal was to give marketers a publishing system that felt consistent to visitors and flexible to the people building pages.

## The challenge

Quillstack’s campaign ideas moved faster than its existing publishing process. A landing page often began as a small request but became a collection of design decisions, content changes and developer handoffs. That made it hard to respond to a new campaign without disrupting other work.

The team needed to solve several connected problems:

- Editors lacked a reliable set of components for building campaign pages.
- Page creation depended on developers for routine layout and content changes.
- Similar pages could drift in appearance as campaigns evolved.
- Search metadata needed attention alongside the content, rather than after publication.
- Marketing and development needed a clearer way to review a page before it went live.

The answer could not be a single fixed template. Quillstack needed enough variation to make a campaign relevant while keeping its site recognisable and maintainable.

## The approach

{{brand}} organised the work around the publishing tasks the marketing team needed to perform, from assembling a page to checking it before launch.

1. **Map the content.** The team identified the recurring elements of a landing page, including introductions, feature explanations, proof points and demo calls to action. This established what should be reusable and where editors needed room to adapt.
2. **Design the system.** Designers created a set of page components with consistent typography, spacing and responsive behaviour. They considered how those components could be combined without making every page look identical.
3. **Build the workflow.** Developers implemented the content model in [Payload](https://payloadcms.com), built the frontend with [Next.js](https://nextjs.org) and deployed the site on [Vercel](https://vercel.com).
4. **Review and refine.** The team tested page assembly, editorial review and launch tasks with Quillstack, then adjusted the components and fields to make everyday use clearer.

This sequence kept the design and technical decisions tied to the way Quillstack would actually use the site. It also gave the client a role in evaluating the system before relying on it for campaigns.

## The solution

The finished site gives Quillstack a structured collection of content blocks rather than a blank canvas. An editor can choose the components a campaign needs, write the copy and arrange the page while working within the visual system. Shared styling carries across pages, so a new campaign does not require a fresh design for every section.

Payload holds the content and provides the editing interface. Next.js renders the site, while Vercel supports its deployment. The separation between content and presentation lets the team update marketing material without treating each copy change as a frontend build task.

The content model also makes room for search metadata as part of the publishing workflow. Editors can consider a page’s title and description when preparing the page, rather than leaving that work until launch. For teams setting up a similar process, {{brand}} documents [how to manage SEO metadata]({{site}}/docs/guides/seo-metadata/) in {{short}} Starter.

Review remains part of the process. Reusable components reduce the number of decisions required for each campaign, but they do not replace a check of the copy, links and call to action. The system gives marketing a more direct route to publication while preserving a clear point for colleagues to assess the page.

The work was a new site delivery, not a migration from another named platform. For organisations evaluating a change of CMS, {{brand}} also covers [planning a move from Sanity to Payload]({{site}}/blog/sanity-to-payload-migration-guide/).

## The results

The project tracked landing-page output, publishing speed and demo requests. The reported results are shown below; baseline values and the basis for the demo-request percentage were not recorded.

| Metric | Before | After |
|---|---|---|
| Landing pages launched | Not recorded | 140 pages |
| Publishing speed | Not recorded | 6 x |
| Demo requests | Not recorded | 35 % |

> “We can put a campaign together using components we trust, then spend our review time on the message rather than rebuilding the page.”
>
> Mara de Vries, Marketing Director, Quillstack

## What comes next

Quillstack can continue to develop campaigns using the existing component set, adding to it when a genuine content need emerges. That gives the team a way to keep the site coherent without treating the launch design as fixed forever.

As pages accumulate, the editorial task shifts from creating them to keeping them useful. Reviewing older campaign copy, calls to action and metadata will help Quillstack maintain the library it has built and make informed choices about what to update next.
