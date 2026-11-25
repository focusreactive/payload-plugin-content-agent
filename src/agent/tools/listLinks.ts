import type { PayloadDoc } from "../../borders.js";
import type { SchemaField } from "../../types.js";
import { collectDocumentLinks } from "../content/links.js";
import type { LinkRef } from "../content/links.js";

function kindOf(link: LinkRef): "internal-doc" | "relative" | "absolute" | "other" {
  if (link.linkType === "internal" || link.doc != null) return "internal-doc";
  if (!link.url) return "other";
  if (link.url.startsWith("/") || link.url.startsWith("#")) return "relative";
  if (/^https?:\/\//iu.test(link.url)) return "absolute";

  return "other";
}

export function linkInventory(fields: SchemaField[], doc: PayloadDoc, document: string) {
  const links = collectDocumentLinks(fields, doc).map((link) => ({
    text: link.text,
    ...(link.url ? { url: link.url } : {}),
    ...(link.doc != null ? { doc: link.doc } : {}),
    kind: kindOf(link),
    source: link.source ?? "richText",
    field: link.fieldRef,
  }));
  const byField: Record<string, number> = {};

  for (const link of links) byField[link.field] = (byField[link.field] ?? 0) + 1;
  const byKind: Record<string, number> = {};

  for (const link of links) byKind[link.kind] = (byKind[link.kind] ?? 0) + 1;

  return {
    document,
    total: links.length,
    byKind,
    byField,
    links,
    note:
      links.length === 0
        ? "No links in any field of this document. Say so - this covered every field, so there is nothing else to check."
        : 'This is the complete list - every field was walked. Report the count as given. A URL-valued field (source "urlField") is a setting, not a link in the prose.',
  };
}
