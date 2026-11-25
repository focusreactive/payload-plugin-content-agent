excerpt: A practical guide to designing draft, preview, approval and publishing workflows that give editors confidence without slowing down delivery.
seoTitle: Headless CMS Editorial Workflows: Draft to Publish
seoDescription: Learn how to design drafts, secure previews, approvals and publishing controls in a headless CMS, with practical examples for editorial teams.

A headless CMS separates content management from the websites and applications that display it. That separation gives teams flexibility, but it also means a familiar “Publish” button is only one part of the workflow. Editors need to see unpublished changes in context, reviewers need to know which version they are approving, and developers need to keep draft content out of public responses. I’m Ines Okafor, Content Strategist at {{brand}}. This guide walks through the decisions that make those steps reliable, from the first draft to a safe release.

## Define the states before choosing the buttons

Start by agreeing on what each state means, who can change it and what happens to the public site. A simple workflow can cover most articles without forcing every typo through a lengthy review.

| State | What it means | Typical owner | Public effect |
|---|---|---|---|
| Draft | Content is being written or revised | Author | None |
| In review | A specific revision is ready for feedback | Editor | None |
| Approved | The reviewed revision is cleared for release | Approver | None |
| Scheduled | An approved revision has a release time | Publisher | Goes live at the scheduled time |
| Published | The revision is available to delivery channels | Publisher | Visible after delivery and cache updates |

An existing published article can also have unpublished changes. Treat the live version and the working revision as distinct: saving a correction should not silently replace what readers see.

