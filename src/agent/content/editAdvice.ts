/**
 * The next-step sentences of the edit checks. They name tools, and the tools differ by who edits:
 * the content editor of the chat, or an outside agent through the edit tool of the MCP layer.
 */
export interface EditAdvice {
  /** After a refused shrink of a plain text field. */
  shorterField: string;
  /** How to change one phrase inside a long rich text node. */
  onePhrase: string;
  /** After a refused shrink of a rich text node. */
  shorterPart: string;
  /** After a replace that would drop links of the node. */
  removedLinks: string;
  /** After an insert of an item whose title an existing item already has. */
  existingItem: string;
  /** A rich text field among the initial fields of a new item. */
  richTextField: string;
}

export const EDITOR_ADVICE: EditAdvice = {
  shorterField:
    'If the task asks for a shorter text, call declareOutcome with a "shorter" criterion for it first, then send this entry again.',
  onePhrase:
    'use transform mode instead: viewRichText(mode:"transform") and send that one segment back with the change in it ("[text](url)" in a segment becomes a real link).',
  shorterPart:
    'If the task asks for a shorter text, call declareOutcome with a "shorter" criterion for this field first, then send this edit again.',
  removedLinks:
    'If the task removes these links, call declareOutcome with a "linkCount" criterion for this field first, then send this edit again.',
  existingItem:
    "Edit that one (setValues / applyRichText on its fields) instead of adding a duplicate. If the task really asks for a second item with this title, call insertItem again with sameTitle: true.",
  richTextField:
    "leave it out of `fields`, insert the item first, then write it with applyRichText on its ref (getEditableContent gives the ref).",
};
