import { z } from "zod";
import { isRecord } from "../borders.js";

const MAX_STATED_BOUND = 1_000_000;

function typeOf(property: Record<string, unknown>): string {
  if (Array.isArray(property.enum))
    return property.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (Array.isArray(property.anyOf))
    return property.anyOf.map((option) => (isRecord(option) ? typeOf(option) : "any")).join(" or ");
  if (property.type === "array")
    return `array of ${isRecord(property.items) ? typeOf(property.items) : "any"}`;

  if (Array.isArray(property.type)) return property.type.join(" or ");

  return typeof property.type === "string" ? property.type : "any";
}

function boundsOf({ minimum, maximum }: Record<string, unknown>): string | null {
  const low = typeof minimum === "number" ? minimum : null;
  const high = typeof maximum === "number" && maximum <= MAX_STATED_BOUND ? maximum : null;

  if (low !== null && high !== null) return `${low} to ${high}`;
  if (low !== null) return `at least ${low}`;

  return high === null ? null : `at most ${high}`;
}

function parameterLine(name: string, property: Record<string, unknown>, required: boolean): string {
  const facts = [
    typeOf(property),
    required ? "required" : "optional",
    boundsOf(property),
    property.default === undefined ? null : `default ${JSON.stringify(property.default)}`,
  ].filter((fact) => fact !== null);
  const description = typeof property.description === "string" ? `: ${property.description}` : "";

  return `- \`${name}\` (${facts.join(", ")})${description}`;
}

/**
 * The parameters of a tool as text for its description. The MCP server of the host turns the
 * input schema into JSON with its own copy of zod, and that copy does not see the descriptions
 * and the number limits of a schema built with ours.
 */
export function describeParameters(input: z.ZodObject): string {
  const schema = z.toJSONSchema(input, { io: "input" });
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const lines = Object.entries(properties).map(([name, property]) =>
    parameterLine(name, isRecord(property) ? property : {}, required.has(name))
  );

  return lines.length ? `Parameters:\n${lines.join("\n")}` : "No parameters.";
}
