summary: Campus Nord rebuilt its university website around a headless content platform and a faster frontend. The migration brought its pages into a shared editorial workflow designed for readers in two languages.

## The client

Campus Nord is an Austrian university serving prospective students, current students and the wider academic community. Its website is a starting point for exploring programmes, understanding admissions and finding practical information about university life.

The university needed the site to work in two languages, without treating either language as an afterthought. It also needed an editorial system that would allow staff to maintain programme information and publish updates without relying on a developer for routine changes.

Campus Nord worked with {{brand}} on a migration and localization project that replaced its existing publishing setup and launched in 2026.

## The challenge

The university’s existing site ran on [WordPress](https://wordpress.org). Over time, its content had accumulated across sections serving different audiences and purposes. Moving that material was not simply a matter of copying pages into another system: the team needed to decide how content should be organized and maintained after the move.

The project had several connected problems:

- Programme and admissions information needed a consistent structure so visitors could find relevant details across the site.
- Content in both languages needed a manageable relationship, rather than being maintained as disconnected collections of pages.
- Editors needed a clear way to update content without working around presentation concerns.
- The migration needed to preserve useful material while giving the university an opportunity to review it.
- Page loading needed to improve, particularly on journeys where prospective students move between programme and application information.

The central question was how to give editors more control while making the published site simpler for visitors to use.

## The approach

{{brand}} organized the work around the content, the editorial workflow and the visitor experience. Rather than beginning with a visual redesign alone, the team examined what the existing pages needed to become in the new system.

1. **Content review and mapping.** The team reviewed the WordPress content and mapped it to the types of information the new site needed to support. This established where programme details, general university information and admissions content belonged.
2. **Localization planning.** The team defined how language versions would be represented and maintained. The aim was to make it easier for editors to see related content and identify what needed attention before publication.
3. **Migration and implementation.** Content was moved into the new platform, checked against the agreed structure and connected to the frontend. The team reviewed the results with Campus Nord rather than treating the import as the end of the migration.
4. **Launch preparation.** The university and {{brand}} checked key journeys, language versions and editorial tasks before the 2026 launch.

This approach gave the university a chance to examine its content alongside the technical move. It also made the migration a foundation for ongoing publishing, not just a transfer from an old database to a new one.

## The solution

The new content platform uses [Sanity](https://www.sanity.io), with a model designed around the university’s publishing needs. Editors can work with structured content instead of composing every page as an isolated layout. That distinction matters when similar information needs to appear consistently across programme pages and in both languages.

Localization is part of the content workflow. Editors can work on language versions with an understanding of how they relate, while reviewing the information each audience will see. The model supports the university’s need to maintain its site after launch, when admissions details and programme information continue to change.

The frontend uses [Astro](https://astro.build), a framework that can generate static pages and limit the JavaScript sent to the browser. It provides a suitable way to serve content from the headless platform while keeping the published experience focused on reading and navigation. For more context on the choice of frontend tools, {{brand}}’s comparison of [static site generators]({{site}}/blog/best-static-site-generators-2026/) examines the trade-offs between available options.

The separation between content management and presentation also gives Campus Nord a clearer division of responsibilities. Editors maintain the information; the frontend determines how that information is presented. The project reflects the broader publishing patterns discussed in {{brand}}’s look at [the headless CMS landscape]({{site}}/blog/state-of-headless-cms-2026/).

> Campus Nord’s new site brings its content and language workflows into a shared publishing system.

## The results

The migration moved the university’s content into the new setup and gave Campus Nord a basis for managing the site in both languages. The reported results are:

| Metric | Before | After |
|---|---|---|
| Pages migrated | — | 3600 pages |
| Faster page load | — | 71 % |
| Applications | — | 14 % |

The application figure is reported without a baseline and should not be read as an absolute application count. Beyond the figures, the new structure gives the university a more consistent way to maintain information that prospective students depend on.

## What comes next

The launch established a publishing system that Campus Nord can continue to use as its content changes. The ongoing work is editorial: keeping programme and admissions information current, reviewing language versions and making sure visitors can move confidently from research to application.

Because content and presentation are separate, the university can refine either part without treating every change as a rebuild of the whole site. That gives its team room to improve the experience while maintaining the shared structure created during the migration.
