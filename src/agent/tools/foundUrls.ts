import { domainToUnicode } from "node:url";

const URL_IN_TEXT = /https?:\/\/[^\s"'<>\\`)\]}]+/giu;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/u;
const HOST_IN_TEXT =
  /(?<![\p{L}\p{N}@.-])((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}{2,})(?![\p{L}\p{N}-])/giu;

const hostKey = (hostname: string): string =>
  (domainToUnicode(hostname) || hostname).toLowerCase().replace(/^www\./u, "");

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

const urlKey = (url: URL): string =>
  `${hostKey(url.hostname)}${url.pathname.replace(/\/+$/u, "")}${url.search}`;

function textOf(value: unknown): string {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** The addresses the agent has found in this conversation: it may fetch these and no other. */
export interface FoundUrls {
  /** Every URL in a text or a tool result counts as found. */
  note: (value: unknown) => void;
  /** A host the person named or the site's own: any path on it may be fetched. */
  noteHosts: (text: string) => void;
  /** Null when the URL may be fetched, else the refusal with the next call. */
  refusal: (url: string) => string | null;
}

export function createFoundUrls(siteUrl?: string): FoundUrls {
  const urls = new Set<string>();
  const hosts = new Set<string>();
  const site = siteUrl ? parse(siteUrl) : null;

  if (site) hosts.add(hostKey(site.hostname));

  const note = (value: unknown) => {
    for (const match of textOf(value).match(URL_IN_TEXT) ?? []) {
      const url = parse(match.replace(TRAILING_PUNCTUATION, ""));

      if (url) urls.add(urlKey(url));
    }
  };

  return {
    note,
    noteHosts: (text) => {
      for (const match of text.matchAll(HOST_IN_TEXT)) hosts.add(hostKey(match[1]));
    },
    refusal: (address) => {
      const url = parse(address);

      if (!url || hosts.has(hostKey(url.hostname)) || urls.has(urlKey(url))) return null;

      return `Refused: ${address} is not an address you found. The web tool fetches only a URL that stands in the person's messages, in a search result or in something you read in this conversation (a document, a page, a tool result), or any page of a site the person named. Do not build an address yourself: call web with action "search" and fetch a URL from its results, or ask the person for the address.`;
    },
  };
}

type Executable = { execute?: (...args: never[]) => unknown };

/** Feeds the result of every tool call into the found addresses. */
export function noteToolResults<Tools extends Record<string, unknown>>(
  tools: Tools,
  found: FoundUrls
): Tools {
  const out: Record<string, unknown> = { ...tools };

  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool && typeof tool === "object" ? (tool as Executable).execute : undefined;

    if (typeof execute !== "function") continue;
    out[name] = {
      ...(tool as object),
      execute: async (...args: never[]) => {
        const result = await execute.apply(tool, args);

        found.note(result);

        return result;
      },
    };
  }

  return out as Tools;
}
