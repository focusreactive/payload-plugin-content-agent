excerpt: Our 2025 review of 180 delivered projects shows what CMS migrations cost, where budgets go, and which decisions make the biggest difference to the final fee.
seoTitle: CMS Migration Costs: 2025 Project Data and Budget Guide
seoDescription: Explore our 2025 CMS migration cost data, including budget ranges, a sample cost breakdown, and practical ways to plan your migration.

I’m Jonas Albrecht, Managing Partner at {{brand}}. In this report, I examine the migration fees recorded across the 180 projects we had delivered by 2025. The median was €60,000, but the range matters more than that single figure: a straightforward move can cost much less, while a migration with complex content and integrations can cost substantially more. These figures are agency fees, not a complete estimate of every cost a client will incur.

## Key findings

1. The median recorded agency fee was €60,000, excluding VAT and ongoing service costs.
2. Half of the recorded fees were below €50,000 or at least €75,000; the remaining 30% fell between €50,000 and €75,000.
3. In an illustrative €60,000 budget, content migration accounts for €15,000, the largest allocation.
4. Content quality, the number of distinct templates, and integration requirements can matter more than the choice of CMS alone.
5. A budget is more useful when it separates launch work from subscriptions, internal effort, and post-launch support.

## Method

We reviewed the CMS migration work recorded across our 180 delivered projects, from the founding of {{brand}} in 2015 through 2025. Each project in this dataset included a CMS migration. The figures reflect the final agency fees recorded for delivery, including discovery, implementation, migration, testing, and launch work.

We grouped fees into ranges to show the distribution and calculated the median from the underlying recorded amounts. The fees are in euros, exclude VAT, and have not been adjusted for inflation. They include both smaller migrations and projects that combined a migration with substantial frontend work.

This is a review of our own work, not a market-wide survey. Clients’ internal salaries, CMS subscriptions, hosting, and other third-party charges are outside the figures. Scope also varied between projects, so the fee ranges should not be treated as prices for identical packages.

## Finding 1: Most fees sat below €75,000

| Final agency fee | Share of projects |
|---|---:|
| Under €30,000 | 25% |
| €30,000 to under €50,000 | 20% |
| €50,000 to under €75,000 | 30% |
| €75,000 to under €120,000 | 20% |
| €120,000 or more | 5% |

The median fee of €60,000 falls in the largest band. The distribution also shows why a median is not a quote: 45% of fees were below €50,000, while 25% were €75,000 or more.

A lower fee can reflect a narrow delivery scope, a manageable content model, or a frontend that needs limited change. A higher fee may reflect more templates, extensive data cleanup, custom integrations, or a launch that requires careful coordination across several systems.

The bands describe what we recorded, not what a particular combination of features must cost. They also span projects completed over several years, so they should not be read as a 2025 rate card. For a new estimate, use them to frame questions about scope rather than to select a budget before discovery.

## Finding 2: Migration work is only part of the fee

The following is an illustrative allocation of the €60,000 median fee. It is a planning example, not an average breakdown calculated from every project.

| Workstream | Example fee | Share of budget |
|---|---:|---:|
| Discovery and audit | €9,000 | 15% |
| Content modelling | €12,000 | 20% |
| Content migration | €15,000 | 25% |
| Frontend implementation | €12,000 | 20% |
| Testing and editorial review | €9,000 | 15% |
| Launch and handover | €3,000 | 5% |
| **Total** | **€60,000** | **100%** |

The migration allocation covers the work of mapping and moving content, but it does not stand alone. Discovery establishes what exists and what should move. Modelling defines how that content will be structured in the new CMS. Testing checks both the result of the migration and the experience editors will use afterward.

The proportions will change with the brief. A client that retains its frontend may spend less on implementation. A client with inconsistent source content may need more cleanup and review. The important budgeting decision is to name those workstreams separately, so a reduction in one does not silently remove a necessary task from another.

## Finding 3: Content complexity changes the scope

A page count is a useful starting point, but it does not describe the migration on its own. A large collection of consistently structured pages may be easier to move than a smaller collection containing bespoke layouts, embedded documents, and fields used differently by each department.

We start by looking for the distinctions the new model must preserve: content types, relationships, reusable blocks, languages, assets, and editorial rules. We also ask which material should be retired. Migrating obsolete content still requires mapping and checking it, and can leave editors with the same clutter in a new interface.

