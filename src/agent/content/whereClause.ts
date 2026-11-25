import { isRecord } from "../../borders.js";
import type { Where } from "../../borders.js";
import type { SchemaCollection } from "../../types.js";

const BUILT_IN_FIELDS = ["id", "createdAt", "updatedAt", "_status"];

export const WHERE_OPERATORS = [
  "equals",
  "not_equals",
  "in",
  "not_in",
  "all",
  "exists",
  "contains",
  "like",
  "not_like",
  "greater_than",
  "greater_than_equal",
  "less_than",
  "less_than_equal",
  "near",
  "within",
  "intersects",
];

export const WHERE_FORMAT = `The format is {"<field>":{"<operator>":<value>}}, and several conditions go into {"and":[...]} or {"or":[...]}. The field is a field of the collection; a field inside a group is "<group>.<field>". Operators: ${WHERE_OPERATORS.join(", ")}. \`contains\` matches a part of the text in any case, \`like\` matches when every word is in the text. There are no wildcards and no regular expressions.`;

export function queryableFields(collection: SchemaCollection): string[] {
  return [...new Set([...collection.fields.map((field) => field.name), ...BUILT_IN_FIELDS])];
}

/**
 * A `_status = published` filter is run against the published versions: the draft listing
 * reports a published document with a newer draft on top as "draft".
 */
export const asksForPublished = (where: Where | undefined): boolean =>
  JSON.stringify(where ?? null).includes('"_status":{"equals":"published"}');

const isWhere = (value: unknown): value is Where => isRecord(value);

const isJoin = (key: string) => key.toLowerCase() === "and" || key.toLowerCase() === "or";

interface WhereFaults {
  fields: Set<string>;
  operators: Set<string>;
  malformed: Set<string>;
}

function collectFaults(where: unknown, known: string[] | undefined, faults: WhereFaults): void {
  if (!isRecord(where)) return;

  for (const [key, condition] of Object.entries(where)) {
    if (isJoin(key)) {
      if (Array.isArray(condition))
        for (const part of condition) collectFaults(part, known, faults);
      else faults.malformed.add(key);
      continue;
    }

    if (known && !known.includes(key.split(".")[0])) faults.fields.add(key);

    if (!isRecord(condition)) {
      faults.malformed.add(key);
      continue;
    }

    for (const operator of Object.keys(condition))
      if (!WHERE_OPERATORS.includes(operator)) faults.operators.add(operator);
  }
}

/**
 * Reads a `where` JSON string from a model. A clause on a field that the collection does not have
 * is refused here: a site can answer it with an empty list, which reads as "no such document".
 */
export function readWhere(
  json: string,
  collection: SchemaCollection | undefined
): { where: Where } | { error: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = undefined;
  }

  const known = collection ? queryableFields(collection) : undefined;
  const fieldList = collection ? ` The fields of "${collection.slug}": ${known?.join(", ")}.` : "";

  if (!isWhere(parsed))
    return {
      error: `\`where\` must be a JSON object written as a string. ${WHERE_FORMAT}${fieldList}`,
    };
  const faults: WhereFaults = { fields: new Set(), operators: new Set(), malformed: new Set() };

  collectFaults(parsed, known, faults);
  const problems = [
    ...(faults.fields.size
      ? [`"${collection?.slug}" has no field ${[...faults.fields].join(", ")}`]
      : []),
    ...(faults.operators.size ? [`${[...faults.operators].join(", ")} is not an operator`] : []),
    ...(faults.malformed.size
      ? [
          `the value under ${[...faults.malformed].join(", ")} has the wrong shape: a field takes {"<operator>":<value>}, and \`and\` and \`or\` take a list of conditions`,
        ]
      : []),
  ];

  return problems.length
    ? { error: `\`where\` was not run: ${problems.join("; ")}. ${WHERE_FORMAT}${fieldList}` }
    : { where: parsed };
}

export function sortError(sort: string, collection: SchemaCollection | undefined): string | null {
  if (!collection) return null;
  const known = queryableFields(collection);
  const unknown = sort
    .split(",")
    .map((part) => part.trim().replace(/^-/u, ""))
    .filter((name) => !known.includes(name.split(".")[0]));

  return unknown.length
    ? `\`sort\` names ${unknown.join(", ")}: "${collection.slug}" has no such field. The fields of "${collection.slug}": ${known.join(", ")}. Put \`-\` in front of the field name for descending order.`
    : null;
}
