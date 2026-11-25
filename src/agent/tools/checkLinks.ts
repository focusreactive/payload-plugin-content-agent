import { tool } from "ai";
import { z } from "zod";
import { isDocId } from "../../borders.js";
import type { DocId, Where } from "../../borders.js";
import type { SchemaContext } from "../../types.js";
import { docLabel } from "../../schema/docLabel.js";
import { readWhere, WHERE_FORMAT } from "../content/whereClause.js";
import type { DocumentIO } from "../content/documentIo.js";
import { collectDocumentLinks } from "../content/links.js";
import type { LinkProbe, LinkRef } from "../content/links.js";
import { LINK_STATES, resolveLinkTargets, targetKey } from "../content/linkTargets.js";
import type { LinkState, LinkTarget } from "../content/linkTargets.js";
import { capMcpToolOutput, stringifyCapped } from "./outputCap.js";

// The MCP find tool refuses a `limit` above 100.
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const MAX_PLACES = 40;
const MAX_TEXT = 80;

const LISTED_BY_DEFAULT: LinkState[] = ["not-found", "unpublished", "no-address", "address-record"];

export interface CheckLinksInput {
  collection: string;
  where?: string;
  states?: LinkState[];
  locale?: string;
}

export interface CheckLinksContext {
  io: DocumentIO;
  schema: SchemaContext;
  siteUrl?: string;
  probe?: LinkProbe;
}

export interface LinkPlace {
  id: DocId;
  title?: string;
  field: string;
  text: string;
}

interface Scan {
  links: LinkRef[];
  places: Map<string, LinkPlace[]>;
  scanned: number;
  totalDocs: number;
}

async function scanCollection(
  { io, schema }: CheckLinksContext,
  { collection, locale }: CheckLinksInput,
  where: Where | undefined
): Promise<Scan | { error: string }> {
  const definition = schema.collections.find((entry) => entry.slug === collection);
  const scan: Scan = { links: [], places: new Map(), scanned: 0, totalDocs: 0 };
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= MAX_PAGES; page++) {
    const res = await io.list(collection, {
      page,
      limit: PAGE_SIZE,
      locale,
      where,
      callId: "check-links",
    });

    if (res.error) return { error: res.error };
    totalPages = res.totalPages || 1;
    scan.totalDocs = res.totalDocs;
    if (res.docs.length === 0) break;

    for (const doc of res.docs) {
      if (!isDocId(doc.id)) continue;
      const title = docLabel(doc, definition);

      for (const link of collectDocumentLinks(definition?.fields ?? [], doc)) {
        const key = targetKey(link);

        scan.links.push(link);
        scan.places.set(key, [
          ...(scan.places.get(key) ?? []),
          {
            id: doc.id,
            ...(title ? { title } : {}),
            field: link.fieldRef,
            text: link.text.slice(0, MAX_TEXT),
          },
        ]);
      }
    }

    scan.scanned += res.docs.length;
  }

  return scan;
}

function row(target: LinkTarget, places: LinkPlace[]) {
  return {
    ...target,
    links: places.length,
    in: places.slice(0, MAX_PLACES),
    ...(places.length > MAX_PLACES
      ? {
          more: `${places.length - MAX_PLACES} more places are not listed. searchContent with this address returns every document that holds it.`,
        }
      : {}),
  };
}

