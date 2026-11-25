import type { SchemaContext } from "../../types.js";
import type { DocumentWorkspace } from "./blockTools.js";
import { createApplyRichTextTool } from "./richtext/applyRichText.js";
import type { RichTextToolsContext, RichTextToolsOptions } from "./richtext/context.js";
import { createTrimRichTextTool } from "./richtext/trimRichText.js";
import { createViewRichTextTool } from "./richtext/viewRichText.js";

export function createRichTextTools(
  workspace: DocumentWorkspace,
  schema: SchemaContext,
  options: RichTextToolsOptions = {}
) {
  const context: RichTextToolsContext = {
    ...options,
    workspace,
    schema,
    transformCoverage: new Map(),
  };

  return {
    viewRichText: createViewRichTextTool(context),
    applyRichText: createApplyRichTextTool(context),
    trimRichText: createTrimRichTextTool(context),
  };
}
