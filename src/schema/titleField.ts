import type { SchemaCollection } from "../types.js";

export function titleFieldOf({ fields, useAsTitle }: SchemaCollection): string | undefined {
  if (useAsTitle && fields.some((field) => field.name === useAsTitle)) return useAsTitle;

  return fields.find((field) => field.type === "text" && !field.hasMany)?.name;
}
