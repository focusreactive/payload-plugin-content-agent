import { blog } from "./blog";
import { docs } from "./docs";
import { agency } from "./agency";
import { shop } from "./shop";
import type { LabSchema } from "./types";

export const schemas: Record<string, LabSchema> = { agency, blog, docs, shop };

export function activeSchema(): LabSchema {
  const name = process.env.LAB_SCHEMA || "blog";
  const schema = schemas[name];

  if (!schema)
    throw new Error(`Unknown LAB_SCHEMA "${name}". Known: ${Object.keys(schemas).join(", ")}`);

  return schema;
}
