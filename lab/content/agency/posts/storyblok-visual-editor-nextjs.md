excerpt: Connect Storyblok’s visual editor to a Next.js app, map content blocks to components, and keep draft previews separate from published pages.

seoTitle: Storyblok Visual Editor with Next.js: Setup and Pitfalls
seoDescription: Set up Storyblok’s visual editor with Next.js, connect content blocks to React components, and avoid common preview, routing, and caching problems.

A visual editor is useful only when the page editors see matches the page visitors will eventually get. With [Storyblok](https://www.storyblok.com) and [Next.js](https://nextjs.org), that means aligning content types, component names, preview URLs, and caching rules—not just fetching a story and rendering its fields.

This guide builds a small App Router example with a page and a nested feature block. It also covers the boundary between draft previews and public pages, where many otherwise working integrations run into trouble. The example is intended for a protected preview deployment, not as a production route for public visitors.

## Decide what the editor needs to preview

Start with the content model and the URL an editor will open. In Storyblok, create a content type named `page` with a blocks field named `body`. Allow a nestable component named `feature` in that field, and give `feature` a text field named `headline`. Create a story with the slug `home`, choose `page` as its content type, and add at least one feature block.

These names are part of the integration. The component key returned by Storyblok must match the key registered in React, while field names such as `body` and `headline` must match the fields in the space. A mismatch can leave the editor showing a blank area even though the API request succeeded.

For this example, the Storyblok story `home` renders at the Next.js root route. Set the story’s preview URL to the root of your HTTPS preview deployment. If your space serves multiple routes, agree on a slug-to-route convention before adding more stories; a story’s CMS path is not automatically the same thing as an application URL.

At {{brand}}, we have delivered 180 projects since our founding in 2015. You can [learn how our team works]({{site}}/about/) before deciding how much of the integration to build yourself.

## Install the starter and SDK

{{short}} Starter is our open source starter kit for Next.js and a headless CMS. Version 3.2 can give a project an initial structure, but the Storyblok model and preview configuration still need to match the space you are connecting. Follow the [installation instructions]({{site}}/docs/getting-started/installation/) for the starter, then add the Storyblok React SDK in the application directory.

```bash
npx create-headless-starter
npm install @storyblok/react
```

Run the second command from the generated application directory, after the starter setup has finished. The code below is a focused App Router example; adapt its file location and component registration to the structure of your generated project rather than assuming the starter uses these exact files.

### Set up access deliberately

Use a Storyblok preview access token for the preview deployment and make it available to the server as `STORYBLOK_PREVIEW_TOKEN`. For local development, put that variable in `.env.local` and restart the development server after changing it. Do not commit the file or expose the token through a `NEXT_PUBLIC_` variable.

A preview token can retrieve draft content. Keeping it on the server prevents it from being bundled into browser code, but that alone does not protect the resulting pages: anyone who can access an unprotected preview route may still see the draft content it renders. Restrict access to the preview deployment as well.

The SDK defaults and region settings must also match your Storyblok space. If the space uses a data region other than the SDK’s default, configure the appropriate region in the SDK initialization before testing the request.

## Map Storyblok blocks to React components

For a minimal preview route, the following `app/page.js` initializes the SDK, registers the two component names, and fetches the `home` story as a draft. If your project uses a `src` directory for the App Router, place the route under `src/app` instead.

```js
import {
  apiPlugin,
  storyblokEditable,
  storyblokInit,
  StoryblokComponent,
  StoryblokStory,
} from "@storyblok/react/rsc";

function Page({ blok }) {
  return (
    <main {...storyblokEditable(blok)}>
      {blok.body?.map((child) => (
        <StoryblokComponent blok={child} key={child._uid} />
      ))}
    </main>
  );
}

function Feature({ blok }) {
  return (
    <section {...storyblokEditable(blok)}>
      <h2>{blok.headline}</h2>
    </section>
  );
}

const getStoryblokApi = storyblokInit({
  accessToken: process.env.STORYBLOK_PREVIEW_TOKEN,
  use: [apiPlugin],
  components: { page: Page, feature: Feature },
});

export const dynamic = "force-dynamic";

export default async function Home() {
  const { data } = await getStoryblokApi().get("cdn/stories/home", {
    version: "draft",
  });

  return <StoryblokStory story={data.story} />;
}
```

### What each mapping does

`StoryblokStory` renders the story through the registered root component and supports the visual editor integration. The `page` component iterates over its `body` field, and `StoryblokComponent` selects a registered component for each nested block. The `_uid` is a stable identifier supplied with a Storyblok block and is suitable as the React key.

`storyblokEditable` adds the attributes Storyblok uses to associate rendered elements with editable blocks. Apply it to the element representing each block, including nested blocks, so an editor can select the right part of the preview.

This example uses ordinary React components to make the mapping visible. When integrating it into a starter project, check the existing [block conventions]({{site}}/docs/reference/blocks/) before introducing another registry. Two competing registries make it harder to tell which component renders a given CMS block.

The dynamic route setting avoids treating this page as a static build-time result. It is not a substitute for reviewing SDK, platform, and CDN caches, or for protecting the preview deployment.

## Connect and test the visual editor

Configure the story’s preview URL to point at the protected deployment running the example, then open the story in Storyblok’s visual editor. Use a deployment whose HTTPS and access configuration allow the editor to load the page inside its preview frame.

1. Open the `home` story and confirm that the preview loads the application’s root route.
2. Select the feature block on the page and check that Storyblok selects the corresponding content block.
3. Change the headline in the editor and check whether the preview reflects the edit.
4. Add, reorder, and remove feature blocks, confirming that the rendered order follows the `body` field.
5. Reload the editor and test again with an unpublished change, not only with content that was already published.

If the page renders but selection does not work, inspect whether the relevant element receives editable attributes. If the frame is blank, check the preview URL, browser console, deployment logs, and response headers before changing component code. A content security policy or frame restriction can prevent an otherwise healthy route from loading inside Storyblok.

> **Practical tip:** Keep one small story with a page and a single feature block for integration checks. It makes a routing or component-registration failure easier to isolate than a full marketing page with many nested blocks.

Live updates depend on the editor bridge and the rendered component tree working together. Test actual edits in the visual editor rather than treating a successful initial API response as proof that the full editing experience works.

## Separate draft previews from published delivery

The example deliberately requests `version: "draft"`. That is appropriate for a restricted preview, but a public production route should fetch the published version instead. Use separate deployment configuration or a carefully implemented preview mode so that a visitor cannot switch a public page to draft content by changing an untrusted parameter.

### Plan the cache boundary

A fast public site can cache published responses, while editors generally need changes to appear promptly in preview. These are different requirements and should be tested separately. Next.js route rendering, the Storyblok SDK, and any hosting or CDN layer can each affect freshness.

| Concern | Preview behavior | Public behavior |
|---|---|---|
| Content version | Request drafts | Request published content |
| Access | Restrict the deployment or route | Allow intended visitors |
| Freshness | Avoid stale drafts during editing | Use an explicit caching strategy |
| Credentials | Keep preview access on the server | Use appropriate delivery credentials |
| Failure check | Verify an unpublished edit | Verify a newly published change |

For public pages, decide how publishing invalidates or refreshes cached content. A webhook-driven revalidation flow can be useful, but secure its endpoint and verify the invalidation scope. Test a publish, an update, and an unpublish; a cache policy that handles only the first case can leave obsolete content visible.

Also account for shared content. Updating a feature reused across pages may require more than invalidating the URL of the story currently being edited. The exact strategy depends on how your application fetches and composes that content.

## Troubleshoot the failures editors notice

When a preview fails, start with the smallest observable difference between the CMS and the application. These checks cover problems that often look similar in the editor but have different causes:

- **A block is missing:** Compare the Storyblok component name with the registration key, including case and spelling.
- **A field is empty:** Check the field’s technical name and the shape returned by the Content Delivery API, not just its label in the editor.
- **The wrong page appears:** Check the story slug, preview URL, and application route separately.
- **Edits do not appear:** Check bridge behavior and cache layers, then test an unpublished change.
- **Draft content appears publicly:** Stop exposing the route, review access controls and tokens, and separate draft fetching from published delivery.

Keep the content model and component registry under change control. Renaming a component in Storyblok without deploying a matching application change can break existing stories. For larger migrations, introduce the new mapping, update and verify content, and only then remove the old one.

Finally, choose the CMS for the editorial workflow you actually need. Storyblok is a commercial headless CMS with a visual editor; it is not an open source CMS. If ownership of the CMS code is a requirement, compare the options in our [open source CMS overview]({{site}}/blog/best-open-source-cms-2025/) before committing to an integration.

## FAQ

### Does the visual editor require every block to use `storyblokEditable`?

A block can render without it, but adding the editable attributes to the element representing that block lets Storyblok associate the rendered area with the corresponding content. Apply them consistently to blocks editors need to select in the preview.

### Can the preview and public site use the same Next.js codebase?

Yes. They can share components and routing, but draft access and published delivery need distinct, controlled behavior. Protect preview access, keep tokens server-side, and test that public requests cannot retrieve unpublished content.

### Why does the preview show an old headline?

The stale result may come from the application route, the SDK, or a hosting cache. Check each layer, confirm that the request uses the draft version, and test the visual editor bridge with a new unpublished edit.

### Does this example handle every Storyblok route?

No. It fetches the `home` story for the root route. A site with multiple stories needs route resolution, error handling, and a deliberate mapping between application paths and Storyblok slugs.
