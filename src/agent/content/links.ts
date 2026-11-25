import type { SchemaField } from "../../types.js";
import { isRecord } from "../../borders.js";
import {
  collectContentFields,
  getByPath,
  isObjectLike,
  parsePath,
  setByPath,
} from "./discovery.js";
import { eachNestedRoot, rootOf } from "./lexicalEngine.js";

export interface LinkRef {
  fieldRef: string;
  linkType: string;
  url?: string;
  doc?: unknown;
  text: string;
  source?: "richText" | "markdown" | "bareUrl" | "urlField";
}

function anchorText(node: unknown): string {
  if (!isObjectLike(node)) return "";
  if (node.type === "text" && typeof node.text === "string") return node.text;
  const children: unknown[] = Array.isArray(node.children) ? node.children : [];

  return children.map(anchorText).join("");
}

export function collectLinksInRichText(value: unknown, fieldRef: string): LinkRef[] {
  const out: LinkRef[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isRecord(node)) return;

    if (node.type === "link" || node.type === "autolink") {
      const linkFields = isObjectLike(node.fields) ? node.fields : {};
      const url =
        typeof linkFields.url === "string"
          ? linkFields.url
          : typeof node.url === "string"
            ? node.url
            : undefined;

      out.push({
        fieldRef,
        linkType:
          typeof linkFields.linkType === "string"
            ? linkFields.linkType
            : url
              ? "custom"
              : "internal",
        ...(url ? { url } : {}),
        ...(linkFields.doc != null ? { doc: linkFields.doc } : {}),
        text: anchorText(node),
      });
      if (Array.isArray(node.children)) node.children.forEach(walk);

      return;
    }

    if (Array.isArray(node.children)) node.children.forEach(walk);
    if (node.fields && typeof node.fields === "object") eachNestedRoot(node.fields, walk);
  };

  walk(rootOf(value));

  return out;
}

