import type { ContentEditorDeps } from "./editorDeps.js";
import { createEditContentTool, editContentApproval } from "./editor/editContent.js";
import { createTranslateContentTool, translateContentApproval } from "./editor/translateContent.js";

type RequiredEditorDeps = "io" | "schema" | "model" | "concurrency";

export type ContentEditorOptions = Omit<Partial<ContentEditorDeps>, RequiredEditorDeps> &
  Pick<ContentEditorDeps, RequiredEditorDeps>;

export function createContentEditorTools(options: ContentEditorOptions) {
  const deps: ContentEditorDeps = {
    ...options,
    concurrency: Math.max(1, options.concurrency || 5),
  };

  deps.approvals?.policies.set("editContent", editContentApproval(deps));
  deps.approvals?.policies.set("translateContent", translateContentApproval(deps));

  return {
    editContent: createEditContentTool(deps),

    translateContent: createTranslateContentTool(deps),
  };
}
