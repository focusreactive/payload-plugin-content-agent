excerpt: Use these eight questions to compare headless CMS agencies on content modeling, integrations, security, delivery and the costs that follow launch.
seoTitle: 8 Questions to Ask a Headless CMS Agency Before You Sign
seoDescription: Compare headless CMS agencies with eight practical questions about editorial workflows, integrations, security, pricing and long-term ownership.

A headless CMS can give your team more freedom to publish across websites and other channels, but the software alone will not determine whether the project succeeds. The agency has to understand how your editors work, how your systems exchange data and who will maintain the platform after launch. A polished demo rarely answers those questions.

I’m Jonas Albrecht, Managing Partner at {{brand}}. Since our founding in 2015, we have delivered 180 projects, and our team of 46 works from offices in Amsterdam and Berlin. The questions below are designed to help you assess any prospective partner, including us. Ask them before you approve a statement of work, and request enough detail to compare answers on the same terms.

## 1. Can you show us relevant work and explain your role?

Ask for examples that resemble your project in complexity, not just in visual style. A relevant example might involve multiple languages, a migration from an older CMS or integration with systems your team already uses. Find out which parts the agency actually delivered, which were handled by the client or another supplier, and what changed after launch. A case study can start the conversation, but it should not replace a discussion of decisions and trade-offs.

**Why it matters:** A portfolio image shows the result, not whether the agency can solve the problems behind your brief.

**A good answer:** The agency identifies its responsibilities, explains a comparable challenge and can discuss how it approached the work.

For example, our [Verdan Health case study]({{site}}/case-studies/verdan-health/) describes a content platform for six languages. If multilingual publishing is central to your project, ask how an agency would investigate your own translation process rather than assuming one implementation fits every organization. Reviews can provide another perspective: {{brand}} is rated 4.9 out of 5 on Clutch from 38 reviews. Treat that as one signal alongside relevant work, direct conversations and a clear account of who will be assigned to your project.

## 2. How will you design the content model with our editors?

Ask the agency to explain how it will turn your content into types, fields, relationships and reusable components. The answer should start with your actual publishing needs: who creates content, where it appears, what must be reused and which variations need editorial control. Request a sample model for a representative page or content type, including the fields an editor would see and the rules governing them.

**Why it matters:** A model that mirrors page designs too literally can make content hard to reuse, while an overly abstract one can make everyday publishing slow.

**A good answer:** The agency involves editors early, tests a proposed model against real content and explains the reasoning behind its field and component choices.

Discuss exceptions as well as the ideal case. Ask how the model would handle an article with multiple authors, a campaign page with optional sections or a product referenced in several places. Agree on who can add or change content types later and how those changes will be reviewed. Our [guide to modeling content]({{site}}/docs/guides/content-modeling/) offers a starting point for that discussion. Before signing, look for a plan to validate the model with the people who will use it, not just a promise to deliver a schema.

## 3. How will you handle languages and regional differences?

If you publish in more than one market, ask the agency to map the complete lifecycle of a translated page. That includes creating a locale, sending content for translation, reviewing it, publishing it and updating it when the source changes. Clarify whether markets need different copy, images, legal text or page availability, and who has authority to approve each version.

**Why it matters:** Translation is an editorial and operational process, not merely a setting in the CMS.

**A good answer:** The agency distinguishes language from regional requirements and explains how missing, outdated and market-specific content will be managed.

Ask what visitors will see when a translation is missing and whether fallback content is acceptable for every field. A fallback may be useful for a product description but inappropriate for a legal notice. Also discuss localized URLs, search metadata and the way editors will know which versions need attention. The [recipe for adding a locale]({{site}}/docs/recipes/add-a-locale/) in our starter documentation illustrates one implementation task; your agreement should also cover the people and decisions around it. If translation services or connectors are needed, identify who will configure them and whether their fees are included.

## 4. How will the CMS connect to our existing systems?

Give each agency a list of the systems that must exchange information with the new platform, such as a product information system, search service or customer database. For each connection, ask which system is authoritative, what data moves, how often it moves and what happens if an update fails. Request a simple integration diagram and a list of assumptions that still need to be tested.

**Why it matters:** An attractive frontend cannot compensate for duplicated data, unreliable synchronization or unclear ownership between systems.

**A good answer:** The agency names the source of truth for each integration, describes the data flow and includes failure handling in its estimate.

Probe how the team will investigate access, API limits and data quality before committing to a fixed scope. Ask whether integrations are one-way or two-way, how credentials will be managed and who will be alerted when a job fails. If the agency proposes custom middleware, find out where it will run and who will maintain it. A useful proposal also identifies dependencies on your internal teams and third-party vendors. Those dependencies should appear in the schedule, with a process for revising it if access or decisions arrive late.

## 5. How will you measure performance and manage images?

Ask for a performance plan that covers the published experience, not just the CMS itself. It should identify representative page types and devices, explain where content will be rendered or cached, and define how the team will test before and after launch. Discuss image dimensions, formats, responsive delivery and editorial controls for crops and alternative text.

**Why it matters:** A flexible content platform can still produce slow pages if images, frontend code and delivery decisions are not managed together.

