excerpt: {{short}} Starter 3.0 gives teams a starting point for headless projects, with practical decisions about content, commerce and search still in their hands.
seoTitle: {{short}} Starter 3.0: a foundation for headless sites
seoDescription: Meet {{short}} Starter 3.0, an open-source starting point for headless projects, and learn how to plan content delivery, commerce and search.

{{short}} Starter 3.0 is a milestone for our open-source starter kit for [Next.js](https://nextjs.org) and a headless CMS. I’m Mara Lindqvist, Head of Engineering at {{brand}}. The starter gives teams a foundation for a headless project while leaving room to choose how content and services fit together.

## Start with content delivery

A starter can help establish a project, but the content model and publishing workflow still need attention. Decide which pages editors will manage, how entries relate to one another and how published changes should reach visitors.

> I want teams to spend less time setting up a project and more time making it useful for the people who publish and read its content.

For delivery decisions, our guide to [caching CMS content]({{site}}/blog/nextjs-app-router-cms-caching/) explains the considerations in the Next.js App Router.

## Make room for commerce

A headless storefront has to bring product data, editorial content and the buying journey together. [Payload](https://payloadcms.com) is one example of a CMS teams can evaluate for managing content; the commerce platform is a separate decision.

Before choosing a platform, consider:

- Where product information will be managed.
- How editorial pages will reference products and collections.
- Which parts of the buying journey need to change as the business grows.

Our look at [headless commerce platforms]({{site}}/blog/top-headless-commerce-platforms/) offers a starting point for that evaluation.

## Plan search around users

Search is most useful when it reflects what visitors are trying to find. A documentation site may need to surface individual sections, while a store may need filters for product attributes.

Think about which content should be indexed, how quickly updates need to appear and who will maintain relevance. For a closer look at two options, see our [comparison of Algolia and Typesense]({{site}}/blog/algolia-vs-typesense/).

## Take the next step

The current starter version is 3.2. To install it, run `npx create-headless-starter`. From there, the work is to shape the project around its editors, content and audience.

{{brand}} has delivered 180 projects since its founding in 2015. If you need help planning or building a project, explore our [headless CMS development services]({{site}}/headless-cms-development/).

## FAQ

### What is {{short}} Starter?

It is an open-source starter kit for projects built with Next.js and a headless CMS.

### Is version 3.0 the current release?

No. Version 3.2 is the current version of the starter.

### How do I install the starter?

Run `npx create-headless-starter` to install the current version.

### Does a headless project need search?

Not necessarily. The decision depends on the amount of content and how visitors need to find it.
