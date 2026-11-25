import { tool } from "ai";
import { z } from "zod";
import TurndownService from "turndown";
import dns from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";
import { quiet } from "../../promises.js";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

const MAX_FETCH_BODY_BYTES = 5_000_000;

const PRIVATE_V4 = new net.BlockList();

PRIVATE_V4.addSubnet("0.0.0.0", 8);
PRIVATE_V4.addSubnet("10.0.0.0", 8);
PRIVATE_V4.addSubnet("100.64.0.0", 10);
PRIVATE_V4.addSubnet("127.0.0.0", 8);
PRIVATE_V4.addSubnet("169.254.0.0", 16);
PRIVATE_V4.addSubnet("172.16.0.0", 12);
PRIVATE_V4.addSubnet("192.168.0.0", 16);
PRIVATE_V4.addSubnet("198.18.0.0", 15);
PRIVATE_V4.addSubnet("224.0.0.0", 4);
PRIVATE_V4.addSubnet("240.0.0.0", 4);
const PRIVATE_V6 = new net.BlockList();

PRIVATE_V6.addSubnet("::", 128, "ipv6");
PRIVATE_V6.addSubnet("::1", 128, "ipv6");
PRIVATE_V6.addSubnet("fc00::", 7, "ipv6");
PRIVATE_V6.addSubnet("fe80::", 10, "ipv6");
// Every IPv4-mapped literal is refused:
// a DNS lookup returns plain dotted v4, which is checked as v4.
PRIVATE_V6.addSubnet("::ffff:0:0", 96, "ipv6");
// The NAT64 prefix for local use: a gateway of the network maps it to any address.
PRIVATE_V6.addSubnet("64:ff9b:1::", 48, "ipv6");

/** The eight 16-bit groups of an IPv6 address. */
function groupsOf(addr: string): number[] | null {
  let text = addr.toLowerCase();
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/u.exec(text);

  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);

    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...new Array<string>(8 - left.length - right.length).fill("0"), ...right];

  return groups.length === 8 ? groups.map((group) => parseInt(group, 16)) : null;
}

