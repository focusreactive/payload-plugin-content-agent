import { isDocId, isRecord } from "../../borders.js";
import type { DocId, PayloadDoc, Where } from "../../borders.js";
import type { SchemaCollection, SchemaContext } from "../../types.js";
import { docLabel, keyFields, labelSelect } from "../../schema/docLabel.js";
import type { DocumentIO } from "./documentIo.js";
import type { LinkProbe, LinkRef } from "./links.js";

export const LINK_STATES = [
  "not-found",
  "unpublished",
  "no-address",
  "address-record",
  "document",
  "external",
  "other",
] as const;

export type LinkState = (typeof LINK_STATES)[number];

export interface TargetDocument {
  collection: string;
  id: DocId;
  title?: string;
  /** False when the collection has drafts and no published version exists. */
  published: boolean;
}

/** A document whose key field holds the whole address. */
export interface AddressHolder extends TargetDocument {
  field: string;
}

export interface LinkTarget {
  state: LinkState;
  url?: string;
  documents?: TargetDocument[];
  heldBy?: AddressHolder[];
  live?: "opens" | "404";
}

export interface TargetResolverDeps {
  io: DocumentIO;
  schema: SchemaContext;
  /** The address of the site from its config. */
  siteUrl?: string;
  probe?: LinkProbe;
  locale?: string;
}

export interface ResolvedTargets {
  targets: Map<string, LinkTarget>;
  siteHosts: string[];
  /** Collections whose documents could not be read: a `not-found` may be one of theirs. */
  unread: string[];
}

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const CHUNK = 200;
const MAX_PROBES = 30;
const PROBES_AT_ONCE = 6;

function docRefOf(doc: unknown): { collection: string; id: DocId } | null {
  if (!isRecord(doc) || typeof doc.relationTo !== "string") return null;
  const id = isRecord(doc.value) ? doc.value.id : doc.value;

  return isDocId(id) ? { collection: doc.relationTo, id } : null;
}

export function targetKey(link: LinkRef): string {
  const ref = docRefOf(link.doc);

  return ref ? `doc:${ref.collection}:${ref.id}` : `url:${(link.url ?? "").trim()}`;
}