const MD_LINK = /\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/gu;
const BARE_URL = /https?:\/\/[^\s<>"'()\]]+[^\s<>"'()\].,;:!?]/gu;
const WHOLE_URL = /^\s*(https?:\/\/\S+|\/[^\s]*)\s*$/u;

export function collectLinksInText(value: unknown, fieldRef: string): LinkRef[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const out: LinkRef[] = [];
  const whole = WHOLE_URL.exec(value);

  if (whole) return [{ fieldRef, linkType: "custom", url: whole[1], text: "", source: "urlField" }];
  const taken = new Set<string>();

  for (const match of value.matchAll(MD_LINK)) {
    const url = match[2].replace(/^<|>$/gu, "");

    taken.add(url);
    out.push({ fieldRef, linkType: "custom", url, text: match[1], source: "markdown" });
  }

  for (const match of value.matchAll(BARE_URL)) {
    if (taken.has(match[0])) continue;
    out.push({ fieldRef, linkType: "custom", url: match[0], text: match[0], source: "bareUrl" });
  }

  return out;
}

// Leaves marked `embeddedInRichText` are skipped: walking the parent rich text already reaches
// them.
export function collectDocumentLinks(fields: SchemaField[], doc: unknown): LinkRef[] {
  const out: LinkRef[] = [];

  for (const leaf of collectContentFields(fields, doc)) {
    if (leaf.embeddedInRichText) continue;

    if (leaf.richText) {
      const value = getByPath(doc, parsePath(leaf.ref));

      if (!value) continue;
      out.push(
        ...collectLinksInRichText(value, leaf.ref).map((link) => ({
          ...link,
          source: "richText" as const,
        }))
      );
    } else if (typeof leaf.value === "string") {
      out.push(...collectLinksInText(leaf.value, leaf.ref));
    }
  }

  return out;
}

function linkKey(link: LinkRef): string {
  return `${link.fieldRef}\u0000${link.linkType}\u0000${link.url ?? ""}\u0000${JSON.stringify(link.doc ?? null)}`;
}

/** Every link a reader would see in a value: link nodes of a rich text, Markdown links and bare
 *  URLs in a text. A field that holds one URL and nothing else is a setting, not a link. */
export function linksIn(scope: unknown): LinkRef[] {
  if (typeof scope === "string")
    return collectLinksInText(scope, "").filter((link) => link.source !== "urlField");
  if (Array.isArray(scope)) return scope.flatMap(linksIn);
  if (!isObjectLike(scope)) return [];
  if (isObjectLike(scope.root)) return collectLinksInRichText(scope, "");

  return Object.values(scope).flatMap(linksIn);
}

export interface LinkIssues {
  retargeted: Array<{ link: LinkRef; textBefore: string }>;
}

export function findLinkIssues(
  fields: SchemaField[],
  before: unknown,
  after: unknown,
  opts: { isTranslation?: boolean } = {}
): LinkIssues {
  const afterLinks = collectDocumentLinks(fields, after);
  const retargeted: LinkIssues["retargeted"] = [];

  if (!opts.isTranslation) {
    const beforeByKey = new Map<string, string[]>();

    for (const link of collectDocumentLinks(fields, before)) {
      const key = linkKey(link);

      beforeByKey.set(key, [...(beforeByKey.get(key) ?? []), link.text]);
    }

    for (const link of afterLinks) {
      const texts = beforeByKey.get(linkKey(link));

      if (!texts?.length) continue;
      if (texts.includes(link.text)) continue;
      retargeted.push({ link, textBefore: texts[0] });
    }
  }

  return { retargeted };
}

export function describeLink(link: LinkRef): string {
  const target =
    link.url ?? (link.doc != null ? `document ${JSON.stringify(link.doc)}` : "no target");

  return `"${link.text}" -> ${target} (in ${link.fieldRef})`;
}

export interface UnresolvedLink {
  link: LinkRef;
  slug: string;
  verdict: "missing" | "unverified";
}

// `missing` only on a definite 404 or 410, anything else is `unknown`: callers remove a link on
// `missing`.
export type LinkProbe = (url: string) => Promise<"ok" | "missing" | "unknown">;

export interface UnresolvedLinkOptions {
  lookup: (candidates: string[]) => Promise<boolean>;
  instruction?: string;
  probe?: LinkProbe;
}

function routeKey(url: string): string {
  let path = url;

  if (!url.startsWith("/")) {
    try {
      path = new URL(url).pathname;
    } catch {
      return url.toLowerCase();
    }
  }

  return path.split("?")[0].split("#")[0].replace(/\/+$/u, "").toLowerCase() || "/";
}

function urlNamedInInstruction(url: string, instruction: string | undefined): boolean {
  if (!instruction) return false;
  if (instruction.includes(url)) return true;
  const key = routeKey(url);

  if (key === "/") return false;

  for (const match of instruction.matchAll(/https?:\/\/[^\s<>"'()\]]+|(?<![\w/])\/[\w\-./]+/gu)) {
    if (routeKey(match[0].replace(/[.,;:!?]+$/u, "")) === key) return true;
  }

  return false;
}

function hostOfUrl(url: string | undefined): string | null {
  if (!url || !/^https?:\/\//iu.test(url)) return null;

  try {
    return new URL(url).host.replace(/^www\./u, "");
  } catch {
    return null;
  }
}

/** The hosts of the document's absolute links, the most frequent first. */
function hostsByCount(links: LinkRef[]): string[] {
  const counts = new Map<string, number>();

  for (const link of links) {
    const host = hostOfUrl(link.url);

    if (host) counts.set(host, (counts.get(host) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([host]) => host);
}

const SITE_HOST_CANDIDATES = 3;

/** The host where a link the document already had opens one of this site's documents. The most
 * frequent host can be another site, and a 404 there says nothing about a relative link. */
async function siteHostOf(
  links: LinkRef[],
  lookup: UnresolvedLinkOptions["lookup"]
): Promise<string | null> {
  for (const host of hostsByCount(links).slice(0, SITE_HOST_CANDIDATES)) {
    const onHost = links.filter((link) => hostOfUrl(link.url) === host);

    for (const link of onHost.slice(0, SITE_HOST_CANDIDATES)) {
      const target = slugOfUrl(link.url!, host);

      if (target && (await lookup([...new Set([target.slug, target.path])]))) return host;
    }
  }

  return null;
}

function slugOfUrl(url: string, host: string | null): { slug: string; path: string } | null {
  let path: string;

  if (url.startsWith("/")) path = url;
  else {
    try {
      const parsed = new URL(url);

      if (!host || parsed.host.replace(/^www\./u, "") !== host) return null;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }

  const segs = path.split("?")[0].split("#")[0].split("/").filter(Boolean);

  if (!segs.length) return null;
  const last = segs[segs.length - 1];

  if (/\.[a-z0-9]{2,5}$/iu.test(last)) return null;

  return { slug: last, path: segs.join("/") };
}

export async function findUnresolvedNewLinks(
  fields: SchemaField[],
  before: unknown,
  after: unknown,
  opts: UnresolvedLinkOptions
): Promise<UnresolvedLink[]> {
  const { lookup } = opts;
  const beforeLinks = collectDocumentLinks(fields, before);
  const afterLinks = collectDocumentLinks(fields, after);
  const seen = new Set(beforeLinks.map((link) => link.url).filter(Boolean) as string[]);
  // The host comes from the links the document had: the new links are under suspicion and get no
  // vote.
  const host = hostsByCount(beforeLinks)[0] ?? null;
  let siteHost: Promise<string | null> | undefined;
  const out: UnresolvedLink[] = [];
  const checked = new Map<string, UnresolvedLink["verdict"] | "ok">();

  for (const link of afterLinks) {
    if (!link.url || seen.has(link.url) || link.source === "urlField") continue;
    if (urlNamedInInstruction(link.url, opts.instruction)) continue;
    const target = slugOfUrl(link.url, host);

    if (!target) continue;
    const key = target.path;

    if (!checked.has(key)) {
      if (await lookup([...new Set([target.slug, target.path])])) checked.set(key, "ok");
      else {
        const relative = link.url.startsWith("/");
        const relativeHost = relative ? await (siteHost ??= siteHostOf(beforeLinks, lookup)) : null;
        const absolute = relative ? relativeHost && `https://${relativeHost}${link.url}` : link.url;
        const answer =
          opts.probe && absolute
            ? await opts.probe(absolute).catch(() => "unknown" as const)
            : "unknown";

        checked.set(key, answer === "missing" ? "missing" : answer === "ok" ? "ok" : "unverified");
      }
    }

    const verdict = checked.get(key)!;

    if (verdict !== "ok") out.push({ link, slug: target.slug, verdict });
  }

  return out;
}

export function unlinkByUrl(fields: SchemaField[], doc: unknown, urls: Set<string>): number {
  let unlinked = 0;

  const walkRichText = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.flatMap(walkRichText);
    if (!isRecord(node)) return node;
    const url = isObjectLike(node.fields) ? node.fields.url : undefined;

    if (
      (node.type === "link" || node.type === "autolink") &&
      typeof url === "string" &&
      urls.has(url)
    ) {
      unlinked++;

      return Array.isArray(node.children) ? node.children.flatMap(walkRichText) : [];
    }

    const out: Record<string, unknown> = { ...node };

    if (Array.isArray(node.children)) out.children = node.children.flatMap(walkRichText);

    if (
      node.fields &&
      typeof node.fields === "object" &&
      node.type !== "link" &&
      node.type !== "autolink"
    ) {
      out.fields = Object.fromEntries(
        Object.entries(node.fields).map(([key, value]: [string, unknown]) => [
          key,
          isObjectLike(value) && value.root ? { ...value, root: walkRichText(value.root) } : value,
        ])
      );
    }

    return out;
  };

  for (const leaf of collectContentFields(fields, doc)) {
    if (leaf.embeddedInRichText) continue;
    const path = parsePath(leaf.ref);

    if (leaf.richText) {
      const value = getByPath(doc, path);

      if (!isObjectLike(value) || !value.root) continue;
      const before = unlinked;
      const next = { ...value, root: walkRichText(value.root) };

      if (unlinked > before) setByPath(doc, path, next);
    } else if (typeof leaf.value === "string" && leaf.value.includes("](")) {
      const replaced = leaf.value.replace(MD_LINK, (match: string, text: string, url: string) => {
        const clean = url.replace(/^<|>$/gu, "");

        if (!urls.has(clean)) return match;
        unlinked++;

        return text;
      });

      if (replaced !== leaf.value) setByPath(doc, path, replaced);
    }
  }

  return unlinked;
}
