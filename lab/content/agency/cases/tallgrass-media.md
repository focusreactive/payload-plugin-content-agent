summary: Tallgrass Media moved its newsroom to a headless publishing setup designed around its editors and readers. The migration brought its archive into the new system while preparing the publication for faster delivery.

## The client

Tallgrass Media is a US media company with a digital newsroom and an archive of published stories. Its editorial team needed to keep daily coverage moving while making older articles easy for readers to find and use.

The publication had grown on [WordPress](https://wordpress.org), where content management and page rendering were closely tied together. Tallgrass asked {{brand}} to migrate the newsroom and develop a headless platform that separated editorial work from the presentation layer.

The project launched in 2023. It covered the archive as well as the workflow for new stories, so the change needed to serve both the people producing coverage and the readers arriving through established article links.

## The challenge

A newsroom migration is not just a matter of moving text into a different database. Tallgrass needed to carry its editorial history into a new publishing environment without treating every article as an isolated page.

The team faced several connected problems:

- The existing archive contained articles, images and editorial metadata that needed to remain associated after migration.
- Established URLs had value for readers, search engines and links from other publications.
- Editors needed a practical way to create and update stories without depending on developers for routine changes.
- Article pages needed to load faster while still accommodating advertising.
- The new frontend needed room to evolve without forcing another content migration.

The challenge was to make those needs work together. A fast page would be of limited use if its links broke, while a preserved archive would be harder to maintain if the new editing experience slowed down the newsroom.

## The approach

{{brand}} organized the work around the content and the people responsible for it, rather than starting with page templates alone.

1. **Audit the existing newsroom.** The team reviewed the structure of the WordPress content, including article fields, media and URL patterns. This established what needed to move and what the new system would need to represent.
2. **Model the content.** Articles and their supporting information were mapped into a headless content model. The model gave editors fields for the material they maintain while giving the frontend a consistent source of data.
3. **Migrate and verify.** The archive was transferred into the new system and checked against the source content. Redirect planning was part of the migration rather than an afterthought; {{brand}}’s [guide to redirects]({{site}}/docs/guides/redirects/) explains the considerations behind preserving paths.
4. **Build and launch.** The team developed the new frontend, connected it to the CMS and checked the editorial and reader journeys before launch.

Throughout the project, the goal was to preserve the usefulness of existing content while giving the newsroom a foundation it could maintain.

## The solution

The new platform uses [Payload](https://payloadcms.com) as the headless CMS and [Next.js](https://nextjs.org) for the frontend. Payload provides a place to manage structured editorial content; Next.js uses that content to render the public-facing site. The separation lets the team change the presentation of a story without rewriting the story itself.

The article model keeps the elements of a piece together, including its body, associated media and metadata. That structure matters during migration, but it also helps with ordinary editorial work after launch: editors can update content in the CMS while the frontend applies the site’s presentation.

The migration also accounted for the routes readers already knew. Redirects connect older paths to their destinations on the new site, reducing the chance that a reader following an established link encounters a dead end.

Performance and advertising were considered together in the frontend. The team built article pages to deliver content efficiently while retaining space for ads within the reading experience. This avoided treating advertising as a separate concern added only after the page was complete.

> “We needed to move the archive without asking the newsroom to stop publishing. The new setup gives us a clearer way to manage stories and build on them.”
>
> — Maya Reed, Editorial Director, Tallgrass Media

## The results

The launch brought the archive into the new platform and delivered measurable changes to the reading experience. Tallgrass reported the following results; baseline figures for page load and ad viewability were not specified.

| Metric | Before | After |
|---|---|---|
| Pages migrated | In WordPress | 12000 pages |
| Faster page load | Not specified | 64 % |
| Ad viewability | Not specified | 18 % |

The page-load result describes the reported improvement, while the ad-viewability figure is reported as a value rather than an increase. Together with the migrated archive, they show what the project delivered without relying on an unstated baseline.

## What comes next

Tallgrass now has a publishing setup in which editorial content and frontend development can move at different paces. The newsroom can continue maintaining its archive in the CMS, while the development team can refine the reader experience without changing where stories are authored.

That distinction also makes future work easier to assess: a change to article presentation can be considered separately from a change to the content model. For another example of {{brand}}’s work on a publishing workflow, see [the Quillstack marketing site project]({{site}}/case-studies/quillstack/).
