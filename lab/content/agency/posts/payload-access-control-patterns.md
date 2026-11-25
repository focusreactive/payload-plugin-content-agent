excerpt: Learn how to design and test Payload CMS access control, from public and owner-scoped reads to protected fields and server-side integrations.
seoTitle: Access Control Patterns in Payload CMS: A Practical Guide
seoDescription: Learn to implement and test Payload CMS access control with role-based permissions, owner-scoped queries, field restrictions, and safe server-side access.

[Payload](https://payloadcms.com) gives you access-control functions alongside your collection and field configuration. That makes the rules visible in the same codebase as your content model, but it does not decide your policy for you. Before opening an API to a website or giving editors access to the admin panel, define who can read, create, change, and delete each record. Then test those decisions through the same execution paths your application uses.

This guide uses a small article collection to show public and owner-scoped reads, administrator-only writes, and field-level restrictions. The examples assume a user collection with a `role` field and a relationship from articles to their owners. Adapt the roles and ownership model to your project rather than treating either as a universal default.

## Start with a permission matrix

Write the expected outcomes before writing access functions. A matrix makes it easier to spot a contradiction, such as allowing editors to update a record while also allowing them to assign themselves an administrator role.

| Resource or action | Visitor | Authenticated user | Administrator |
|---|---|---|---|
| Read published articles | Allowed | Allowed | Allowed |
| Read unpublished articles | Denied | Own articles only | Allowed |
| Create, update, or delete articles | Denied | Denied | Allowed |
| Read an internal note | Denied | Denied | Allowed |
| Change an internal note | Denied | Denied | Allowed |

Here, “own” means the article’s `owner` relationship matches the authenticated user’s ID. Ownership grants read access, not edit access. An administrator assigns the owner when creating or updating an article; the example does not automatically assign the creator.

### Separate identity from permission

Authentication answers who made the request. Access control answers what that identity may do. A logged-in user is not automatically an editor, and an editor is not automatically entitled to change every field.

Keep roles small enough to explain. If the policy eventually needs organization membership, approval stages, or regional restrictions, model those explicitly rather than adding many overlapping roles. Review who can change role and membership fields too: a permission system is only as reliable as the data it uses to make decisions.

When comparing CMS options for a project, include permission requirements alongside publishing and integration needs. Our overview of [headless CMS platforms for 2026]({{site}}/blog/best-headless-cms-2026/) provides context for that wider decision.

## Understand where Payload applies rules

Payload supports access control at several levels. Collection access functions govern operations such as create, read, update, and delete. Field access functions can restrict individual fields within an otherwise accessible record. A collection’s admin configuration also controls parts of the editing interface, but hiding something in the interface is not a substitute for protecting it through access control.

For collection reads, updates, and deletes, an access function can return a boolean or a query constraint. Returning `true` permits the operation without an additional access filter; returning `false` denies it. A query constraint limits the records the operation can affect. Create access is a yes-or-no decision because the record does not yet exist to be filtered.

### Use constraints for record-level rules

For a public content site, a common rule is “published records are visible to everyone; unpublished records are visible to their owners.” A query constraint expresses that rule where Payload retrieves the records, instead of fetching a broad result and filtering it later in application code.

This matters for more than list pages. A direct request for an individual article must respect the same rule as a collection query. Otherwise, an unpublished article omitted from a listing could still be exposed when someone knows its ID.

> **Practical tip:** For every list permission you design, test a direct request for an allowed ID and another for a forbidden ID. Do not rely on the list view alone.

## Implement a scoped article read

The following collection implements the matrix’s article rules. It uses a regular `status` field, not Payload’s draft and versioning system. The example assumes that the authenticated user object exposes a `role` value and that administrators are responsible for assigning owners.

```ts
import type { CollectionConfig } from 'payload'

const isAdmin = (user: unknown): boolean =>
  Boolean(
    user &&
      typeof user === 'object' &&
      'role' in user &&
      user.role === 'admin',
  )

export const Articles: CollectionConfig = {
  slug: 'articles',
  access: {
    create: ({ req }) => isAdmin(req.user),
    update: ({ req }) => isAdmin(req.user),
    delete: ({ req }) => isAdmin(req.user),
    read: ({ req }) => {
      if (isAdmin(req.user)) return true

      if (req.user) {
        return {
          or: [
            { status: { equals: 'published' } },
            { owner: { equals: req.user.id } },
          ],
        }
      }

      return { status: { equals: 'published' } }
    },
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'unpublished',
      options: ['unpublished', 'published'],
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
    },
  ],
}
```

An anonymous request receives a published-only constraint. An authenticated non-administrator receives published articles plus articles linked to their user ID. An administrator receives unrestricted collection access. Since the owner field is optional in this example, an unpublished article without an owner is available only to administrators.

The `status` field is deliberately simple. If you enable Payload drafts and versions, review access to drafts, version history, preview routes, and publication operations separately. Do not assume that a custom status field provides the same workflow or behavior as Payload’s built-in versioning features.

Protect the user collection as carefully as the article collection. In particular, a user must not be able to grant themselves the `admin` role through an unprotected user update. Bootstrap and maintain administrators through a trusted process, and test the role field’s create and update permissions.

## Protect sensitive fields

Collection access determines whether someone can reach a record; field access can narrow what they can see or change within it. For example, a published article might contain an internal editorial note that should never appear in the public response. Add the following field to the collection, using the `isAdmin` helper above:

```ts
{
  name: 'internalNote',
  type: 'textarea',
  access: {
    read: ({ req }) => isAdmin(req.user),
    create: ({ req }) => isAdmin(req.user),
    update: ({ req }) => isAdmin(req.user),
  },
}
```

A non-administrator may still read an otherwise permitted article, but field access prevents that user from reading the note through an access-controlled operation. The create and update rules also make the intended protection explicit. In this collection, those write checks are an additional safeguard because collection writes are already administrator-only.

### Treat every output as a potential disclosure

Check more than the article body. Titles, relationship fields, filenames, metadata, and populated relationships can reveal information. For each sensitive field, decide whether it belongs in the CMS response at all and whether a separate collection would make the boundary clearer.

SEO metadata is normally intended for publication, but a workflow may also include internal search notes or planned campaign language. Keep those separate from public metadata fields. For a starter implementation of public-facing metadata, see [how to configure SEO fields]({{site}}/docs/guides/seo-metadata/).

Field restrictions do not erase data from caches, exports, logs, or copies already sent elsewhere. If a formerly public field becomes sensitive, review those destinations and invalidate or remove stored copies where appropriate.

## Preserve access rules across integrations

A secure collection can still be undermined by an integration that queries with more privilege than its caller should have. Map each route from the requester to Payload: browser requests, server-rendered pages, background jobs, webhooks, and administrative scripts may all run with different identities.

Payload’s Local API is especially important to review. Local API operations bypass access control by default. When an operation should enforce a user’s permissions, pass the appropriate user context and set `overrideAccess: false`. Conversely, a trusted job may intentionally use elevated access, but that choice should be explicit and should not let an untrusted caller control arbitrary queries.

- Use public or user-scoped access for requests that serve public pages or a signed-in user.
- Keep privileged credentials and elevated Local API calls on trusted servers.
- Authorize custom endpoints independently; do not assume a hidden admin control protects an endpoint.
- Review populated relationships and generated responses, not just the top-level collection.
- Give caches a policy that matches the data: do not serve one user’s private response to another.

A framework’s rendering mode does not change these responsibilities. A server-rendered page can leak privileged data just as a browser request can if its server fetch is overly broad. When selecting the frontend, consider where content is fetched and cached alongside the trade-offs in our comparison of [Next.js and Astro for content sites]({{site}}/blog/nextjs-vs-astro-content-sites/).

## Test the policy and maintain it

Access control needs regression tests because schema and workflow changes can quietly alter a permission boundary. Test the article matrix with anonymous, ordinary authenticated, and administrator contexts. Include records with different owners, an unpublished record without an owner, and a published record containing an internal note.

1. Create test users with the intended roles and seed articles in each relevant status and ownership state.
2. Request article lists as each identity, checking both included and excluded records.
3. Request individual allowed and forbidden IDs, including an unpublished article owned by another user.
4. Attempt creates, updates, and deletes as each identity; verify the stored record remains unchanged after denied writes.
5. Read and modify the internal note through access-controlled operations, verifying that only administrators can do so.
6. Repeat the checks through custom endpoints and Local API calls with the intended user context and `overrideAccess` setting.

Also test failure cases: an absent user, a missing role, an unassigned owner, and an attempted role change. Avoid tests that only assert a response contains an expected article; they should also assert that forbidden articles and fields are absent.

During a migration, translate permissions as carefully as content. Roles and ownership may not have a one-to-one equivalent in the new model, and imported records can lack the relationships needed by a scoped rule. Our guide to [moving from Sanity to Payload]({{site}}/blog/sanity-to-payload-migration-guide/) covers the broader migration process. Before switching traffic, audit imported owners and run the access tests against representative migrated records.

At {{brand}}, our team of 46 works across offices in Amsterdam and Berlin. The agency was founded in 2015 and has delivered 180 projects. Whatever the project size, the useful deliverable is not just an access function: it is a documented policy that developers and editors can review when the content model changes.

## FAQ

### Does hiding a field in the admin panel secure it?

No. Admin interface settings affect what users see in that interface; they are not a replacement for field access control. Apply read and write restrictions to sensitive fields, then test the API and any custom endpoints that can return or modify them.

### Can an access function limit results to a user’s own records?

Yes. For supported collection operations, an access function can return a query constraint matching a relationship field against `req.user.id`. Make sure the ownership field is populated correctly and cannot be changed by users who should not control ownership.

### Does the Local API always enforce collection access?

No. Local API operations bypass access control by default. For a request that should obey a user’s permissions, provide the appropriate user context and set `overrideAccess: false`; reserve intentional bypasses for trusted server-side work.

### Are Payload drafts the same as a custom status field?

No. A custom status field is an ordinary field whose meaning and access rules you define. Payload’s drafts and versions provide additional publishing and version-history behavior, so review their permissions and preview paths separately when you enable them.
