import type {
  DefaultNodeTypes,
  SerializedBlockNode,
  SerializedInlineBlockNode,
  SerializedTableCellNode,
  SerializedTableNode,
  SerializedTableRowNode,
  TypedEditorState,
} from "@payloadcms/richtext-lexical";
import type { OnStepFinishEvent, ToolExecutionOptions, ToolSet, UIMessageStreamWriter } from "ai";
import type { Payload, TypedUser, Where } from "payload";
import { z } from "zod";

export type { Payload, Where };
export type PayloadUser = TypedUser;

/**
 * The id of a document.
 * @public
 */
export type DocId = string | number;

/**
 * The fields of a document, by name.
 * @public
 */
export type DocFields = Record<string, unknown>;

/**
 * A document as it arrives from Payload or the MCP server: only the system fields are known.
 * @public
 */
export interface PayloadDoc extends DocFields {
  id?: DocId;
  _status?: "draft" | "published";
  updatedAt?: string;
  createdAt?: string;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isDocId = (value: unknown): value is DocId =>
  (typeof value === "string" && value.trim() !== "") || typeof value === "number";

export type RichTextNode =
  | DefaultNodeTypes
  | SerializedBlockNode
  | SerializedInlineBlockNode
  | SerializedTableNode
  | SerializedTableRowNode
  | SerializedTableCellNode;

export type RichTextState = TypedEditorState<RichTextNode>;

export const isRichTextState = (value: unknown): value is RichTextState =>
  isRecord(value) && isRecord(value.root) && Array.isArray(value.root.children);

export type McpCallOptions = ToolExecutionOptions<unknown>;

/** The part of an AI SDK tool the plugin uses when it calls an MCP tool itself. */
export interface McpTool {
  execute?: (input: Record<string, unknown>, options: McpCallOptions) => unknown;
  inputSchema?: unknown;
}

export type McpTools = Record<string, McpTool>;

export type AgentStepEvent = OnStepFinishEvent<ToolSet>;

/**
 * `z.custom` keeps the reference: the editor counts its sessions in the shared `contentEditorRuns`.
 */
export const turnContextSchema = z.object({
  writer: z.custom<UIMessageStreamWriter>().optional(),
  requestStartedAt: z.number().optional(),
  contentEditorRuns: z.custom<Record<string, number>>().optional(),
});

export type TurnContext = z.infer<typeof turnContextSchema>;
