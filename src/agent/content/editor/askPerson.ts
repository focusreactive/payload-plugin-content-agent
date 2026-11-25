import { tool } from "ai";
import { z } from "zod";

export const ASK_PERSON_TOOL = "askPerson";

export interface QuestionState {
  question: string;
}

export function createAskPersonTool(state: QuestionState) {
  return tool({
    description:
      "Stop the task and put ONE question to the person. Use it only when the task cannot be done without a fact that only the person has and that neither the task, the person's message nor the document gives: which of several matching items they mean, or a value they did not state. Read the document before you ask. Never ask about something you can read, about a choice the task leaves to you, or for a confirmation. Calling this ends the session and NOTHING is saved, also not the edits you already made, so ask before you edit.",
    inputSchema: z.object({
      question: z
        .string()
        .describe(
          "The question, in the language of the person's message, complete without the rest of this session. When the document holds several candidates, list them in it."
        ),
    }),
    execute: ({ question }) => {
      const text = question.trim();

      if (!text)
        return {
          error:
            "The question is empty, so nothing was asked. Call askPerson again with `question` as one full sentence, or go on with the task.",
        };
      state.question = text;

      return { asked: true, saved: false };
    },
  });
}
