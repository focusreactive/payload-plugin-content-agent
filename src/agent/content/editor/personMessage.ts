const MAX_PERSON_MESSAGE_CHARS = 4000;

/** The person's own words for the editor: the task it receives is the orchestrator's reading of
 *  them, and an exact value can change on the way. */
export function personMessageNote(message: string | undefined): string {
  const text = message?.trim();

  if (!text) return "";
  const shown =
    text.length > MAX_PERSON_MESSAGE_CHARS
      ? `${text.slice(0, MAX_PERSON_MESSAGE_CHARS)}… [cut, ${text.length} characters in total]`
      : text;

  return `\nThe person's last message in the chat, word for word:\n"""\n${shown}\n"""\nThe task above is the orchestrator's reading of that message. Take every exact value the person gave (a quoted text, a name, a number, a URL) from their words, character for character, and add nothing to it. Where the task states such a value in another way (a mark at its end, other quotation marks, another case), the person's words are right and the task is wrong. What the task adds that the person did not say (the id of another document, the document or the field to change) is what the orchestrator found on the site before it wrote the task: you cannot check it from the open document, so use it as given and do not look it up again.`;
}
