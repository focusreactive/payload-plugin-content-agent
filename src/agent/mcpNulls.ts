import { isRecord } from "../borders.js";
import type { McpTool } from "../borders.js";

// A document that Payload reads holds `null` for an empty optional field. The input schema of
// an MCP update tool may take no `null` there (a select is a string of its options), and then
// the tool refuses the whole document for one empty field in one row.

type Schema = Record<string, unknown>;

const variantsOf = (schema: unknown): Schema[] => {
  if (!isRecord(schema)) return [];
  const nested = [schema.anyOf, schema.oneOf].flatMap((list) => (Array.isArray(list) ? list : []));

  return nested.length ? nested.flatMap(variantsOf) : [schema];
};

const typesOf = (schema: Schema): unknown[] =>
  Array.isArray(schema.type) ? schema.type : [schema.type];

/** A schema that says nothing about its type takes every value. */
function takesNull(schema: unknown): boolean {
  const variants = variantsOf(schema);

  return (
    variants.length === 0 ||
    variants.some(
      (variant) =>
        typesOf(variant).includes("null") ||
        variant.const === null ||
        (Array.isArray(variant.enum) && variant.enum.includes(null)) ||
        (variant.type === undefined && variant.enum === undefined && variant.const === undefined)
    )
  );
}

const propertiesOf = (schema: Schema): Schema | null =>
  isRecord(schema.properties) ? schema.properties : null;

/** The object variant whose fixed values (a block type) are the values of the object. */
function objectVariant(schema: unknown, value: Record<string, unknown>): Schema | null {
  const variants = variantsOf(schema).filter((variant) => propertiesOf(variant));
  const fits = (variant: Schema) =>
    Object.entries(propertiesOf(variant) ?? {}).every(
      ([key, property]) =>
        !isRecord(property) || !("const" in property) || property.const === value[key]
    );

  return variants.find(fits) ?? null;
}

interface Fit {
  value: unknown;
  /** A `null` that the schema refuses and that stays: one on the first level. */
  refused: boolean;
  dropped: number;
}

function fitObject(schema: unknown, value: Record<string, unknown>, top: boolean): Fit {
  const properties = propertiesOf(objectVariant(schema, value) ?? {});

  if (!properties) return { value, refused: false, dropped: 0 };
  const out: Record<string, unknown> = {};
  let refused = false;
  let dropped = 0;

  for (const [key, child] of Object.entries(value)) {
    const property = properties[key];

    if (child === null && property !== undefined && !takesNull(property)) {
      // A missing field of a row is an empty field. On the first level it means "no change".
      if (top) {
        refused = true;
        out[key] = child;
      } else dropped += 1;

      continue;
    }

    const fit = property === undefined ? null : fitValue(property, child);

    out[key] = fit ? fit.value : child;
    refused ||= fit?.refused ?? false;
    dropped += fit?.dropped ?? 0;
  }

  return { value: out, refused, dropped };
}

function fitValue(schema: unknown, value: unknown): Fit {
  if (Array.isArray(value)) {
    const items = variantsOf(schema).find((variant) => variant.items !== undefined)?.items;
    const fits = value.map((item) => fitValue(items, item));

    return {
      value: fits.map((fit) => fit.value),
      refused: fits.some((fit) => fit.refused),
      dropped: fits.reduce((sum, fit) => sum + fit.dropped, 0),
    };
  }

  return isRecord(value) ? fitObject(schema, value, false) : { value, refused: false, dropped: 0 };
}

export interface NullFit {
  /** The input without the `null` values that the tool refuses inside rows and groups. */
  input: Record<string, unknown>;
  /** True when the tool refuses a `null` of the input, kept or dropped. */
  refused: boolean;
}

export function fitNulls(tool: McpTool | undefined, input: Record<string, unknown>): NullFit {
  const inputSchema: unknown = tool?.inputSchema;
  const declared = isRecord(inputSchema) ? (inputSchema.jsonSchema ?? inputSchema) : undefined;

  if (!isRecord(declared) || !propertiesOf(declared)) return { input, refused: false };
  const fit = fitObject(declared, input, true);

  return {
    input: fit.value as Record<string, unknown>,
    refused: fit.refused || fit.dropped > 0,
  };
}
