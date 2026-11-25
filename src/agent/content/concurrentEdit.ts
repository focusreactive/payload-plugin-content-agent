import type { PayloadDoc } from "../../borders.js";
import type { DocTarget, DocumentIO } from "./documentIo.js";

interface SaveCheck {
  original: PayloadDoc;
  fields: string[];
  locale?: string;
  /** Read as `original` was read. */
  fallbackLocale?: false;
}

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const label = (target: DocTarget, original: PayloadDoc): string =>
  target.global ? `global "${target.global}"` : `document ${original.id} in ${target.collection}`;

/** A refusal text when a field the editor is about to write was changed in the CMS after
 *  the editor opened the document, else null. Only the fields in the patch are compared:
 *  a hook or a bookkeeping field moves `updatedAt` too. */
export async function concurrentEditRefusal(
  io: DocumentIO,
  target: DocTarget,
  { original, fields, locale, fallbackLocale }: SaveCheck
): Promise<string | null> {
  const { doc: current, error } = await io.read(target, {
    id: original.id,
    locale,
    ...(fallbackLocale === false ? { fallbackLocale } : {}),
    callId: "ws-recheck",
  });

  if (error || !current)
    return `Not saved: the agent could not read ${label(target, original)} again before the save (${error ?? "not found"}), so it cannot tell whether someone changed it meanwhile - nothing was written, make the same edit again in a moment`;
  if (typeof current.updatedAt === "string" && current.updatedAt === original.updatedAt)
    return null;
  const touched = fields.filter((field) => !sameValue(current[field], original[field]));

  if (touched.length === 0) return null;

  return `Not saved: ${touched.map((field) => `"${field}"`).join(", ")} of ${label(target, original)} ${touched.length === 1 ? "was" : "were"} changed in the CMS after the editor opened it, so the save would have overwritten that change - nothing was written, make the same edit again so that it runs on the current version, and tell the person that the other change was kept`;
}
