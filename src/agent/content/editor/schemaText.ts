import { renderSchemaForPrompt } from "../../../schema/introspector.js";
import type { SchemaContext } from "../../../types.js";
import type { DocTarget } from "../documentIo.js";
import { EDITOR_NO_DRAFTS_NOTE } from "../editorPrompts.js";

/** The schema of the one target. A session starts after the gate of a write without drafts. */
export const editorSchemaText = (schema: SchemaContext, target: DocTarget): string =>
  renderSchemaForPrompt(
    {
      collections: target.collection
        ? schema.collections.filter((collection) => collection.slug === target.collection)
        : [],
      globals: target.global
        ? schema.globals.filter((global) => global.slug === target.global)
        : [],
    },
    "auto",
    { noDraftsNote: EDITOR_NO_DRAFTS_NOTE }
  ).text;
