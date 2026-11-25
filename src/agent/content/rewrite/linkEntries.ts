import { isObjectLike } from "../discovery.js";
import { USABLE_LINK_FORMS, isUsableLinkUrl } from "../linkUrl.js";
import { isStale, sharedRefusal, staleError } from "./slots.js";
import type { ApplyRun, RewriteContext } from "./slots.js";

function applyLinkEntry(
  rewrite: RewriteContext,
  run: ApplyRun,
  key: string,
  url: string
): string | null {
  const { session, state } = rewrite;
  const slot = run.byN.get(key);

  if (!slot) return `No entry ${key} in this read (1..${state.current!.slots.length}).`;
  if (!slot.linkNode)
    return `Entry ${key} is not inside a link, so there is no destination to change. To ADD a link, send the entry under \`text\` with [the words](${url}) written around the words to link - a markdown link inside an entry becomes a real link node.`;
  if (isStale(rewrite, slot.ref)) return staleError(key, slot.ref);
  if (typeof url !== "string" || !isUsableLinkUrl(url))
    return `Entry ${key}: "${url}" is not a usable URL. ${USABLE_LINK_FORMS}`;
  const linkFields = isObjectLike(slot.linkNode.fields) ? slot.linkNode.fields : undefined;

  if (!linkFields || typeof linkFields.url !== "string")
    return `Entry ${key} links to a document of this site, not to a URL, and no tool here changes that reference. Keep the link as it is, or remove the link with applyRichText (surgical) and say in your summary that it needs a new target.`;
  if (linkFields.url === url.trim()) return null;
  const shared = sharedRefusal(rewrite, slot.ref);

  if (shared) return shared;
  const previousUrl = linkFields.url;

  if (session?.linkIntent?.() === "more")
    return `Entry ${key} ("${slot.text}") is already a link to ${previousUrl}, and this task adds a link - it does not repoint existing ones, so nothing was changed. An entry listed under "links" is never "the first plain mention": find the first entry NOT under "links" whose words contain the mention, and send it back under \`text\` with [the words](${url.trim()}) around them.`;
  linkFields.url = url.trim();
  slot.linkTarget = url.trim();
  run.relinked.push(key);
  run.warnings.push(
    `Entry ${key} ("${slot.text}") was already a link to ${previousUrl} and now points to ${url.trim()} - that is a REPOINT of an existing link, not a new one. If the task was to add a link on a plain mention, undo this with links: { "${key}": "${previousUrl}" } and send the plain entry's words with [..](url) around the words to link.`
  );
  run.touchedRefs.add(slot.ref);

  return null;
}

export function applyLinkEntries(
  rewrite: RewriteContext,
  run: ApplyRun,
  links: Record<string, string> | undefined
): void {
  for (const [key, url] of Object.entries(links ?? {})) {
    const error = applyLinkEntry(rewrite, run, key, url);

    if (error !== null) run.failed.push({ n: key, error });
  }
}
