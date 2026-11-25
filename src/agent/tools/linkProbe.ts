import type { LinkProbe } from "../content/links.js";
import { safeFetch } from "./web.js";
import { quiet } from "../../promises.js";

const TIMEOUT_MS = 4000;

function hostOf(siteUrl: string | undefined): ReadonlySet<string> | undefined {
  try {
    return siteUrl ? new Set([new URL(siteUrl).host.toLowerCase()]) : undefined;
  } catch {
    return undefined;
  }
}

/** Asks the live site whether a page exists. Every hop passes the address checks of `safeFetch`;
 *  only the host of `siteUrl` (the project's own `serverURL`) may be on a private address. */
export function createLinkProbe(siteUrl?: string): LinkProbe {
  const trustedHosts = hostOf(siteUrl);

  return async (url) => {
    const signal = AbortSignal.timeout(TIMEOUT_MS);

    try {
      let { res } = await safeFetch(url, { method: "HEAD", signal, trustedHosts });

      if (res && (res.status === 405 || res.status === 501)) {
        ({ res } = await safeFetch(url, { method: "GET", signal, trustedHosts }));
        void quiet(res?.body?.cancel());
      }

      if (!res) return "unknown";
      if (res.status === 404 || res.status === 410) return "missing";

      return res.ok ? "ok" : "unknown";
    } catch {
      return "unknown";
    }
  };
}

/**
 * The probe for a caller from outside the site: it asks only the site's own host. A host that
 * an outside key wrote into a document answers "unknown" and gets no request.
 */
export function createSiteLinkProbe(siteUrl?: string): LinkProbe {
  const site = hostOf(siteUrl);
  const probe = createLinkProbe(siteUrl);

  return async (url) => {
    try {
      return site?.has(new URL(url).host.toLowerCase()) ? await probe(url) : "unknown";
    } catch {
      return "unknown";
    }
  };
}