function report(
  { collection, states }: CheckLinksInput,
  scan: Scan,
  { targets, siteHosts, unread }: Awaited<ReturnType<typeof resolveLinkTargets>>
) {
  const listed = states?.length ? states : LISTED_BY_DEFAULT;
  const byState: Record<string, { targets: number; links: number }> = {};
  const rows: ReturnType<typeof row>[] = [];

  for (const [key, places] of scan.places) {
    const target = targets.get(key) ?? { state: "other" as const };
    const count = byState[target.state] ?? { targets: 0, links: 0 };

    byState[target.state] = count;
    count.targets++;
    count.links += places.length;
    if (listed.includes(target.state)) rows.push(row(target, places));
  }

  rows.sort((one, other) => LINK_STATES.indexOf(one.state) - LINK_STATES.indexOf(other.state));
  const notListed = Object.keys(byState).filter((state) => !listed.includes(state as LinkState));

  return capMcpToolOutput({
    collection,
    documents: scan.scanned,
    links: scan.links.length,
    ...(siteHosts.length ? { siteHosts } : {}),
    byState,
    listedStates: listed,
    targets: rows,
    ...(notListed.length
      ? {
          notListed: `The targets in the states ${notListed.join(", ")} are counted in byState and not listed. To list them, call checkLinks again with \`states\` set to those states.`,
        }
      : {}),
    ...(scan.scanned < scan.totalDocs
      ? {
          incomplete: `Only ${scan.scanned} of ${scan.totalDocs} documents were read. Call checkLinks again with a \`where\` clause that selects a part of the collection, once for each part.`,
        }
      : {}),
    ...(unread.length
      ? {
          unread: `The documents of ${unread.join(", ")} could not be read, so a target in the state not-found may be a document of one of them.`,
        }
      : {}),
    note: "The states come from the documents of this site, not from an open page. A target has `live` only when the site itself answered for its address.",
  });
}

export async function checkLinks(context: CheckLinksContext, input: CheckLinksInput) {
  const slugs = context.schema.collections.map((collection) => collection.slug);

  if (!slugs.includes(input.collection))
    return { error: `Unknown collection "${input.collection}". Available: ${slugs.join(", ")}` };
  if (!context.io.transports({ collection: input.collection }).read)
    return {
      error: `No read access for "${input.collection}" - enable it in mcpPlugin (or grant the user access) and restart.`,
    };

  let where: Where | undefined;

  if (input.where) {
    const read = readWhere(
      input.where,
      context.schema.collections.find((collection) => collection.slug === input.collection)
    );

    if ("error" in read) return read;
    where = read.where;
  }

  const scan = await scanCollection(context, input, where);

  if ("error" in scan) return scan;
  const resolved = await resolveLinkTargets({ ...context, locale: input.locale }, scan.links);

  return report(input, scan, resolved);
}

export const checkLinksInput = z.object({
  collection: z.string().describe("Collection slug: the links of its documents are checked."),
  where: z
    .string()
    .optional()
    .describe(
      `Payload where clause as a JSON string, to check a part of the collection. Omit it to check every document. ${WHERE_FORMAT}`
    ),
  states: z
    .array(z.enum(LINK_STATES))
    .optional()
    .describe(
      "Omit it: the result then lists the four states of a link that does not open its page (not-found, unpublished, no-address, address-record). Pass it only to list other states, for example external, or when the person asks for one state only."
    ),
  locale: z.string().optional().describe("Locale code. Omit for the default locale."),
});

export const CHECK_LINKS_DESCRIPTION =
  "Checks every link of every document of one collection in one call: link nodes of rich text, Markdown links, bare addresses and fields that hold an address, in all fields. It groups the links by target and gives the state of each target, with the documents and fields that hold the link. Use it for any question about the links of a collection: links that open no page, old addresses, links to documents that are not published, links without an address, links to other sites. Do not read the documents one by one for that. " +
  "The states: `not-found` = an address of this site, and no document has a key equal to it; `unpublished` = the target is a document that was never published, so the address opens no page; `no-address` = the link has no address, or only `#`, so it leads nowhere; `address-record` = another document holds the whole address as its key (`heldBy` names it: an alias or a rule that sends the address elsewhere, for example), so read that document before you say what the address is; `document` = a published document; `external` = another site, not checked; `other` = an anchor, a mail or phone link, a file or the site root, not checked. " +
  "The first four states are the links that do not open their page: a question about broken, dead or outdated links is about all four, so call without `states` and report the targets of all four. `byState` counts the targets and the links of every state.";

export function createCheckLinksTool(context: CheckLinksContext) {
  const slugs = context.schema.collections.map((collection) => collection.slug);

  return tool({
    description: `${CHECK_LINKS_DESCRIPTION} Collections: ${slugs.join(", ")}`,
    inputSchema: checkLinksInput,
    execute: (input: CheckLinksInput) => checkLinks(context, input),
    toModelOutput: ({ output }) => ({
      type: "text" as const,
      value: typeof output === "string" ? output : stringifyCapped(output),
    }),
  });
}
