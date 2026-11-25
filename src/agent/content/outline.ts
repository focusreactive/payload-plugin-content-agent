import type { SchemaField } from "../../types.js";
import { previewRefValue, previewValue } from "./blockTools.js";
import { isObjectLike } from "./discovery.js";

export interface OutlineOptions {
  maxDepth?: number;
  maxFieldsPerBlock?: number;
}

function summarizeFields(fields: SchemaField[] | undefined, row: unknown, limit: number): string {
  if (!fields?.length || !isObjectLike(row)) return "";
  const parts: string[] = [];
  let nonRef = 0;

  for (const field of fields) {
    if (!field.name || !(field.name in row)) continue;
    const value = row[field.name];

    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    const ref = previewRefValue(field, value);

    if (ref) {
      parts.push(`${field.name}: ${ref}`);
      continue;
    }

    // not `break`: a reference field may come later and is exempt from the limit
    if (nonRef >= limit) continue;
    parts.push(`${field.name}: ${previewValue(value)}`);
    nonRef++;
  }

  return parts.length ? ` - ${parts.join(", ")}` : "";
}

interface OutlinePosition {
  indent: string;
  depth: number;
  /** The dotted path of the groups a field sits in: a tool takes the field by that path. */
  group: string;
}

export function documentOutline(
  fields: SchemaField[],
  doc: unknown,
  opts: OutlineOptions = {}
): string[] {
  const maxDepth = opts.maxDepth ?? 4;
  const maxFields = opts.maxFieldsPerBlock ?? 6;
  const lines: string[] = [];

  const walk = (levelFields: SchemaField[], data: unknown, at: OutlinePosition): void => {
    const { indent, depth, group } = at;

    if (!isObjectLike(data) || depth > maxDepth) return;

    for (const field of levelFields) {
      if (!field.name) continue;
      const value = data[field.name];
      const name = `${group}${field.name}`;

      if (field.type === "group") {
        walk(field.fields ?? [], value, { indent, depth, group: `${name}.` });
        continue;
      }

      if (field.type === "relationship" || field.type === "upload") {
        const ref = previewRefValue(field, value);

        if (ref) lines.push(`${indent}${name}: ${ref}`);
        continue;
      }

      if (!Array.isArray(value) || value.length === 0) continue;

      if (field.type === "blocks") {
        lines.push(`${indent}${name}: ${value.length} block(s)`);
        value.forEach((row: unknown, i: number) => {
          const item = isObjectLike(row) ? row : undefined;
          const def = field.blocks?.find((block) => block.slug === item?.blockType);
          const id = item?.id != null ? ` [${item.id}]` : "";

          const named =
            typeof item?.blockName === "string" && item.blockName
              ? ` blockName ${JSON.stringify(item.blockName)}`
              : "";

          lines.push(
            `${indent}  ${i + 1}. ${item?.blockType ?? "?"}${id}${named}${summarizeFields(def?.fields, row, maxFields)}`
          );
          if (def)
            walk(
              def.fields.filter(
                (subField) => subField.type === "blocks" || subField.type === "group"
              ),
              row,
              { indent: `${indent}     `, depth: depth + 1, group: "" }
            );
        });
      } else if (field.type === "array") {
        lines.push(
          `${indent}${name}: ${value.length} row(s)${summarizeFields(field.fields, value[0], maxFields)}`
        );
      }
    }
  };

  walk(fields, doc, { indent: "", depth: 0, group: "" });

  return lines;
}
