excerpt: Localized fields, locale rules and fallbacks shape every multilingual experience. Learn how to model, publish and test them in a headless CMS.
seoTitle: Headless CMS Localization: Fields, Locales and Fallbacks
seoDescription: Learn how to model localized fields, choose locale fallbacks and build a publishing workflow that keeps multilingual content accurate and usable.

A headless CMS can deliver the same content to several markets, but storing a translation is only part of the job. You also need to decide which fields vary, what happens when a translation is missing and whether a page is ready to publish in each locale. Those decisions affect editors, APIs, search engines and the people reading the finished page.

By Ines Okafor, Content Strategist at {{brand}}

## Start with fields, not languages

Before adding locales, separate content that changes by market from content that should remain consistent. A product’s name might be shared everywhere, while its description, price display and legal copy need local treatment. Even a field that looks universal, such as an image, may contain embedded text or show a product unavailable in a particular market.

Localization support varies by platform. [Payload](https://payloadcms.com) lets developers mark fields as localized in a collection’s configuration. [Storyblok](https://www.storyblok.com) supports field-level translation as well as other approaches to multilingual content. [Contentful](https://www.contentful.com) supports localization at the field level and offers locale settings for managing translated values. The right model depends on the content and workflow, not just the CMS.

A field inventory makes the trade-offs visible:

| Field | Typical treatment | Decision to make |
|---|---|---|
| Internal product ID | Shared | Keep one stable identifier across locales. |
| Page title | Localized | Require a value before a locale is published. |
| Hero image and alt text | Possibly localized | Decide whether the image, the alt text or both vary. |
| Price | Market-specific | Store currency and amount explicitly; do not translate a formatted string. |
| URL slug | Localized | Define uniqueness and redirects within each locale. |
| Legal disclaimer | Localized | Assign local review and decide whether fallback is permitted. |

### Shared does not mean universally valid

A shared field reduces duplication, but it also creates a dependency: a change affects every locale that uses it. If an image is shared, an editor replacing it should know that all markets may see the replacement. If availability differs by country, a shared product record may need separate market data rather than a translated availability sentence.

Conversely, localizing everything creates needless work. Editors should not have to copy a stock-keeping unit into three language variants. Use shared fields for stable identifiers and relationships, and localize the values that carry language or market meaning.

For teams considering a custom schema, our work with [Payload implementations]({{site}}/payload-cms-development/) starts with those content decisions before the delivery layer is built.

## Define locales and their responsibilities

A locale identifies the language and, when needed, the regional context of content. `de` can represent German generally; `de-CH` distinguishes German for Switzerland. Those labels do not translate copy or determine legal requirements by themselves. Your team must decide what each locale means in the CMS and on the website.

### Language is not the same as market

Two markets can share a language while needing different currencies, delivery information or contact details. Equally, one market can serve more than one language. Treat language, market and currency as separate concepts when the business requires it, even if a simple site initially maps one locale to one market.

Choose a default locale deliberately. It often acts as the first editorial version or the base for new content, but it should not silently become the answer to every missing value. A default language can be useful for an internal product name and inappropriate for a contract term.

Record the policy in terms editors can use:

- **Locale codes:** List the supported codes and the audience each one serves.
- **Ownership:** Name the role responsible for translation, review and approval in each locale.
- **Required fields:** Identify the fields that must be complete before a locale can go live.
- **Market rules:** Specify which prices, offers and legal details cannot be inherited.
- **Retirement:** Decide how to redirect or archive URLs when a locale is removed.

This policy belongs alongside the content model. Otherwise, developers may build one interpretation while editors follow another.

## Make fallback an explicit content decision

Fallback fills a missing value from another locale. For example, a Swiss German description might fall back to general German and then to English. That can prevent an empty card on a listing page, but it can also produce a page that mixes languages without warning.

Fallback is most useful when the cost of an empty value is higher than the cost of showing a value from another locale. A shared technical label may be a reasonable candidate. A shipping restriction, price or legally required notice usually needs an explicit value for the target market or a clear unavailable state.

### Distinguish missing from intentionally empty

A translation can be absent because nobody has written it, because it is awaiting review or because an editor intentionally removed it. Treating all three as the same state makes fallback unpredictable.

The following example is a generic content representation, not a CMS-specific API response. It keeps translation status separate from the text:

```json
{
  "field": "intro",
  "translations": {
    "en": {
      "status": "approved",
      "value": "Plan your journey with confidence."
    },
    "de": {
      "status": "approved",
      "value": "Planen Sie Ihre Reise mit Sicherheit."
    },
    "de-CH": {
      "status": "missing",
      "value": null
    }
  }
}
```

If the policy allows `de-CH` to fall back to `de`, the delivery layer can display the German value. It should also retain the source locale, so the application can report fallback use and apply the correct language metadata where appropriate.

A deliberately blank value needs a different representation, such as an explicit `suppressed` status. In that case, the system should not automatically replace the blank with another language. Agree on these states before editors begin populating content.

> **Practical tip:** Make fallback visible in preview. Show the requested locale, the source locale and the missing field so an editor can distinguish an approved translation from borrowed content.

## Implement and inspect the fallback chain

Keep fallback logic in one place rather than scattering it across components. The example below resolves approved text using an ordered list supplied by the application. It skips missing, unapproved and whitespace-only values, and returns the locale that supplied the result.

```ts
type Translation = {
  status: "approved" | "missing" | "draft";
  value: string | null;
};

type Resolution = {
  value: string;
  sourceLocale: string;
} | null;

function resolveText(
  translations: Record<string, Translation | undefined>,
  localeChain: string[]
): Resolution {
  for (const locale of localeChain) {
    const entry = translations[locale];

    if (
      entry?.status === "approved" &&
      entry.value !== null &&
      entry.value.trim() !== ""
    ) {
      return { value: entry.value, sourceLocale: locale };
    }
  }

  return null;
}

const result = resolveText(
  {
    de: { status: "approved", value: "Guten Tag" },
    "de-CH": { status: "missing", value: null }
  },
  ["de-CH", "de", "en"]
);
```

Here, `result` contains `Guten Tag` and `de` as the source locale. A `null` result means the caller must choose an appropriate empty state; it should not invent a translation. A production implementation also needs an explicit rule for intentionally suppressed content, which this small example does not model.

A CMS may offer its own fallback behavior. Check whether the API returns the source locale and translation status your application needs; if it does not, your team may need another way to expose that information. Avoid applying a second, conflicting fallback chain in the frontend.

The [localization guide in the {{short}} Starter docs]({{site}}/docs/guides/localization/) is a useful starting point for teams working with {{short}} Starter, the open source starter kit for Next.js and a headless CMS. The same design question applies to any stack: define the chain once, document exceptions and make the result observable.

## Build a locale-by-locale publishing workflow

A translated field is not necessarily an approved field. Editors need to know whether a locale is incomplete, in review, ready or live. Those states can exist at page level, field level or both; choose the level that reflects how your team actually works.

A practical release process is:

1. **Create the source content.** Confirm the shared fields, intended audience and fields that each locale must supply.
2. **Prepare the translation brief.** Include context for short labels, character limits, links, terminology and market-specific claims.
3. **Translate and review.** Give a reviewer access to the rendered page, not just isolated strings.
4. **Check completeness.** Flag missing required fields, unexpected fallbacks, untranslated metadata and unavailable assets.
5. **Approve the locale.** Record who is accountable for the release and resolve any market-specific legal or commercial checks.
6. **Publish and verify.** Check the live URL, navigation, metadata and any subsequent updates in that locale.

Scheduling adds another dimension. A campaign may have one launch time but different approval deadlines, or a translation may be ready after the source page goes live. Decide whether locales can publish independently and what visitors should see before each one is available. The [scheduled publishing recipe]({{site}}/docs/recipes/scheduled-publishing/) provides a starting point for teams using {{short}} Starter; the approval and fallback policy still belongs to the project.

After publication, source edits need attention too. Changing a product claim in English does not update an approved German translation. Establish which changes trigger a new translation review, and avoid presenting an outdated translation as current simply because its previous status was approved.

## Deliver and test the experience

A correct CMS entry can still produce a confusing page. Test the complete route from request to rendered output, including navigation, metadata, images and error states.

Give each published locale a stable URL strategy. Localized slugs should be unique within the scope your routing system uses, and changing a slug should trigger a redirect decision. When equivalent pages exist in different languages, use appropriate `hreflang` annotations and locale-specific canonical URLs. Do not advertise an untranslated or unavailable page as a fully localized equivalent.

Be careful with fallback at page level. A few inherited fields may be acceptable, but an entire English page served at a German URL can mislead visitors and search engines. For a page that has not been translated, it may be better to keep the locale unpublished or offer a clear link to the available language. The choice should match the content policy rather than happen accidentally because an API returned a value.

Our [Alpenroute Travel trip planner case study]({{site}}/case-studies/alpenroute-travel/) offers another context for thinking about content across three languages. Regardless of the project, test with realistic editorial states: a complete translation, a missing optional field, an unapproved translation, a changed source value and a locale that must not use fallback.

Finally, monitor the problems editors can act on. A report of pages using fallback is more useful when it identifies the field, requested locale and source locale. Pair that report with an owner and a review cadence; otherwise, temporary fallback can quietly become permanent content.

## FAQ

### Should every field in a headless CMS be localized?

No. Localize fields whose language, meaning or presentation changes by locale. Keep stable identifiers and genuinely shared relationships shared. Review images, prices and legal copy separately because their requirements may follow markets rather than languages.

### What is the difference between a default locale and a fallback locale?

The default locale is the primary locale configured for a system or workflow. A fallback locale supplies a value when the requested one is unavailable. They can be the same, but using the default as a universal fallback can put unsuitable content in front of the wrong audience.

### Can a page mix content from different locales?

It can, but the result should be intentional and visible to the editorial team. Mixing a small amount of acceptable fallback content may be useful; mixing languages in essential instructions or legal copy can be confusing or unsafe. Preserve the source locale so the application can handle language metadata appropriately.

### When should a translated page be published?

Publish when its required fields, market-specific information and metadata have passed the agreed review. If translations are approved independently, each locale can have its own release timing. A missing translation should follow a documented fallback or unavailable-page policy, not an accidental default.
