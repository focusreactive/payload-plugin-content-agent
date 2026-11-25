excerpt: A survey of 240 content practitioners finds that reliable previews, clearer workflows and better content structure top editors’ priorities in 2026.
seoTitle: Editor experience survey 2026: content team priorities
seoDescription: Explore findings from a 2026 survey of 240 content practitioners, including their priorities for previews, workflows, content models and localization.

Content teams are being asked to publish across more channels without losing control of the details that make each experience useful. In our 2026 survey of 240 content practitioners, the strongest request was not for another publishing channel. It was for confidence in the work already in front of them: seeing changes accurately, knowing who should act next and finding the right fields without guesswork.

## Key findings

Respondents selected one improvement they most wanted in their editing environment. Reliable preview came first, followed by clearer workflows. Together, those two priorities accounted for more than half of responses.

| Most wanted improvement | Respondents | Share |
|---|---:|---:|
| More reliable preview | 72 | 30% |
| Clearer review and approval workflows | 60 | 25% |
| Easier-to-understand content models | 48 | 20% |
| Better localization support | 36 | 15% |
| Faster editing interface | 24 | 10% |
| Total | 240 | 100% |

The results point to four priorities for teams planning changes:

1. Make preview trustworthy enough to support editorial decisions.
2. Make ownership and approval steps visible in the workflow.
3. Give fields and content types names that match how people work.
4. Treat localization as an ongoing editorial process, not a final publishing step.

The rankings describe respondents’ top choice, not the only improvements they want. A team that selects preview may also struggle with approvals or translation.

## Method

The survey ran online from 1 to 28 February 2026 and received 240 completed responses from people who work on content in a CMS. Participants were recruited through outreach to content teams and agency channels. Participation was voluntary.

The questionnaire asked respondents to choose their single most wanted improvement and to identify editing difficulties they had encountered in a typical week. For the weekly difficulties question, respondents could select more than one answer, so those totals do not add up to 240.