function hostOf(url: string | undefined): string | null {
  if (!url || !/^https?:\/\//iu.test(url)) return null;

  try {
    return new URL(url).host.toLowerCase().replace(/^www\./u, "");
  } catch {
    return null;
  }
}

function pathOf(url: string): string | null {
  let path: string;

  if (url.startsWith("/") && !url.startsWith("//")) path = url;
  else {
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
  }

  path = path.split("?")[0].split("#")[0].replace(/\/+$/u, "");

  try {
    return decodeURIComponent(path) || "/";
  } catch {
    return path || "/";
  }
}

// An editor may store `#` percent-encoded.
function isEmptyAddress(url: string): boolean {
  try {
    return ["", "#"].includes(decodeURIComponent(url).trim());
  } catch {
    return false;
  }
}

const isFile = (path: string) => /\.[a-z0-9]{2,5}$/iu.test(path);

/** The values a document key may hold for this path: the path and every end of it. */
function keyCandidates(path: string): string[] {
  const segments = path.split("/").filter(Boolean);

  return segments.map((_segment, index) => segments.slice(index).join("/"));
}

const addressVariants = (url: string, path: string): string[] => [
  ...new Set([url, path, `${path}/`]),
];

function chunksOf<Item>(items: Item[]): Item[][] {
  const out: Item[][] = [];

  for (let start = 0; start < items.length; start += CHUNK)
    out.push(items.slice(start, start + CHUNK));

  return out;
}

async function listAll(
  { io, locale }: TargetResolverDeps,
  collection: SchemaCollection,
  where: Where,
  draft?: boolean
): Promise<PayloadDoc[] | null> {
  const docs: PayloadDoc[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await io
      .list(collection.slug, {
        page,
        limit: PAGE_SIZE,
        where,
        locale,
        ...(draft === false ? { draft } : {}),
        callId: "check-links",
        select: labelSelect(collection),
      })
      .catch(() => null);

    if (!res || res.error) return null;
    docs.push(...res.docs);
    if (page >= (res.totalPages || 1) || res.docs.length === 0) break;
  }

  return docs;
}

async function publishedIds(
  deps: TargetResolverDeps,
  collection: SchemaCollection,
  docs: PayloadDoc[]
): Promise<Set<string>> {
  const live = new Set<string>();
  const drafts: DocId[] = [];

  for (const doc of docs) {
    if (!isDocId(doc.id)) continue;
    if (!collection.hasDrafts || doc._status === "published") live.add(String(doc.id));
    else drafts.push(doc.id);
  }

  for (const ids of chunksOf(drafts)) {
    const published = await listAll(
      deps,
      collection,
      { and: [{ id: { in: ids } }, { _status: { equals: "published" } }] },
      false
    );

    for (const doc of published ?? []) live.add(String(doc.id));
  }

  return live;
}

async function describe(
  deps: TargetResolverDeps,
  collection: SchemaCollection,
  docs: PayloadDoc[]
): Promise<Map<string, TargetDocument>> {
  const live = await publishedIds(deps, collection, docs);
  const out = new Map<string, TargetDocument>();

  for (const doc of docs) {
    if (!isDocId(doc.id)) continue;
    const title = docLabel(doc, collection);

    out.set(String(doc.id), {
      collection: collection.slug,
      id: doc.id,
      ...(title ? { title } : {}),
      published: live.has(String(doc.id)),
    });
  }

  return out;
}

const readable = ({ io, schema }: TargetResolverDeps) =>
  schema.collections.filter((collection) => io.transports({ collection: collection.slug }).read);

/** The documents whose key field holds one of the values, by that value. */
async function documentsByKey(
  deps: TargetResolverDeps,
  values: string[],
  unread: Set<string>
): Promise<Map<string, AddressHolder[]>> {
  const found = new Map<string, AddressHolder[]>();
  const wanted = new Set(values);

  for (const collection of readable(deps)) {
    const keys = keyFields(collection);

    if (!keys.length) continue;

    for (const chunk of chunksOf(values)) {
      const clauses = keys.map((name) => ({ [name]: { in: chunk } }));
      const docs = await listAll(
        deps,
        collection,
        clauses.length === 1 ? clauses[0] : { or: clauses }
      );

      if (!docs) {
        unread.add(collection.slug);
        break;
      }

      const described = await describe(deps, collection, docs);

      for (const doc of docs) {
        const target = described.get(String(doc.id));

        if (!target) continue;

        for (const field of keys) {
          const value = doc[field];

          if (typeof value !== "string" || !wanted.has(value)) continue;
          found.set(value, [...(found.get(value) ?? []), { ...target, field }]);
        }
      }
    }
  }

  return found;
}

async function referencedDocuments(
  deps: TargetResolverDeps,
  links: LinkRef[],
  targets: Map<string, LinkTarget>
): Promise<void> {
  const idsByCollection = new Map<string, Set<DocId>>();

  for (const link of links) {
    const ref = docRefOf(link.doc);

    if (!ref) continue;
    idsByCollection.set(
      ref.collection,
      (idsByCollection.get(ref.collection) ?? new Set()).add(ref.id)
    );
  }

  const known = new Map(readable(deps).map((collection) => [collection.slug, collection]));

  for (const [slug, ids] of idsByCollection) {
    const collection = known.get(slug);
    let described = new Map<string, TargetDocument>();
    let wasRead = Boolean(collection);

    if (collection) {
      for (const chunk of chunksOf([...ids])) {
        const docs = await listAll(deps, collection, { id: { in: chunk } });

        if (!docs) {
          wasRead = false;
          break;
        }

        described = new Map([...described, ...(await describe(deps, collection, docs))]);
      }
    }

    for (const id of ids) {
      const target = described.get(String(id));

      targets.set(`doc:${slug}:${id}`, {
        state: !wasRead
          ? "other"
          : !target
            ? "not-found"
            : target.published
              ? "document"
              : "unpublished",
        ...(target ? { documents: [target] } : {}),
      });
    }
  }
}

interface SiteAddress {
  key: string;
  url: string;
  path: string;
  host: string | null;
  /** The site root or a file: no document is looked up for it. */
  plain: boolean;
}

function sortUrls(links: LinkRef[], targets: Map<string, LinkTarget>): SiteAddress[] {
  const addresses: SiteAddress[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    const key = targetKey(link);

    if (seen.has(key) || key.startsWith("doc:")) continue;
    seen.add(key);
    const url = (link.url ?? "").trim();

    if (isEmptyAddress(url)) {
      targets.set(key, { state: "no-address", ...(url ? { url } : {}) });
      continue;
    }

    const host = hostOf(url);
    const path = host || (url.startsWith("/") && !url.startsWith("//")) ? pathOf(url) : null;

    if (!path) targets.set(key, { state: "other", url });
    else addresses.push({ key, url, path, host, plain: path === "/" || isFile(path) });
  }

  return addresses;
}

async function probeMissing(
  { probe, siteUrl }: TargetResolverDeps,
  addresses: SiteAddress[],
  targets: Map<string, LinkTarget>
): Promise<void> {
  if (!probe) return;
  const origin = hostOf(siteUrl) ? new URL(siteUrl!).origin : null;
  const queue = addresses
    .filter(({ key }) => targets.get(key)?.state === "not-found")
    .map(({ key, url, host }) => ({ key, url: host ? url : origin ? `${origin}${url}` : null }))
    .filter((entry): entry is { key: string; url: string } => entry.url !== null)
    .slice(0, MAX_PROBES);

  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const answer = await probe(next.url).catch(() => "unknown" as const);
      const target = targets.get(next.key);

      if (!target || answer === "unknown") continue;
      if (answer === "ok") targets.set(next.key, { ...target, state: "other", live: "opens" });
      else targets.set(next.key, { ...target, live: "404" });
    }
  };

  await Promise.all(Array.from({ length: PROBES_AT_ONCE }, worker));
}