**A good answer:** The agency proposes measurable targets, tests realistic pages and explains which factors its team can control.

Request a baseline for the current site where one exists, then agree on targets appropriate to the new site and its audience. Ask how the agency will handle a large image uploaded by an editor and whether previews accurately show important crops. Our article on [optimizing images for headless delivery]({{site}}/blog/image-optimization-headless-cms/) covers questions to bring into that conversation. Do not accept a blanket promise that the site will be fast: the proposal should say what will be measured, in which conditions, who will review the results and what happens if the agreed targets are missed.

## 6. How will you protect access and prepare for incidents?

Ask the agency to describe access for editors, developers, administrators and external suppliers. Discuss single sign-on if your organization requires it, as well as role-based permissions, account removal and the handling of secrets. The agency should also explain how draft content is protected in preview environments and how production access differs from access to development systems.

**Why it matters:** A headless architecture introduces connections and deployment environments that need clear security responsibilities.

**A good answer:** The agency provides a practical access and incident plan, identifies shared responsibilities and avoids promising that any system is risk-free.

Include backups, restoration and dependency updates in the discussion. Ask what is backed up, who can initiate a restore and how the team will test the recovery process. For an incident, establish who receives the first alert, how you will be contacted and which supplier owns each response. Check that these commitments are reflected in the contract or support agreement rather than left in a sales presentation. If your security team has procurement requirements, involve it before the scope is finalized so that reviews, access controls and remediation work are accounted for.

## 7. What will delivery look like, and how will we make decisions?

Request a delivery plan that shows discovery, design, implementation, migration, testing and launch preparation. It should identify the people needed from your side, the decisions they must make and the points at which you can review working software. Ask how the agency will surface risks and what happens when a requirement changes after work begins.

**Why it matters:** Delays often arise from unresolved decisions and dependencies, not from coding alone.

**A good answer:** The agency provides a staged plan with named responsibilities, review points and a transparent process for managing changes.

Find out whether the team presenting the proposal will also work on the project, and ask who will lead delivery day to day. Agree on what constitutes acceptance for important deliverables, including the content model, integrations and migrated content. If the agency uses a starter kit, ask what it supplies and what still needs to be built. Our open-source {{short}} Starter is for Next.js and a headless CMS; version 3.2 is installed with `npx create-headless-starter`. A starter can provide a foundation, but the proposal should distinguish that foundation from project-specific work and testing.

## 8. What will we own, and what will the project cost after launch?

Ask for a breakdown of implementation fees, recurring software and hosting costs, and optional support. The proposal should state which third-party subscriptions you need, who contracts with each provider and which costs can change with usage. Also ask who owns the source code, content, configurations and design assets, and how you will access them if the relationship ends.

**Why it matters:** A low initial quote is less useful if essential services, handover or ongoing maintenance appear later as surprises.

**A good answer:** The agency separates one-time and recurring costs, explains its assumptions and documents ownership and exit arrangements.

Look for a handover plan covering repositories, deployment procedures, documentation and administrator access. Ask what training is included for editors and developers, how support requests are prioritized and what is excluded from the support fee. If pricing depends on content volume, traffic or integration usage, request the assumptions behind the estimate and revisit them when your requirements change. Finally, establish how you can export content and take over operations. You should not need an adversarial exit to learn where the code lives or how the site is deployed.

## How we chose

These questions focus on decisions that affect both the launch and the years that follow. They are useful whether you are replacing an existing platform or building a new one.

- We prioritized topics you can investigate before signing, when scope and responsibilities are still negotiable.
- We included editorial work alongside technical delivery because both affect adoption.
- We focused on evidence and specific commitments rather than claims about a preferred technology.
- We included ownership and operating costs so you can compare the full engagement, not only the initial build.

## Summary

| Question | What to look for |
| --- | --- |
| Relevant work and role | Comparable challenges and a clear account of the agency’s contribution |
| Content modeling | Editor involvement and validation against real content |
| Languages and regions | A workflow for translation, approval and missing content |
| Existing systems | Sources of truth, data flows and failure handling |
| Performance and images | Measurable targets and realistic testing |
| Security and incidents | Access controls, recovery plans and named responsibilities |
| Delivery and decisions | Review points, team roles and change management |
| Ownership and cost | Recurring fees, handover, access and exit terms |

## FAQ

### Do we need to choose a CMS before hiring an agency?

No. An agency can help you evaluate products against your editorial, integration and security requirements. If you have already chosen one, ask the agency to explain its experience with that product and any constraints it expects.

### Should we insist on a fixed-price project?

Not necessarily. A fixed price can help with budgeting when the scope is well understood, but uncertain integrations or migration work may need further discovery first. Compare what each proposal includes, its assumptions and how changes will be priced.

### Who should join the agency selection process?

Include a decision-maker, an editor who will use the CMS, a technical representative and someone responsible for security or procurement. Their involvement helps expose requirements that might otherwise emerge after the contract is signed.

### What should a handover include?

At minimum, agree on access to the source repository, CMS and deployment accounts, along with documentation for operating the platform. Include editor and developer training, a record of outstanding issues and a clear route for getting support.
