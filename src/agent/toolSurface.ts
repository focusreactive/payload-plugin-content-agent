/**
 * The tool names and the texts of the checked writes that differ by where the tools are offered:
 * the chat in the admin, or the MCP endpoint of the site for an agent from outside.
 */
export interface ToolSurface {
  update: string;
  create: string;
  /** The tool that writes the text and the sections of a document. */
  edit: string;
  /** The tool that finds a document by its name. */
  nameSearch: string;
  /** An update that removes or shrinks what the document holds and has no confirmation. */
  destructiveRefusal: (reasons: string, tool: string) => string;
  /** A blocks field in the data of an update. */
  blocksUpdateRefusal: (field: string) => string;
  /** A rich text field in the data of an update. */
  richTextUpdateRefusal: (field: string) => string;
  /** A blocks field in the data of a new document. */
  blocksCreateRefusal: (field: string) => string;
  /** The last line of a preview that found a destructive change. */
  destructivePreviewNote: string;
  /** A write to a collection or global without drafts. The label names the target. */
  noDraftsRefusal: (label: string) => string;
  /** A new document in a collection without drafts. The label names the target. */
  noDraftsCreateRefusal: (label: string) => string;
}

export const CHAT_SURFACE: ToolSurface = {
  update: "updateDocument",
  create: "createDocument",
  edit: "editContent",
  nameSearch: "findDocuments",
  destructiveRefusal: (reasons, tool) =>
    `Nothing was written: this update is DESTRUCTIVE and the person has not confirmed it in the chat. ${reasons} Call ${tool} again with the same fields: the chat then asks the person to confirm.`,
  blocksUpdateRefusal: (field) =>
    `Refusing to write the "${field}" blocks field through updateDocument. Send the update without that field, then compose its sections with editContent({ collection, id, instruction }): it checks every block against the schema.`,
  richTextUpdateRefusal: (field) =>
    `Refusing to write the "${field}" rich text field through updateDocument. Send the update without that field, then change its text with editContent({ collection, id, instruction }): it edits rich text and keeps its links and formatting.`,
  blocksCreateRefusal: (field) =>
    `Refusing to create with the "${field}" blocks field - create the document WITHOUT blocks, then compose sections via editContent (schema-validated).`,
  destructivePreviewNote:
    "This update removes or shrinks existing content. When you call updateDocument, the chat shows the person what will be removed and asks them to confirm; the update runs only after that.",
  noDraftsRefusal: (label) =>
    `Nothing was written: ${label} has no drafts, so a change there is live at once and runs only after the person confirms it in the chat. This call has no confirmation. Make the change with updateDocument, editContent, findReplaceContent or translateContent: the chat then asks the person, and the tool writes after the confirmation.`,
  noDraftsCreateRefusal: (label) =>
    `Nothing was created: ${label} has no drafts, so a new document there would be live at once, and the agent creates none. Do not try another tool for it. Tell the person the two ways out: create the document by hand in the admin panel, or ask a developer to enable drafts (versions.drafts) for it. A change of an existing document there works: the chat asks the person to confirm it.`,
};
