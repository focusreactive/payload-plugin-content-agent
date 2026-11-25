import type { DocId, PayloadDoc } from "../../borders.js";
import type { SchemaContext } from "../../types.js";
import type { DocTarget, DocumentIO } from "./documentIo.js";

/** A read of a locale other than the default takes no value that another locale lends it. */
export const ownLocaleValues = (
  schema: SchemaContext,
  locale?: string
): { fallbackLocale?: false } =>
  locale && schema.defaultLocale && locale !== schema.defaultLocale
    ? { fallbackLocale: false }
    : {};

/**
 * The document in the locale a write goes to, with no value borrowed from another locale:
 * the state a discard brings back. `undefined` for the default locale and for a project
 * without locales, where the document as read is already that state.
 */
export async function localeStateBeforeWrite(
  io: DocumentIO,
  schema: SchemaContext,
  target: DocTarget,
  { id, locale }: { id?: DocId; locale?: string }
): Promise<PayloadDoc | undefined> {
  if (!locale || !schema.defaultLocale || locale === schema.defaultLocale) return undefined;
  const { doc } = await io.read(target, {
    id,
    locale,
    fallbackLocale: false,
    callId: "restore-state",
  });

  return doc ?? undefined;
}
