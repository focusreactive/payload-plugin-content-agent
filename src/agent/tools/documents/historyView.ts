import { isRecord } from "../../../borders.js";
import type { DocId, PayloadDoc } from "../../../borders.js";
import type { DocumentIO } from "../../content/documentIo.js";

interface HistoryInput {
  collection?: string;
  global?: string;
  id?: DocId;
  locale?: string;
}

const NOT_CONTENT = new Set(["id", "createdAt", "updatedAt", "_status"]);
const isPlain = (value: unknown): boolean =>
  value === null || ["string", "number", "boolean", "undefined"].includes(typeof value);
const fieldsOf = (version: PayloadDoc): Record<string, unknown> =>
  isRecord(version.version) ? version.version : {};

/** What one save changed against the one before it: plain values, and the names of the rest. */
function changesOf(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const alsoChanged: string[] = [];

  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (NOT_CONTENT.has(name)) continue;
    const from = before[name];
    const to = after[name];

    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    if (isPlain(from) && isPlain(to)) changed[name] = { from: from ?? null, to: to ?? null };
    else alsoChanged.push(name);
  }

  return { changed, alsoChanged };
}

const statusOf = (version: PayloadDoc) => fieldsOf(version)._status;

/** The saves of a document in the order they were made, each with what it changed. */
export async function historyView(io: DocumentIO, input: HistoryInput) {
  const { collection, global, id, locale } = input;
  const { versions, total, error } = await io.history(global ? { global } : { collection }, {
    id,
    locale,
  });

  if (error || !versions) return { error: error ?? "The history could not be read." };
  const firstPublished = versions.find((version) => statusOf(version) !== "draft");

  return {
    ...(global ? { global } : { collection, id }),
    view: "history",
    totalVersions: total ?? versions.length,
    ...(versions.length < (total ?? 0)
      ? { note: `Only the oldest ${versions.length} versions are listed.` }
      : {}),
    firstSavedAt: versions[0]?.createdAt ?? null,
    firstPublishedAt: firstPublished?.createdAt ?? null,
    versions: versions.map((version, i) => ({
      savedAt: version.createdAt,
      status: statusOf(version) ?? "published",
      ...(i === 0
        ? { first: true }
        : changesOf(fieldsOf(versions[i - 1] as PayloadDoc), fieldsOf(version))),
    })),
  };
}
