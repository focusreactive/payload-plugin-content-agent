import { z } from "zod";
import { tool } from "ai";
import type { SchemaField } from "../../../types.js";
import { parsePath, resolveFieldAtPath, setByPath } from "../discovery.js";
import { changedList } from "../listEdit.js";
import type { ListEdit } from "../listEdit.js";
import { duplicatePassage, shrinkError, SHRINK_RATIO, withAdvice } from "../guards.js";
import { validateFieldValue } from "../schemaValues.js";
import { sharedFieldRefusal } from "../sharedField.js";
import { isOpen, rootFields } from "./containers.js";
import type { BlockToolsContext } from "./containers.js";
import { NO_OPEN_DOCUMENT } from "../noOpenDocument.js";

const STRUCTURAL_FIELD_TYPES = new Set(["richText", "array", "blocks", "group"]);

function structuralFieldError(field: SchemaField, ref: string): string | null {
  if (!STRUCTURAL_FIELD_TYPES.has(field.type)) return null;

  switch (field.type) {
    case "richText":
      return `"${ref}" is a richText field - edit it with viewRichText({ ref: "${ref}", mode }) and then applyRichText instead.`;
    case "blocks":
      return `"${ref}" is a blocks field - use insertItem/moveItem/removeItem on it, and setValues on the fields of its blocks ("${ref}[<blockId>].<field>"), instead of writing its whole value.`;
    case "array":
      return `"${ref}" is an array field - use insertItem/moveItem/removeItem on it, and setValues on the fields of its rows ("${ref}[<rowId>].<field>"), instead of writing its whole value.`;
    default:
      return `"${ref}" is a group field - set its individual subfields (e.g. "${ref}.subfieldName") instead of writing the whole group at once.`;
  }
}

type Edit = ListEdit & { ref: string; value?: unknown };

// `add` and `remove` change some entries of a hasMany list; every other entry stays as it is.
function editedList(
  field: SchemaField,
  ref: string,
  current: unknown,
  edit: Edit
): { value: unknown[] } | { error: string } {
  if (edit.value !== undefined)
    return {
      error: `Pass \`value\` to write the whole value of "${ref}", or \`add\`/\`remove\` to change some entries of its list, not both.`,
    };
  if (!field.hasMany)
    return { error: `"${ref}" holds one value, not a list: pass the new value as \`value\`.` };

  return changedList(ref, current, edit);
}

function writeValue(
  context: BlockToolsContext,
  edit: Edit
): { ok: true; ref: string } | { error: string } {
  const { workspace, guards } = context;
  const { ref } = edit;
  const path = parsePath(ref);
  const res = resolveFieldAtPath(rootFields(context), workspace.ref.current, path);

  if (!res || !res.field)
    return {
      error: `Path "${ref}" does not resolve to a field - copy the ref from getEditableContent.`,
    };
  const structErr = structuralFieldError(res.field, ref);

  if (structErr) return { error: structErr };
  if (res.readOnly)
    return {
      error: `"${ref}" is read-only: the agent does not write it. Leave it and say so in your summary.`,
    };
  const shared = sharedFieldRefusal(workspace, ref, res.localized);

  if (shared) return { error: shared };
  const listEdit = edit.add !== undefined || edit.remove !== undefined;
  const next = listEdit ? editedList(res.field, ref, res.value, edit) : { value: edit.value };

  if ("error" in next) return next;
  const { value } = next;

  if (value === undefined)
    return {
      error: `No \`value\` for "${ref}". Pass the new value of this ${res.field.type} field; \`null\` clears a field that is not required.${res.field.hasMany ? " To change some entries of the list and keep the rest, pass `add` or `remove` instead." : ""}`,
    };
  const guard = validateFieldValue(res.field, value);

  if (!guard.ok) return { error: guard.error ?? `"${ref}" rejected by field validation` };

  if (typeof value === "string" && typeof res.value === "string") {
    const shrink = shrinkError(
      ref,
      res.value,
      value,
      guards.shrinkRatio ? guards.shrinkRatio() : SHRINK_RATIO
    );

    if (shrink) return { error: withAdvice(shrink, guards.advice?.shorterField) };
    const dup = duplicatePassage(workspace.ref.current, res.value, value, workspace.original);

    if (dup)
      return {
        error: `Not written: "${ref}" would add text the document already contains elsewhere ("${dup.slice(0, 80)}…"). Add it once, in the body field; report the document as done if it is already there.`,
      };
  }

  if (!setByPath(workspace.ref.current, path, value))
    return {
      error: `"${ref}" could not be written: its parent item is not in the document. Call getEditableContent and copy the ref from it.`,
    };

  return { ok: true, ref };
}

const setValuesInputSchema = z.object({
  edits: z
    .array(
      z.object({
        ref: z
          .string()
          .describe(
            'The field ref from getEditableContent, e.g. "<blocksField>[<blockId>].<arrayField>[<rowId>].<field>" or "<group>.<field>".'
          ),
        value: z
          .unknown()
          .optional()
          .describe(
            "The new value, of the type that getEditableContent gives for the ref. text, textarea, email, code: a string. number: a number. checkbox: true or false. date: an ISO 8601 string. select, radio: one of the option values of the field. relationship, upload: a real document id from lookupDocuments; when the field points to several collections, { relationTo: <collection slug>, value: <id> }. point: [longitude, latitude]. json: any JSON value. A field with hasMany takes an array of such values, and that array replaces the whole list: to add or take out some entries, leave out `value` and pass `add` or `remove`. null clears a field that is not required."
          ),
        add: z
          .array(z.unknown())
          .optional()
          .describe(
            "hasMany fields only: the entries to put at the end of the list, each of the type that `value` takes for one entry. Every entry the field holds stays where it is, and an entry it holds already is not added twice. Use it to add to a list, so you never write the entries it holds again."
          ),
        remove: z
          .array(z.unknown())
          .optional()
          .describe(
            "hasMany fields only: the entries to take out of the list. Each one must be in the list; every other entry stays where it is."
          ),
      })
    )
    .min(1)
    .max(200)
    .describe("The edits to apply, in order."),
});

async function setValues(
  context: BlockToolsContext,
  { edits }: z.infer<typeof setValuesInputSchema>
) {
  if (!isOpen(context)) return { error: NO_OPEN_DOCUMENT };
  const applied: string[] = [];
  const failed: { ref: string; error: string }[] = [];

  for (const edit of edits) {
    const result = writeValue(context, edit);

    if ("error" in result) failed.push({ ref: edit.ref, error: result.error });
    else applied.push(edit.ref);
  }

  return {
    ok: failed.length === 0,
    applied: applied.length,
    failed: failed.length,
    ...(failed.length ? { errors: failed } : {}),
    ...(applied.length ? { refs: applied } : {}),
  };
}

export function createSetValuesTool(context: BlockToolsContext) {
  return tool({
    description:
      'Write field values at any refs from getEditableContent - plain text (text/textarea) AND structured scalars (checkbox/select/number/date/relationship/upload/point/json), anywhere in the document: inside a block, an array row, a group, or at the root. Send every change of a pass in ONE call; each edit is validated against its field\'s schema and applied independently, so one bad ref never loses the rest. For a hasMany field, `add` and `remove` change some entries of the list and keep all the others; `value` replaces the whole list. Refuses richText (use applyRichText) and whole blocks/array/group values (use insertItem/moveItem/removeItem, or the sub-field refs). The name a block carries in the admin panel is not a schema field and is not listed among the fields: write it at the ref "<blocksField>[<blockId>].blockName".',
    inputSchema: setValuesInputSchema,
    execute: (input) => setValues(context, input),
  });
}
