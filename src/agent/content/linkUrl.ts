// The link targets the agent writes: a web address, a path or an anchor of the site, mail and
// phone. Any other scheme (javascript:, data:) can run in a visitor's browser and is refused.
const USABLE_LINK_URL = /^(https?:\/\/|\/|#|mailto:|tel:)/iu;

export const isUsableLinkUrl = (url: string): boolean => USABLE_LINK_URL.test(url.trim());

/** Only a full web address opens in a new tab: a path, an anchor, mail and phone stay. */
export const opensInNewTab = (url: string): boolean => /^https?:\/\//iu.test(url.trim());

export const USABLE_LINK_FORMS = "It must start with http://, https://, /, #, mailto: or tel:.";

export const unusableLinkError = (url: string): string =>
  `the link target ${JSON.stringify(url)} is not a usable URL, and nothing was written. ${USABLE_LINK_FORMS}`;

/** The first target of a markdown link in the text that is not a usable URL. */
export function unusableMarkdownLink(markdown: string): string | null {
  for (const match of markdown.matchAll(/\]\(\s*<?([^\s>)]+)/gu))
    if (!isUsableLinkUrl(match[1])) return match[1];

  return null;
}
