import type { SchemaField } from "../../../types.js";
import { emptyRichText } from "../../content/schemaValues.js";

const writable = (field: SchemaField): boolean => !field.readOnly && !field.unsupported;

export function missingRequired(fields: SchemaField[], data: Record<string, unknown>): string[] {
  return fields
    .filter(
      (field) =>
        field.required &&
        writable(field) &&
        field.defaultValue === undefined &&
        !(field.name in data)
    )
    .map((field) => field.name);
}

export function createFailure(error: unknown, missing: string[], nextCall: string): string {
  if (!missing.length) return `Create failed: ${error}.`;

  return `Create failed: ${error}. Required and not sent: ${missing.map((name) => `"${name}"`).join(", ")}. ${nextCall}`;
}

/** Gives each required rich text field that was not sent an empty value, and names them. */
export function fillRequiredRichText(
  fields: SchemaField[],
  data: Record<string, unknown>
): string[] {
  const filled = fields
    .filter(
      (field) =>
        field.type === "richText" &&
        field.editor === "lexical" &&
        field.required &&
        writable(field) &&
        !(field.name in data)
    )
    .map((field) => field.name);

  for (const name of filled) data[name] = emptyRichText();

  return filled;
}