const dottedOf = (high: number, low: number) =>
  `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;

/** The IPv4 address that a NAT64, 6to4 or Teredo address reaches through its gateway. */
function embeddedV4(addr: string): string | null {
  const groups = groupsOf(addr);

  if (!groups) return null;
  const [first, second] = groups;

  if (first === 0x64 && second === 0xff9b) return dottedOf(groups[6], groups[7]);
  if (first === 0x2002) return dottedOf(groups[1], groups[2]);
  if (first === 0x2001 && second === 0) return dottedOf(groups[6] ^ 0xffff, groups[7] ^ 0xffff);

  return null;
}

function isPrivateIp(ip: string): boolean {
  let addr = ip;
  let version = net.isIP(addr);

  if (version === 6) {
    const mapped = addr.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
    const embedded = mapped ? mapped[1] : PRIVATE_V6.check(addr, "ipv6") ? null : embeddedV4(addr);

    if (embedded) {
      addr = embedded;
      version = 4;
    }
  }

  try {
    if (version === 4) return PRIVATE_V4.check(addr);
    if (version === 6) return PRIVATE_V6.check(addr, "ipv6");
  } catch {
    return true;
  }

  return true;
}

export interface SafeFetchInit {
  headers?: Record<string, string>;
  /** Headers that go only to the origin of the first address, never to one it redirects to. */
  firstHostHeaders?: Record<string, string>;
  signal?: AbortSignal;
  method?: "GET" | "HEAD";
  /** Hosts (`host[:port]`) the host project names as its own: fetched also on a private address. */
  trustedHosts?: ReadonlySet<string>;
}

interface ResolvedAddress {
  address: string;
  family: number;
}

const PRIVATE_ADDRESS = "Refusing to fetch private/internal address";

/** The checked addresses of a host name; none for an address literal or a trusted host. */
async function checkUrl(
  urlStr: string,
  trustedHosts?: ReadonlySet<string>
): Promise<{ error: string } | { addresses?: ResolvedAddress[] }> {
  let parsed: URL;

  try {
    parsed = new URL(urlStr);
  } catch {
    return { error: "Invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `Disallowed URL scheme: ${parsed.protocol}` };
  }

  if (trustedHosts?.has(parsed.host.toLowerCase())) return {};
  const hostname = parsed.hostname;
  const bareHost =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  if (net.isIP(bareHost)) return isPrivateIp(bareHost) ? { error: PRIVATE_ADDRESS } : {};

  try {
    const addresses = await dns.lookup(hostname, { all: true });

    if (addresses.length === 0) return { error: "Failed to resolve hostname" };
    if (addresses.some((entry) => isPrivateIp(entry.address))) return { error: PRIVATE_ADDRESS };

    return { addresses };
  } catch {
    return { error: "Failed to resolve hostname" };
  }
}

/**
 * Connects only to the addresses that passed the check: a second DNS answer for the same name
 * (DNS rebinding) is never asked for. The short keep-alive closes the socket after the response.
 */
export function pinnedAgent(addresses: ResolvedAddress[]): Agent {
  return new Agent({
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) return callback(null, addresses);

        return callback(null, addresses[0].address, addresses[0].family);
      },
    },
  });
}

export async function readTextCapped(res: globalThis.Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader?.();

  if (!reader) return (await res.text()).slice(0, maxBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;
    total += value.byteLength;
    chunks.push(value);

    if (total >= maxBytes) {
      void quiet(reader.cancel());
      break;
    }
  }

  return Buffer.concat(chunks).toString("utf-8");
}

function originOfUrl(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export async function safeFetch(
  urlStr: string,
  init: SafeFetchInit,
  maxRedirects = 3
): Promise<{ res?: globalThis.Response; finalUrl?: string; error?: string }> {
  const { trustedHosts, firstHostHeaders, ...request } = init;
  const firstOrigin = originOfUrl(urlStr);
  let current = urlStr;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = await checkUrl(current, trustedHosts);

    if ("error" in checked) return { error: checked.error };
    // Redirects are followed by hand so every hop is validated again.
    const res = await fetch(current, {
      ...request,
      ...(firstHostHeaders && firstOrigin && originOfUrl(current) === firstOrigin
        ? { headers: { ...request.headers, ...firstHostHeaders } }
        : {}),
      redirect: "manual",
      ...(checked.addresses ? { dispatcher: pinnedAgent(checked.addresses) } : {}),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");

      void quiet(res.body?.cancel?.());
      if (!location) return { error: `HTTP ${res.status} redirect with no Location` };
      current = new URL(location, current).toString();
      continue;
    }

    return { res, finalUrl: current };
  }

  return { error: `Too many redirects (>${maxRedirects})` };
}

async function searchWeb(query: string | undefined) {
  if (!query) return { error: 'Action "search" needs `query`: the words to search for.' };

  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "PayloadContentAgent/1.0" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok)
      return {
        error: `The search did not run: the search service answered HTTP ${res.status}. This is not "no results". Search again later, or ask the person for the address of the page.`,
        query,
      };
    const html = await res.text();
    const results: { title: string; url: string; snippet: string }[] = [];

    for (const block of html.split('class="result__body"').slice(1, 11)) {
      const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</u);
      const urlMatch = block.match(/href="([^"]+)"/u);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//u);

      if (titleMatch && urlMatch) {
        let href = urlMatch[1];
        const uddgMatch = href.match(/uddg=([^&]+)/u);

        if (uddgMatch) href = decodeURIComponent(uddgMatch[1]);
        results.push({
          title: titleMatch[1].trim(),
          url: href,
          snippet: (snippetMatch?.[1] || "").replace(/<[^>]+>/gu, "").trim(),
        });
      }
    }

    return results.length ? { results, query } : { message: "No results found", query };
  } catch (err) {
    return {
      error: `The search did not run (${err instanceof Error ? err.message : "Unknown"}). This is not "no results". Search again later, or ask the person for the address of the page.`,
      query,
    };
  }
}

const MAX_PAGE_CHARS = 12_000;

const NOT_READ =
  "The page was not read: do not report its content. Fetch another address from a search result or from the person, or say that this page could not be read.";

async function fetchPage(url: string | undefined) {
  if (!url) return { error: 'Action "fetch" needs `url`: the full address of the page.' };

  try {
    const { res, error, finalUrl } = await safeFetch(url, {
      headers: {
        "User-Agent": "PayloadContentAgent/1.0",
        Accept: "text/html, text/plain",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (error || !res) return { error: `${error ?? "Fetch failed"}. ${NOT_READ}`, url };
    if (!res.ok)
      return {
        error: `The page answered HTTP ${res.status} ${res.statusText}. ${NOT_READ}`,
        url: finalUrl ?? url,
      };
    let html = await readTextCapped(res, MAX_FETCH_BODY_BYTES);

    html = html
      .replace(/<script[\s\S]*?<\/script>/giu, "")
      .replace(/<style[\s\S]*?<\/style>/giu, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/giu, "")
      .replace(/<svg[\s\S]*?<\/svg>/giu, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/giu, "");
    const whole = turndown.turndown(html);
    const content = whole.slice(0, MAX_PAGE_CHARS);

    if (!content) return { error: `The page has no text to read. ${NOT_READ}`, url };

    return {
      content,
      url: finalUrl ?? url,
      length: content.length,
      ...(whole.length > content.length
        ? {
            truncated: true,
            note: `This is the first ${MAX_PAGE_CHARS} characters of the page, not all of it: the rest was cut. Do not report on the part you did not read.`,
          }
        : {}),
    };
  } catch (err) {
    return {
      error: `Fetch failed (${err instanceof Error ? err.message : "Unknown"}). ${NOT_READ}`,
      url,
    };
  }
}

export function createWebTool(fetchRefusal?: (url: string) => string | null) {
  return tool({
    description: `Web access tool. Two actions:
- "search" - search the web via DuckDuckGo. Returns titles, URLs, snippets.
- "fetch" - fetch a URL and return clean Markdown content, the first ${MAX_PAGE_CHARS} characters of the page (\`truncated: true\` when the page is longer). It takes only an address you found: one that stands in the person's messages, in a search result or in something you read in this conversation, or any page of a site the person named or of this site. An address you put together yourself is refused: search first.`,
    inputSchema: z.object({
      action: z
        .enum(["search", "fetch"])
        .describe('"search" for web search, "fetch" to read a page'),
      query: z.string().optional().describe('For "search": search query'),
      url: z.url().optional().describe('For "fetch": URL to read'),
    }),
    execute: async ({ action, query, url }: { action: string; query?: string; url?: string }) => {
      if (action === "search") return searchWeb(query);

      if (action === "fetch") {
        const refused = url ? fetchRefusal?.(url) : null;

        return refused ? { error: refused, url } : fetchPage(url);
      }

      return { error: `Unknown action: ${action}` };
    },
  });
}
