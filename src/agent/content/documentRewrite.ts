/**
 * This pass only overwrites existing strings in place. It never writes a whole richText value,
 * never adds, removes or reorders anything, and never blanks a string.
 */
import type { SchemaContext } from "../../types.js";
import type { DocumentWorkspace } from "./blockTools.js";
import { createApplyDocumentTextTool } from "./rewrite/applyDocumentText.js";
import { createReadDocumentTextTool } from "./rewrite/readDocumentText.js";
import type { EditorSession, RewriteContext } from "./rewrite/slots.js";

export type { EditorSession };

export function createDocumentRewriteTools(
  workspace: DocumentWorkspace,
  schema: SchemaContext,
  session?: EditorSession
) {
  const rewrite: RewriteContext = {
    workspace,
    schema,
    session,
    state: { current: null, reads: 0 },
  };

  return {
    readDocumentText: createReadDocumentTextTool(rewrite),
    applyDocumentText: createApplyDocumentTextTool(rewrite),
  };
}