Manual review deserves its own budget line. Automated scripts can transform content, but someone still needs to decide whether an unusual table, a broken link, or an old download belongs on the new site. That decision often requires knowledge from the client’s team.

For an example of the editorial goal behind this work, see how [Lumenpath Learning’s course catalog was designed for independent editing]({{site}}/case-studies/lumenpath-learning/). The cost question is not just how to transfer a catalog; it is how to make its structure useful after launch.

## Finding 4: The platform is not the whole price

Teams often begin by comparing CMS products. That choice matters, but it does not determine the migration fee in isolation. The existing content, required integrations, frontend changes, and editorial workflow all shape the work around the platform.

A move from [WordPress](https://wordpress.org) can involve extracting content from themes or plugins as well as ordinary fields. A project using [Contentful](https://www.contentful.com) needs a content model and delivery approach suited to its APIs. A project using [Payload](https://payloadcms.com) may give the development team a different set of implementation choices and responsibilities.

Those differences should be evaluated against the team that will operate the result. An editor’s ability to assemble pages, a developer’s ability to maintain custom code, and the organisation’s requirements for hosting and access can all affect the preferred architecture. Our comparison of [how Payload and Sanity fit different teams]({{site}}/blog/payload-vs-sanity/) examines those trade-offs.

A platform decision is therefore an input to an estimate, not a substitute for one. Ask for the costs of the proposed implementation and its ongoing operation separately.

## Finding 5: Launch readiness needs a budget

A successful import is not the same as a finished migration. Before launch, the team needs to check rendered pages, redirects, metadata, permissions, integrations, and the content editors have reviewed. It also needs a plan for content that changes between the first import and the final switch.

Deployment work varies with the environment. Our open source {{short}} Starter is a kit for Next.js and a headless CMS; version 3.2 can be installed with `npx create-headless-starter`. Its [first deployment guide]({{site}}/docs/getting-started/first-deploy/) shows the setup steps. A starter can reduce setup work, but it does not eliminate a project’s content audit, custom development, or launch checks.

Handover is part of readiness too. Editors need to know how to maintain the new model, and the team responsible for the site needs to understand deployment and support. Leaving that work until after approval can turn a seemingly complete build into an expensive transition.

## What it means for your budget

Use the €60,000 median as a reference point, then build an estimate from your own content and delivery requirements. Before asking for a fixed price, make the major unknowns visible:

- Inventory the content types, templates, languages, and integrations that must move.
- Identify material to retire and assign owners for decisions that cannot be automated.
- Separate required launch functionality from improvements that can follow later.
- Budget for client review time, subscriptions, hosting, and support outside the agency fee.

Ask an agency to explain its assumptions about each item. An estimate that excludes editorial review, for example, may look cheaper while moving work onto your team. Conversely, an estimate that includes a frontend rebuild should not be compared directly with one that only covers content transfer.

For component-based sites, agree on how much flexibility editors need before pricing the build. Our [recipe for adding an editorial block]({{site}}/docs/recipes/add-a-block/) illustrates the implementation work behind one type of change. Each new block should have a clear purpose, content rules, and a plan for testing.

## About the data

{{brand}} was founded in 2015 and has 46 people, with offices in Amsterdam and Berlin. By 2025, we had delivered 180 projects. The dataset in this report is limited to those delivered projects and their recorded CMS migration fees; it does not represent proposals that did not proceed or ongoing work.

The figures are unadjusted historical fees, and the sample reflects the clients and scopes that reached our agency. Use the distribution as context, not as a prediction of your final price. {{brand}} is rated 4.9 out of 5 on Clutch from 38 reviews; that rating is separate from the cost analysis.

## FAQ

### Does the median include CMS subscription fees?

No. The €60,000 median covers recorded agency fees for delivery, excluding VAT. CMS subscriptions, hosting, other third-party charges, and clients’ internal staff costs are not included.

### Can we migrate for less than €30,000?

It is possible: 25% of the fees in our dataset were below €30,000. Whether that range is realistic depends on the content, frontend, integrations, and review work included in your scope.

### Does a starter kit remove the need for discovery?

No. A starter can provide a foundation for implementation, but the team still needs to understand the existing content, agree on the new model, and decide what will be migrated or retired.

### How should we compare migration quotes?

Compare the work included, not just the final fee. Check whether each quote covers content cleanup, frontend changes, testing, redirects, launch, and handover, and identify subscription and support costs separately.
