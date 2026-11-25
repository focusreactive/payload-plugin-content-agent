import { z } from "zod";
import type { ToolExecutionOptions } from "ai";
import type { PayloadDoc } from "../borders.js";
import type { DocumentWorkspace } from "../agent/content/blockTools.js";
import { describeChanges } from "../agent/content/changeFacts.js";
import { validateLocaleArg } from "../agent/content/discovery.js";
import type { DocTarget } from "../agent/content/documentIo.js";
import { documentLockKey, withDocumentLock } from "../agent/content/documentLock.js";
import { noDraftsRefusal } from "../agent/content/draftsOnly.js";
import { savedNothing } from "../agent/content/editor/state.js";
import { localeStateBeforeWrite } from "../agent/content/localeState.js";
import { buildChangedFields } from "../agent/content/schemaValues.js";
import { createWorkspaceTools, fieldsForTarget } from "../agent/content/workspaceTools.js";
import { assessUpdateRisk } from "../agent/tools/review.js";
import type { ToolSurface } from "../agent/toolSurface.js";
import { checkEdit } from "./editChecks.js";
import { OPERATION_TYPES, applyOperations } from "./editOperations.js";
import type { LayerWrites } from "./tools.js";

export const EDIT = "editDocument";

const MAX_OPERATIONS = 100;

export const EDIT_DESCRIPTION = `Changes the rich text, the blocks and the array rows of one document or global in one checked step, and saves the result as a draft; it publishes nothing. The call opens the current draft, applies \`operations\` in order, checks the result, and saves only when every operation applied and the checks pass: one failed operation means that nothing is written, and the error names the operation and what to send. Nothing is removed here: there is no operation that deletes an item or a part of a text, and an edit that empties a field or cuts most of a text is refused.

A \`ref\` or \`path\` names a place in the document: "<field>", "<group>.<field>", or inside an item "<blocksField>[<itemId>].<field>"; take the field names and the item ids from readDocument with view "outline". For the text of a rich text field read readDocument with view "text".

The operations, each an object with \`type\` (${OPERATION_TYPES.join(", ")}):
- { type: "set", ref, value }: writes one plain field (text, number, checkbox, select, date, relationship, upload) anywhere in the document, checked against the schema. \`value\` has the type of the field: a string for text; a number; true or false; one of the option values of a select; a date as an ISO 8601 string; for a relationship or an upload the id of a real document, or { relationTo, value } when the field points to several collections; [longitude, latitude] for a point; an array of such values for a field with hasMany, which replaces its whole list. null clears a field that is not required.
- { type: "set", ref, add }: puts the entries of the array \`add\` at the end of the list of a field with hasMany, each of the type one entry of the field takes; every entry the field holds stays, and an entry it holds already is not added twice. Use it to add to a list, so you never write the entries it holds again.
- { type: "insertItem", path, blockType?, fields?, afterId?, index?, sameTitle? }: adds a block to a blocks field (\`blockType\` is its slug) or a row to an array (no \`blockType\`). \`fields\` holds the content of the new item: plain values, the rows of its nested arrays, and a rich text field as Markdown text. It goes to the end, or after the item \`afterId\`, or to the 0-based \`index\` (\`afterId\` wins when both are sent; an index past the end puts the item last). An item added in this call has no id you can use in a later operation of the same call: read the outline again first. An item with the same title as an existing one is refused unless \`sameTitle\` is true.
- { type: "moveItem", path, id, toIndex }: moves one block or row to the 0-based position \`toIndex\`.
- { type: "replaceText", ref, find, replace, all? }: replaces the exact string \`find\` inside one text or rich text field; the structure stays. \`find\` must occur once in the field; with \`all: true\` every occurrence is replaced. In rich text the string must lie inside one run of the same formatting: a string that crosses bold, italic or a link is not found, so use replacePart for it. A link address that holds \`find\` is replaced and counted too.
- { type: "insertText", ref, markdown, after? | before? | at? }: adds Markdown (paragraphs, headings, lists, links) to a rich text field: after or before the part that holds the plain text fragment \`after\` or \`before\`, or \`at\` "start" or "end". Without a place it goes to the end.
- { type: "replacePart", ref, match, markdown }: replaces one whole part of a rich text field (a paragraph, a heading, a list), the one that holds the plain text fragment \`match\`, with \`markdown\`. The Markdown must keep the links the part has.

A fragment must be in exactly one part of the field. With \`preview: true\` nothing is written: the call returns the changes and the issues the same operations would give. The result has \`status\`: "saved", "savedWithIssues" when the draft is saved and \`issues\` lists what a person should check (tell the person about them), or "unchanged" when the operations left the document as it was and nothing was saved. \`changes\` lists what changed. When the site keeps a history of the content agent, a person can review and discard the change in the admin.`;

export const editDocumentInput = z.object({
  collection: z.string().optional().describe("Collection slug. Pass it with `id`."),
  global: z.string().optional().describe("Global slug, in place of `collection` and `id`."),
  id: z.union([z.string(), z.number()]).optional().describe("The document id."),
  locale: z
    .string()
    .optional()
    .describe("Locale code to read and to save. Omit it for the default locale."),
  operations: z
    .array(z.record(z.string(), z.unknown()))
    .describe(
      `The operations, applied in order. At most ${MAX_OPERATIONS} in one call. The types and their input are in the description of the tool.`
    ),
  preview: z
    .boolean()
    .optional()
    .describe("true = write nothing and return what these operations would change."),
});

type EditDocumentInput = z.infer<typeof editDocumentInput>;

const CALL: ToolExecutionOptions<Record<string, unknown>> = {
  toolCallId: "mcp-layer-edit",
  messages: [],
  context: {},
};