[Payload](https://payloadcms.com), [Sanity](https://www.sanity.io) and [Storyblok](https://www.storyblok.com) all support editorial workflows, but their interfaces and configuration differ. For example, Storyblok offers a visual editor, while Payload gives developers control over the application and content model. Check the capabilities and plan of the product you choose rather than assuming that approvals, scheduling and visual preview work identically across platforms.

The table is a shared vocabulary, not a mandate to build five custom states. If a CMS represents scheduled publication separately from editorial status, document that distinction. What matters is that authors can tell what is live, what is changing and who has the next move.

## Model content for revision and review

A preview is only useful if the content model captures what reviewers need to assess. Give an article a title, summary, body, author, featured image and search metadata where those fields are relevant. Mark genuinely required fields as required, but avoid blocking an early draft because its final image has not been selected.

### Separate editorial fields from delivery fields

A public URL segment and publication date affect delivery. An internal review note does not. Keep those concerns distinct so that notes cannot accidentally appear in an API response used by the public site.

For reusable content, decide whether a revision points to a specific version of a shared item or to its latest version. A page approved with one promotional banner might look different at publication if that shared banner changes in the meantime. Either pin the dependency or make the reviewer aware that it can change independently.

### Establish ownership

Assign an owner for each decision, not just each document. An author can propose a change, an editor can approve wording, and a publisher can release it. For a small team, one person may hold more than one role; the record should still show which action they took.

Include these rules in the model or accompanying workflow:

- Record the revision and time associated with an approval.
- Clear or renew approval when a substantive edit changes that revision.
- Make the person responsible for publication visible.
- Keep a history of changes and releases for recovery.
- Define what happens when a referenced asset is removed or replaced.

Test the model with an existing article, including its images and links. A model that looks tidy in a diagram can still be awkward when an editor needs to update a single paragraph without disturbing the rest of the page.

## Give editors a secure, representative preview

A preview should show the draft through the same templates and components used by the live site. It should also make clear that the viewer is looking at unpublished content. A prominent preview banner is more useful than a subtle change in the browser address.

### Connect the CMS to the frontend

For a Next.js site, Draft Mode can tell the application to request draft content. The following route enables it after checking a shared secret and a restricted article slug. It illustrates the frontend entry point; the page must still fetch the appropriate draft from the CMS.

```ts
import { draftMode } from 'next/headers'
import { redirect } from 'next/navigation'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const secret = process.env.PREVIEW_SECRET
  const slug = params.get('slug')

  if (
    !secret ||
    params.get('secret') !== secret ||
    !slug ||
    !/^[a-z0-9-]+$/.test(slug)
  ) {
    return new Response('Invalid preview request', { status: 401 })
  }

  const draft = await draftMode()
  draft.enable()
  redirect(`/articles/${slug}`)
}
```

The slug restriction prevents the request from choosing an arbitrary redirect destination. Store the secret outside source control, rotate it if exposed and avoid logging preview URLs: a secret in a query string can leak through logs or browser history. For stronger protection, use authenticated, short-lived preview links and verify that the viewer is allowed to see the content.

Draft Mode is not an access-control system for your CMS. Use a server-side credential with only the permissions needed to read drafts, never send that credential to the browser, and ensure draft responses are not shared through a public cache. Provide a way to exit preview mode as well.

> **Practical tip:** Review a draft on both a narrow screen and a wide screen. Check image crops, long headings and calls to action before asking for final approval.

Preview also needs a fallback for missing content. An editor should see a useful message when a required asset or related entry is unavailable, rather than a blank page. Our [Next.js development work]({{site}}/nextjs-development/) follows the same principle: editorial tooling is part of the application experience, not an afterthought.

## Make review a repeatable sequence

A review process works when everyone knows what to do next and which version is under discussion. Comments in a chat can help resolve questions, but the approval itself should be attached to the content revision or recorded alongside it.

1. **Prepare the draft.** The author completes the content, adds assets and checks the preview for obvious layout problems.
2. **Request review.** The author identifies the reviewer, the deadline and any specific questions, such as whether a claim needs verification.
3. **Review the rendered page.** The reviewer checks meaning, links, accessibility and presentation, not only the text fields in the CMS.
4. **Resolve feedback.** The author makes changes and requests another review when the revision has materially changed.
5. **Approve the revision.** The approver confirms the exact version that may be published, including any referenced content that needs approval.
6. **Publish and verify.** The publisher releases it, then checks the public page and its important links.

Not every change needs the same route. A low-risk correction might be publishable by a trusted editor, while a policy page may require an additional subject-matter review. Document the exceptions so that they do not become invisible shortcuts.

When moving an existing site, map old statuses and user roles before importing content. An imported “published” flag does not necessarily explain whether a page was reviewed, who owns it or whether its media is still valid. The [migration checklist we use]({{site}}/blog/wordpress-to-headless-migration-checklist/) is a useful companion for checking those dependencies before the new workflow takes over.

## Publish the approved revision, not merely the latest draft

The key publication rule is straightforward: if a change occurs after approval, the system must not treat the new revision as approved automatically. The following TypeScript function expresses that rule without assuming a particular CMS:

```ts
type Revision = {
  id: string
  approvedRevisionId: string | null
  requiredFieldsComplete: boolean
}

function canPublish(revision: Revision): boolean {
  return (
    revision.requiredFieldsComplete &&
    revision.approvedRevisionId === revision.id
  )
}
```

A production implementation also needs authorization, persistent revision history and an atomic check at publication time. Otherwise, a revision could change between the check and the release. Scheduled jobs should run the same checks when they execute, not only when someone first sets the schedule.

### Plan for delivery delays and failure

Publication in the CMS and visibility on the site may happen at different times. The frontend could need cache invalidation, a rebuild or another delivery step, depending on the architecture. Show editors a clear result: published in the CMS, delivery pending, delivered, or failed with a route to retry.

For time-sensitive releases, agree on the time zone and what happens if the delivery step fails. Keep the previous published revision available so an authorized person can restore it. A rollback is a new deliberate publication action, not an assumption that deleting a draft will undo a live change.

Hosting choices affect how these delivery steps are implemented. Compare the build, caching and operational needs of the workflow alongside the [hosting options for Next.js in 2026]({{site}}/blog/best-nextjs-hosting-platforms-2026/), rather than choosing a platform solely by its deployment interface.

## Operate the workflow after launch

A workflow is not finished when the first page goes live. Give editors a short operating guide covering how to request a preview, whom to ask for approval, how to schedule a release and what to do when publication fails. Use examples from the team’s own content types rather than a generic tour of every CMS screen.

Review permissions when people change roles. Authors may need draft access without permission to publish; temporary reviewers may need access to only a defined set of content. Audit logs help investigate unexpected changes, but someone must be responsible for checking and acting on them.

Also test the less frequent paths: an expired preview link, a scheduled release with a missing asset, a reverted article and a preview opened after an editor has signed out. These cases reveal whether error messages tell people what to do or merely report that something went wrong.

### Measure friction as well as speed

Track the time from review request to approval, the number of revisions returned for missing information and failed publication attempts. Interpret those measures with editors. A longer review may be appropriate for a sensitive page; a fast release is not useful if it bypasses necessary checks.

Finally, revisit the delivery setup when the content volume or release pattern changes. A comparison of [Vercel and Netlify for headless projects]({{site}}/blog/vercel-vs-netlify/) can help frame questions about deployment and operations, but the right choice depends on the application and the team maintaining it.

## FAQ

### Can editors work on a draft while the published page stays live?

Yes, if the CMS and delivery setup keep the working revision separate from the published version. Confirm that public requests read only published content and that saving a draft does not trigger an unintended public update.

### Does preview mode let anyone see unpublished content?

It should not. Restrict who can enter preview, protect draft-reading credentials on the server and prevent draft responses from entering public caches. A preview banner identifies the state for editors, but it is not a security control.

### Should every edit require approval?

Not necessarily. Set review requirements according to risk, content type and user permissions. A trusted editor might publish a spelling correction directly, while a substantive change to a policy page could need another approver.

### What happens if a scheduled publication fails?

The previous public version should remain available, and the responsible person should receive enough information to investigate and retry. Define that response in advance, including whether an urgent release can be published manually.