const isSame = (one: TargetDocument, other: TargetDocument) =>
  one.collection === other.collection && String(one.id) === String(other.id);

function distinct<Doc extends TargetDocument>(documents: Doc[]): Doc[] {
  return documents.filter(
    (document, index) => documents.findIndex((other) => isSame(document, other)) === index
  );
}

/**
 * What every link target is, from the documents of the site: a document, a document that was
 * never published, an address that no document has, an address that another document holds as
 * its key, no address, or something this check does not look at.
 */
export async function resolveLinkTargets(
  deps: TargetResolverDeps,
  links: LinkRef[]
): Promise<ResolvedTargets> {
  const targets = new Map<string, LinkTarget>();
  const unread = new Set<string>();

  await referencedDocuments(deps, links, targets);
  const addresses = sortUrls(links, targets);
  const configured = hostOf(deps.siteUrl);
  const looked = addresses.filter(({ plain }) => !plain);
  const byKey = await documentsByKey(
    deps,
    [
      ...new Set(
        looked.flatMap(({ url, path }) => [...keyCandidates(path), ...addressVariants(url, path)])
      ),
    ],
    unread
  );
  const documentsOf = ({ path }: SiteAddress) =>
    distinct(keyCandidates(path).flatMap((value) => byKey.get(value) ?? []));
  // A host is this site when the config names it, or when at least two of its addresses and
  // most of them are documents here.
  const siteHosts = [
    ...new Set(looked.flatMap(({ host }) => (host === null ? [] : [host]))),
  ].filter((host) => {
    const ofHost = looked.filter((address) => address.host === host);
    const known = ofHost.filter((address) => documentsOf(address).length).length;

    return host === configured || (known >= 2 && known * 2 > ofHost.length);
  });

  if (configured && !siteHosts.includes(configured)) siteHosts.unshift(configured);
  const isOwn = ({ host }: SiteAddress) => host === null || siteHosts.includes(host);

  for (const address of addresses) {
    const { key, url, path, plain } = address;

    if (!isOwn(address)) {
      targets.set(key, { state: "external", url });
      continue;
    }

    if (plain) {
      targets.set(key, { state: "other", url });
      continue;
    }

    const documents = documentsOf(address);
    const heldBy = distinct(
      addressVariants(url, path).flatMap((variant) => byKey.get(variant) ?? [])
    ).filter((holder) => !documents.some((document) => isSame(document, holder)));

    targets.set(key, {
      state: heldBy.length
        ? "address-record"
        : !documents.length
          ? "not-found"
          : documents.some((document) => document.published)
            ? "document"
            : "unpublished",
      url,
      ...(documents.length
        ? { documents: documents.map(({ field: _field, ...document }) => document) }
        : {}),
      ...(heldBy.length ? { heldBy } : {}),
    });
  }

  await probeMissing(deps, addresses.filter(isOwn), targets);

  return { targets, siteHosts, unread: [...unread] };
}