function inputError({ collection, global, id, operations }: EditDocumentInput): string | null {
  if (!!collection === !!global) return "Pass `collection` with `id`, or `global`, and not both.";
  if (collection && (id === undefined || id === ""))
    return "Pass the `id` of the document with `collection`.";
  if (!operations.length)
    return `Pass at least one operation. The types: ${OPERATION_TYPES.join(", ")}.`;

  return operations.length > MAX_OPERATIONS
    ? `Nothing was written: one call takes at most ${MAX_OPERATIONS} operations, and this call has ${operations.length}. Send them in several calls.`
    : null;
}

interface Session {
  writes: LayerWrites;
  surface: ToolSurface;
  input: EditDocumentInput;
  target: DocTarget;
}

function destructiveRefusal(
  { writes, surface, target }: Session,
  before: PayloadDoc,
  after: PayloadDoc
): string | null {
  const { schema } = writes;
  const { patch } = buildChangedFields(before, after);
  const hasAuth = schema.collections.find((entry) => entry.slug === target.collection)?.hasAuth;
  const risks = assessUpdateRisk(fieldsForTarget(schema, target), before, patch, hasAuth);
  const forbidden = risks.filter((risk) => risk.kind === "forbidden");

  if (forbidden.length)
    return `Refused, nothing was written: ${forbidden.map((risk) => risk.reason).join(" ")} Send the operations without these fields.`;

  return risks.length
    ? surface.destructiveRefusal(risks.map((risk) => risk.reason).join(" "), EDIT)
    : null;
}

interface Opened {
  workspace: DocumentWorkspace;
  workspaceTools: ReturnType<typeof createWorkspaceTools>;
}

const idOf = ({ input, target }: Session) => (target.global ? undefined : input.id);

async function openWorkspace(session: Session): Promise<Opened | { error: unknown }> {
  const { writes, input, target } = session;
  const id = idOf(session);
  const locked = await writes.io.lockRefusal(target, id);

  if (locked) return { error: locked };
  const workspace: DocumentWorkspace = { ref: { current: null }, collection: null };
  const workspaceTools = createWorkspaceTools(workspace, writes.io, writes.schema);
  const opened: unknown = await workspaceTools.openDocument.execute!(
    {
      ...(target.global
        ? { global: target.global }
        : { collection: target.collection, id: String(id) }),
      ...(input.locale ? { locale: input.locale } : {}),
    },
    CALL
  );

  return typeof opened === "object" && opened !== null && "error" in opened
    ? { error: opened.error }
    : { workspace, workspaceTools };
}

const UNCHANGED = {
  status: "unchanged",
  note: "The operations left the document as it was, so nothing was saved.",
};

interface Checked {
  changes: string[];
  issues: string[];
}

async function saveEdit(
  session: Session,
  { workspace, workspaceTools }: Opened,
  { changes, issues }: Checked
): Promise<unknown> {
  const { writes, input, target } = session;
  const { locale } = input;
  const id = idOf(session);
  const restore = await localeStateBeforeWrite(writes.io, writes.schema, target, { id, locale });
  const saved = await workspaceTools.saveDocument.execute!({}, CALL);

  if (savedNothing(saved)) return UNCHANGED;
  if ("error" in saved && saved.error) return { error: saved.error };
  writes.recordEdits([
    {
      collection: target.global ? `global:${target.global}` : target.collection!,
      id: target.global ?? id!,
      op: "edit",
      before: workspace.original,
      after: structuredClone(workspace.ref.current),
      locale,
      restore,
      summary: changes.join("\n"),
      toolName: EDIT,
      report: { issues, criteria: [] },
    },
  ]);

  return {
    status: issues.length ? "savedWithIssues" : "saved",
    ...(target.global ? { global: target.global } : { collection: target.collection, id }),
    savedAs: "draft",
    changes,
    ...(issues.length ? { issues } : {}),
    ...(input.operations.some((operation) => operation.type === "insertItem")
      ? { note: 'A new item got its id at the save: read it with readDocument, view "outline".' }
      : {}),
  };
}

async function editOpenDocument(session: Session): Promise<unknown> {
  const { writes, input, target } = session;
  const { schema, io, config, probeLink } = writes;
  const opened = await openWorkspace(session);

  if ("error" in opened) return opened;
  const { workspace } = opened;
  const fields = fieldsForTarget(schema, target);
  const failed = await applyOperations({ workspace, schema, fields, config }, input.operations);

  if (failed) return { error: failed };
  const before = workspace.original!;
  const after = workspace.ref.current!;

  if (JSON.stringify(before) === JSON.stringify(after)) return UNCHANGED;
  const destructive = destructiveRefusal(session, before, after);

  if (destructive) return { error: destructive };
  const { blocking, issues } = await checkEdit({ schema, io, fields, before, after, probeLink });

  if (blocking.length) return { error: `Nothing was written. ${blocking.join(" ")}` };
  const changes = describeChanges(fields, before, after);

  return input.preview
    ? { preview: true, written: false, changes, ...(issues.length ? { issues } : {}) }
    : saveEdit(session, opened, { changes, issues });
}

export async function editDocument(
  writes: LayerWrites,
  surface: ToolSurface,
  input: EditDocumentInput
): Promise<unknown> {
  const refused =
    inputError(input) ??
    validateLocaleArg(writes.schema, input.locale) ??
    noDraftsRefusal(writes.schema, input, surface);

  if (refused) return { error: refused };
  const target: DocTarget = input.global
    ? { global: input.global }
    : { collection: input.collection };

  return withDocumentLock(documentLockKey(target, input.id), () =>
    editOpenDocument({ writes, surface, input, target })
  );
}
