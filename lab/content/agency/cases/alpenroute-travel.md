summary: Alpenroute Travel launched a multilingual trip planner in 2025 with development and localization from {{brand}}. The project used Sanity and Astro to connect destination content with booking requests across three languages.

## The client

Alpenroute Travel is a Swiss travel company that helps travelers plan trips. Its 2025 project with {{brand}} centered on a trip planner: a place where visitors could explore travel information in their preferred language and move toward a booking request.

The company needed the experience to serve both travelers and the people responsible for maintaining its content. Destination information, planning guidance and booking prompts had to work together without requiring editors to manage separate websites for each language.

## The challenge

Travel planning often begins with exploration rather than a firm decision. Alpenroute Travel needed to support that early research while keeping the path to an inquiry clear. The team also had to make localized content manageable after launch.

The main problems were:

- Travelers needed a consistent planning experience across three languages.
- Editors needed a way to maintain destination content and translations without duplicating an entire site.
- Booking prompts needed to sit naturally within the planning journey.
- The site needed to deliver useful content quickly, including on mobile connections.

The work called for more than translating visible text. Navigation, page relationships and calls to action all needed to remain understandable as visitors moved between localized pages. The content model also needed to distinguish material shared across languages from copy that editors would adapt.

## The approach

{{brand}} delivered development and localization in phases, bringing the content structure and frontend together around the trip-planning journey.

1. **Map the journey.** The team organized the experience around discovering destinations, reviewing relevant travel information and submitting a booking request. This established where localized guidance and booking prompts belonged.
2. **Model the content.** Destination content and interface copy were structured for editing in [Sanity](https://www.sanity.io), with language variants treated as part of the publishing workflow rather than as separate, disconnected sites.
3. **Build the frontend.** The planner was developed with [Astro](https://astro.build), using the structured content to render localized pages and connect them to the inquiry journey.
4. **Review and launch.** The team checked the language variants, navigation and booking paths together, then prepared the site for its 2025 launch.

{{brand}} also maintains the open-source {{short}} Starter for Next.js and a headless CMS. Its [guidance on organizing a starter project]({{site}}/docs/getting-started/project-structure/) and [reference for starter hooks]({{site}}/docs/reference/hooks/) are resources for that separate setup. Alpenroute’s frontend was built with Astro, not the Next.js starter.

## The solution

The finished planner brings destination content, localized navigation and booking requests into the same experience. A visitor can read planning information in a supported language and continue toward an inquiry without being sent into an unrelated content journey.

Sanity gives the content team a structured editing environment. Editors can work on destination information and its language variants in the same system, making relationships between pages easier to maintain. The model also separates editorial content from the frontend presentation, so changes to travel copy do not depend on rewriting page layouts.

Astro handles the public-facing pages. Its approach to building websites allows the team to deliver content-focused pages while adding interactivity where the planning experience needs it. The implementation keeps the traveler’s next step visible: useful information leads toward a booking request rather than ending at a destination description.

Localization was part of the build, not a final pass over a finished English site. The team considered how navigation, labels and calls to action would work across the supported languages. That made it possible to review complete journeys instead of checking translated strings in isolation.

> Editorial takeaway: A trip planner works best when travelers can move from destination information to an inquiry without losing their language or their place in the journey.

Alpenroute Travel — client

## The results

The project launched in 2025. The supplied results are shown below; comparable before values were not provided.

| Metric | Before | After |
|---|---|---|
| Booking requests | Not provided | 27 % |
| Largest Contentful Paint | Not provided | 1100 ms |
| Time to launch | Not provided | 3 months |

The booking-request figure is reported as supplied, without an assumed baseline or interpretation as an increase. Largest Contentful Paint records the reported loading performance, while the launch figure captures the time taken to bring the project live.

The delivery also gave Alpenroute Travel a content structure intended for continued use after launch. Its team can maintain the information travelers see through Sanity while the Astro frontend presents that content as a localized planning experience.

## What comes next

The next stage is to keep destination information and translations current as travel offerings change. Editors can review each localized journey alongside its booking prompt, checking that the content still gives travelers what they need before making an inquiry.

The separation between content and presentation provides a basis for that ongoing work. Alpenroute Travel can update planning information in the CMS while retaining a consistent frontend experience across its supported languages.