The survey covered work in headless and other CMS environments, including [Sanity](https://www.sanity.io), [Storyblok](https://www.storyblok.com) and [Payload](https://payloadcms.com). It did not ask respondents to rate those products against one another. The results reflect participants’ reported experiences across their own setups, including their organization’s processes and implementations.

This was a non-probability sample, not a representative census of content teams. Percentages are useful for understanding the responses in this group; they should not be treated as estimates for every CMS user.

## Preview needs to support decisions

Preview was the most frequently selected top improvement: 72 respondents, or 30%, wanted it to be more reliable. Separately, 144 respondents, or 60%, reported a preview-related difficulty in a typical week.

The weekly question gives a broader view of friction than the priority ranking. Someone could encounter a preview problem but still consider another change more important. The survey did not measure how long each difficulty lasted or whether it delayed publication.

For an editor, a useful preview needs to answer a practical question: does this change make sense in the context where a reader will see it? A field-level view can confirm that copy is present, but it may not show a long heading wrapping badly, a missing image crop or an unexpected relationship with adjacent content.

Teams can start by identifying the decisions editors currently make after publication because they cannot make them confidently beforehand. Those decisions may require a preview of a whole page, a particular device width or a draft assembled from several entries. The right scope depends on the publishing workflow, not just the CMS.

Preview should also be considered separately from public-site performance. Our [measurement of 60 headless sites]({{site}}/blog/headless-performance-benchmark-2026/) looks at the latter; a fast public page does not by itself make an editorial preview accurate.

## Workflow problems are ownership problems

Clearer review and approval workflows were the top request for 60 respondents, or 25%. In the weekly difficulties question, 120 respondents, or 50%, reported a handoff or approval difficulty.

The distinction matters. A workflow can have formal stages and still leave people unsure who owns the next action. An entry marked “in review” may be waiting for a subject expert, a legal reviewer or the editor who requested the change. If that responsibility is visible only in a separate conversation, the status tells an incomplete story.

Start by mapping the decisions that genuinely require approval. Then make the owner, expected action and return path clear at each stage. A reviewer should know whether they are checking factual accuracy, approving wording or authorizing publication; those are different responsibilities.

Not every piece of content needs the same route. A correction to an existing page may need a shorter process than a new regulated claim. The goal is not to remove oversight, but to apply it consistently enough that editors can predict what happens next.

The survey did not ask which approval arrangements respondents use, so it cannot identify a single best workflow. It does show that handoffs are a recurring concern for half of this sample.

## Content models shape daily work

Easier-to-understand content models were the top improvement for 48 respondents, or 20%. The weekly question also found that 132 respondents, or 55%, had difficulty finding the right content or field.

The table below shows all five weekly difficulty categories. Respondents could select several, so the percentages should be read independently.

| Difficulty encountered in a typical week | Respondents | Share |
|---|---:|---:|
| Preview-related difficulty | 144 | 60% |
| Finding the right content or field | 132 | 55% |
| Handoff or approval difficulty | 120 | 50% |
| Localization-related difficulty | 96 | 40% |
| Slow editing interface | 84 | 35% |

A content model is more than a technical schema. It determines the choices an editor sees, the relationships they must understand and the information they need to provide before publishing. If field names reflect implementation details rather than editorial tasks, people have to translate between the interface and the work they are trying to do.

Review the model with people who use it. Ask them to locate an existing item, create a common page and explain where shared content comes from. Watch for places where they rely on memory or ask a colleague which field is safe to change.

Our [guide to designing content models]({{site}}/docs/guides/content-modeling/) covers the underlying structures. In practice, labels, help text and sensible validation are part of making those structures usable. Simplifying a model does not always mean removing fields; it can mean making their purpose and relationships clearer.

## Localization needs visible context

Better localization support was the top choice for 36 respondents, or 15%. A larger group, 96 respondents, or 40%, reported a localization-related difficulty in a typical week. The survey did not establish how many respondents published in multiple languages, so the weekly figure should not be interpreted as a rate among multilingual teams.

Localization work often crosses several roles. An editor may need to know whether source copy is final, whether a translation is current and whether a local reviewer has approved it. Without that context, a translation can appear complete while still referring to an older version of the source.

Make the relationship between source and localized content visible. Where possible, show the state of each locale and give reviewers a way to identify what changed. Agree on which content is shared, which can vary locally and who is responsible for approving each version.

The approach should fit the organization’s publishing model. [Verdan Health’s six-language platform]({{site}}/case-studies/verdan-health/) offers one example of organizing content across languages; another team may need different ownership or review rules. Adding a locale is only the beginning of the work needed to keep it useful.

## What it means

The findings favor improvements that reduce uncertainty during ordinary publishing work. Preview, workflow and content structure are connected: an editor needs to find the right entry, understand its state and see the result before it goes live.

A practical improvement plan can begin with a short review of a frequent publishing task:

- Follow one item from draft to publication and record where responsibility changes.
- Check whether the preview shows the context needed for the decision at that stage.
- Identify fields that require an explanation outside the interface.
- For localized content, check how editors recognize an outdated translation.

Use the observations to choose a small change, then repeat the task with editors. A clearer field label may be enough in one place; another problem may require a change to permissions, preview infrastructure or the approval process.

For teams using {{short}} Starter, the [steps for adding a locale]({{site}}/docs/recipes/add-a-locale/) provide a technical starting point. They should be paired with decisions about translation ownership and review. Similarly, interface speed matters: 84 respondents reported a slow editing interface in a typical week, even though it was the top improvement for 24.

## About the data

All counts in this report refer to the 240 completed responses. Shares use 240 as the denominator and are reported as whole percentages. The top-improvement question required one selection; the weekly-difficulties question allowed multiple selections.

The survey captures reported experience, not observed task performance. It does not establish that a particular CMS, implementation choice or organizational process caused a difficulty. Nor does it measure whether a proposed improvement would reduce publishing time.

{{brand}} conducted the survey to inform conversations about editor experience. We recommend using these findings as a starting point for research with your own content team, especially before changing a model or workflow that supports existing published content.

## FAQ

### Who took part in the survey?

The survey received 240 completed responses from people who work on content in a CMS. Participants were recruited through outreach to content teams and agency channels, and participation was voluntary.

### What was the most requested improvement?

Reliable preview was the most requested single improvement, selected by 72 respondents, or 30%. Clearer review and approval workflows followed, selected by 60 respondents, or 25%.

### Why do the weekly difficulty percentages add up to more than 100%?

Respondents could select more than one difficulty they encountered in a typical week. Each percentage uses all 240 respondents as its denominator.

### Does the survey rank CMS products?

No. The survey asked about editorial experiences across participants’ own environments. It did not ask respondents to rate products against one another or establish which product caused a reported difficulty.
