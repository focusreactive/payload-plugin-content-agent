import { isRecord } from "../borders.js";
import type { SchemaField } from "../types.js";

// A registered node is a class (a function) or an object that wraps one.
const hasMembers = (value: unknown): value is Record<string, unknown> =>
  (typeof value === "object" && value !== null) || typeof value === "function";

function typeFromGetter(owner: unknown): string | undefined {
  if (!hasMembers(owner) || typeof owner.getType !== "function") return undefined;

  try {
    const type: unknown = owner.getType();

    return typeof type === "string" ? type : undefined;
  } catch {
    return undefined;
  }
}

// A replacement (`{ replace, with, withKlass }`) registers the type it replaces and the type it
// writes.
export function nodeTypesOf(node: unknown): string[] {
  if (!hasMembers(node)) return [];
  const types = [
    typeFromGetter(node),
    typeFromGetter(node.node),
    typeFromGetter(node.replace),
    typeFromGetter(node.withKlass),
  ].filter((type): type is string => Boolean(type));

  return types.length || typeof node.name !== "string" ? types : [node.name];
}

export function featureNodeTypes(features: unknown[]): string[] {
  const types = new Set<string>();

  for (const feature of features) {
    const nodes: unknown[] = isRecord(feature) && Array.isArray(feature.nodes) ? feature.nodes : [];

    for (const entry of nodes) {
      const node = isRecord(entry) && entry.node ? entry.node : entry;

      for (const type of nodeTypesOf(node)) types.add(type);
    }
  }

  return [...types];
}

const editorConfigs = new WeakMap<SchemaField, unknown>();

export function rememberEditorConfig(field: SchemaField, editorConfig: unknown): void {
  if (isRecord(editorConfig)) editorConfigs.set(field, editorConfig);
}

/** The Lexical config of the field's own editor, for a field read from a host config. */
export const editorConfigOf = (field: SchemaField | undefined): unknown =>
  field ? editorConfigs.get(field) : undefined;
