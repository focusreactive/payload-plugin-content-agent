import type { DocumentWorkspace } from "./blocks/containers.js";

// A translation reads one locale and writes another. A field that is not localized holds one
// value for every locale, and the save takes a change of it back: the tool refuses it first.
export function sharedFieldRefusal(
  workspace: DocumentWorkspace,
  ref: string,
  localized: boolean | undefined
): string | null {
  if (workspace.readLocale === workspace.locale || localized) return null;

  return `"${ref}" is not localized: every locale shares it, so a translation into "${workspace.locale}" does not change it. Leave it as it is and go on with the localized fields.`;
}
