summary: Sundari Clinics brought its clinic sites onto one content model in a 2025 migration and design project with {{brand}}. The work combined a shared publishing system with space for local clinic information.

## The client

Sundari Clinics is an Australian healthcare organisation with a network of local clinic sites. Each site needs to answer practical questions: where the clinic is, what services it offers, how to get in touch and how to request an appointment. At the same time, the network needs to present a consistent experience for patients moving between locations.

In 2025, Sundari Clinics worked with {{brand}} on a migration and design project to bring those sites together around one content model. The work connected the organisation’s existing [Contentful](https://www.contentful.com) content with a new publishing setup in [Payload](https://payloadcms.com).

The aim was not to make every clinic page identical. It was to give shared information a consistent structure while allowing each clinic to maintain the details that matter locally.

## The challenge

The clinic sites had grown around local needs, but their content was difficult to manage as a network. Editors needed to maintain accurate information without repeatedly rebuilding the same kinds of pages.

The project focused on several related problems:

- Clinic information was spread across sites rather than organised around a shared model.
- Similar content could be structured differently, making updates harder to coordinate.
- Local teams needed control over their information without changing content owned by other clinics.
- Appointment requests needed a clear path from clinic and service pages.
- Existing content needed to be assessed before migration, not simply copied into a new system.

A migration alone would not resolve those issues. The team also needed to decide which content should be shared, which should remain local and how those choices should appear in the interface.

## The approach

{{brand}} combined content migration with design work so that the publishing model and the patient-facing experience could be considered together. The work followed a sequence:

1. **Audit the content.** Review the existing clinic and service content, identify repeated structures and flag material that needed attention before migration.
2. **Define the model.** Establish shared content types and relationships for clinic information, services and appointment pathways, with room for location-specific details.
3. **Design the experience.** Create reusable page patterns that help patients find relevant information while giving editors a consistent way to assemble pages.
4. **Migrate and review.** Map existing content into the new model, check the results and resolve issues with the people responsible for publishing.
5. **Prepare for ongoing use.** Set up editorial permissions and workflows around the distinction between network-wide and local content.

The content audit was important because moving inconsistent material into a new CMS can preserve the very problems a migration is meant to address. The team used the same principles described in its guide to avoiding [common migration mistakes]({{site}}/blog/cms-migration-mistakes/): make mapping decisions explicit and leave time to review content in context.

## The solution

The shared model separates reusable information from the details that belong to an individual clinic. A clinic entry can hold local information, while service content can follow a consistent structure across the network. That gives editors a clearer place to make changes and reduces the need to recreate a page structure for each location.

Payload provides the publishing environment for the new model. Access decisions are tied to editorial responsibility: a local editor needs to work with local content, while network-level content requires broader oversight. The team’s discussion of [access control in Payload]({{site}}/blog/payload-access-control-patterns/) explains the kinds of boundaries that make this arrangement maintainable.

The design work applies the same distinction to the patient experience. Reusable page patterns make common information easier to locate, while clinic-specific details remain visible where a patient needs them. Appointment requests are presented as part of the journey through clinic and service information, rather than relying on patients to search for a separate route.

Migration mapping connected the existing Contentful content to the new structures. Reviewing the migrated material in the designed pages mattered as much as checking fields in the CMS: a value can transfer successfully and still need editorial attention when it appears alongside other information.

## The results

Sundari Clinics reported the following results for the project:

| Metric | Before | After |
|---|---|---|
| Sites consolidated | Not supplied | 40 + |
| Content cost | Not supplied | 45 % |
| Appointment requests | Not supplied | 22 % |

The figures record the results supplied for the project. The underlying baselines and the direction of the percentage measures were not supplied, so they should not be read as a complete before-and-after comparison.

The delivered model gives Sundari Clinics a common structure for maintaining clinic information, while the design provides a repeatable way to present that information across the network.

## What comes next

The shared model is a foundation for ongoing editorial work, not a substitute for it. Sundari Clinics can review local details as they change, maintain shared service content centrally and assess new page needs against the existing patterns.

As the network evolves, the useful test is whether editors can place information in the right part of the model and whether patients can find it in the resulting pages. Keeping those checks connected will help the organisation make changes without losing the consistency established in the migration.
