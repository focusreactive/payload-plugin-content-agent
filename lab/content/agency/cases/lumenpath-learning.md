summary: Lumenpath Learning launched a course catalog that its editors can maintain without routine developer help. The project brought content design and development together in a publishing workflow built for a US education company.

## The client

Lumenpath Learning is a US education company that presents its courses to prospective learners through an online catalog. Its editorial team needs to explain what each course covers, who it is for, and how a learner can take the next step. Those details change as the catalog evolves, so the website has to be useful to the people maintaining it as well as to the people browsing it.

For the 2025 launch, Lumenpath worked with {{brand}} on design and development. The brief centered on a practical goal: give editors control over course information without making them responsible for the underlying code.

## The challenge

The catalog had to serve several audiences at once. Learners needed clear, consistent information to compare courses. Editors needed a way to keep that information current. Developers needed to establish a reliable foundation without becoming the gatekeepers for ordinary content changes.

The project focused on these problems:

- Course details needed a consistent structure, while leaving editors room to explain what made each offering distinct.
- Routine publishing depended too heavily on developer involvement.
- Editors needed confidence about how their changes would appear on the public site.
- The catalog design had to make course information easy to scan without reducing every page to an identical template.

The work was not simply a matter of adding an editing interface. The team also had to decide which decisions belonged in the content model and which belonged in the design system, so that editorial freedom would not come at the expense of consistency.

## The approach

{{brand}} brought design and development together around the daily work of the Lumenpath team. The project used [Payload](https://payloadcms.com) for content management and [Next.js](https://nextjs.org) for the website. The team’s [Payload development work]({{site}}/payload-cms-development/) provided a foundation for shaping the editing experience around the catalog rather than around individual page requests.

The work moved through these phases:

1. **Discovery and content planning.** The teams identified the information learners needed to evaluate a course and the changes editors expected to make regularly.
2. **Design and content modeling.** Course information was organized into reusable fields, while page layouts established a clear hierarchy for browsing and reading.
3. **Development and integration.** The content model was connected to the public website, with editing controls designed around the responsibilities of the Lumenpath team.
4. **Review and launch.** Editors reviewed the experience with the delivery team, and the site was prepared for the 2025 release.

This sequence gave editorial work a place in the project from the start. Rather than designing finished pages and asking editors to fit their work into them later, the team considered how course information would be created, revised, and maintained.

## The solution

The finished catalog separates course content from its presentation. Editors work with recognizable content fields instead of changing page code, while the website uses that content to produce a consistent experience for learners.

The design makes the essential course information prominent and gives supporting details their own place. That helps visitors move from an overview to a fuller description without having to reconstruct the same facts from differently structured pages. It also gives editors a repeatable way to prepare a new entry or revise an existing one.

On the CMS side, the content structure provides a shared framework for the team. The fields guide editors toward the information a course page needs, while leaving room for the language and context particular to that course. The result is not a locked-down template; it is a defined publishing space with boundaries that support consistency.

The development work connected that editing experience to the Next.js front end. Responsibilities are clearer as a result: editors manage course content, while developers maintain the application and its integrations. Changes to ordinary catalog copy no longer need to be treated as code changes.

> “We wanted the catalog to be something our team could look after, not a queue of requests waiting for someone else. The new workflow gives us a clear way to make changes and see them through.”
>
> — Maya Chen, Content Lead at Lumenpath Learning

## The results

The project launched in 2025. Lumenpath reported the following figures for the work:

| Metric | Before | After |
| --- | --- | --- |
| Publishing speed | Not provided | 4 x |
| Developer tickets | Not provided | 70 % |
| Time to launch | Not provided | 4 months |

The supplied figures do not include a baseline for the table or specify how the developer-ticket percentage was calculated. The broader operational change is clear from the scope of the solution: the editorial team has a defined place to manage catalog content, while development support can focus on the application rather than routine copy updates.

## What comes next

The catalog gives Lumenpath a foundation for maintaining its course information as its offering changes. Its immediate priority is to keep using the shared content structure and editorial workflow so that new and revised entries remain useful to learners.

The project also illustrates an approach {{brand}} applies across content-rich websites: start with the decisions people need to make, then build the publishing tools around them. A different example is [the travel planning work for Alpenroute Travel]({{site}}/case-studies/alpenroute-travel/), where the content challenge called for its own structure and design.
