import type { SanitizedConfig } from "payload";
import { isRecord } from "../borders.js";
import type { SchemaContext, SchemaCollection, SchemaGlobal } from "../types.js";
import { introspectFields } from "./introspectFields.js";
import type { IntrospectCtx } from "./introspectFields.js";
import { plainText } from "./plainText.js";

export { collectBlockDefs, renderSchemaForPrompt, schemaContextToString } from "./renderSchema.js";

function localeCodes(locales: unknown): string[] | undefined {
  if (!Array.isArray(locales)) return undefined;
  const entries: unknown[] = locales;

  return entries
    .map((entry) => (typeof entry === "string" ? entry : isRecord(entry) ? entry.code : undefined))
    .filter((code): code is string => typeof code === "string" && code !== "");
}

function introspectCollection(
  collection: SanitizedConfig["collections"][number],
  ctx: IntrospectCtx
): SchemaCollection {
  return {
    slug: collection.slug,
    labels: collection.labels
      ? {
          singular: plainText(collection.labels.singular, ctx.language),
          plural: plainText(collection.labels.plural, ctx.language),
        }
      : undefined,
    description: plainText(collection.admin?.description, ctx.language),
    fields: introspectFields(collection.fields, ctx),
    hasVersions: !!collection.versions,
    hasDrafts: !!(
      collection.versions &&
      typeof collection.versions === "object" &&
      collection.versions.drafts
    ),
    hasAuth: !!collection.auth,
    timestamps: collection.timestamps !== false,
    upload: !!collection.upload,
    useAsTitle:
      typeof collection.admin?.useAsTitle === "string" ? collection.admin.useAsTitle : undefined,
  };
}

function introspectGlobal(
  global: SanitizedConfig["globals"][number],
  ctx: IntrospectCtx
): SchemaGlobal {
  return {
    slug: global.slug,
    label: plainText(global.label, ctx.language),
    description: plainText(global.admin?.description, ctx.language),
    fields: introspectFields(global.fields, ctx),
    hasVersions: !!global.versions,
    hasDrafts: !!(global.versions && typeof global.versions === "object" && global.versions.drafts),
  };
}

export function introspectSchema(
  config: SanitizedConfig,
  options?: { collections?: string[]; globals?: string[] }
): SchemaContext {
  const ctx: IntrospectCtx = {
    blocksBySlug: new Map((config.blocks ?? []).map((block) => [block.slug, block])),
    expandingBlocks: new Map(),
    repeated: false,
    language: typeof config.i18n?.fallbackLanguage === "string" ? config.i18n.fallbackLanguage : "",
  };

  const collections = config.collections
    .filter((col) => {
      if (options?.collections) {
        return options.collections.includes(col.slug);
      }

      // `admin.hidden` can be a function that needs a request to evaluate:
      // only a literal `true` excludes.
      return !col.slug.startsWith("payload-") && col.admin?.hidden !== true;
    })
    .map((col) => introspectCollection(col, ctx));

  const globals = config.globals
    .filter((global) => {
      if (options?.globals) {
        return options.globals.includes(global.slug);
      }

      return global.admin?.hidden !== true;
    })
    .map((global) => introspectGlobal(global, ctx));

  const localization = config.localization || undefined;
  const locales = localeCodes(localization?.locales);

  return {
    collections,
    globals,
    ...(localization && locales?.length
      ? { locales, defaultLocale: localization.defaultLocale }
      : {}),
  };
}
