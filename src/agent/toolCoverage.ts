import type { SchemaContext } from "../types.js";
import { normalizeSlug } from "./mcpNames.js";

export interface CollectionCoverage {
  slug: string;
  label: string;
  find: boolean;
  create: boolean;
  update: boolean;
}

export function analyzeToolCoverage(
  schema: SchemaContext,
  mcpTools: Record<string, unknown>
): CollectionCoverage[] {
  const names = new Set(Object.keys(mcpTools).map((name) => name.toLowerCase()));

  return schema.collections.map((collection) => {
    const norm = normalizeSlug(collection.slug);

    return {
      slug: collection.slug,
      label: collection.labels?.singular || collection.slug,
      find: names.has(`find${norm}`),
      create: names.has(`create${norm}`),
      update: names.has(`update${norm}`),
    };
  });
}

export function collectionsWithNoTools(coverage: CollectionCoverage[]): CollectionCoverage[] {
  return coverage.filter((entry) => !entry.find && !entry.create && !entry.update);
}

const WARN_STATE_KEY = Symbol.for("payload-content-agent.tool-coverage-warn-state");

interface WarnState {
  signatures: Set<string>;
  collisions: Set<string>;
}

function warnState(instanceKey: string): WarnState {
  const globalStore = globalThis as Record<symbol, unknown>;
  const registry = (globalStore[WARN_STATE_KEY] ??= new Map<string, WarnState>()) as Map<
    string,
    WarnState
  >;
  let state = registry.get(instanceKey);

  if (!state) {
    state = { signatures: new Set(), collisions: new Set() };
    registry.set(instanceKey, state);
  }

  return state;
}

export function warnSlugCollisions(schema: SchemaContext, instanceKey: string): void {
  const { collisions } = warnState(instanceKey);
  const byNorm = new Map<string, string[]>();

  for (const collection of schema.collections) {
    const key = normalizeSlug(collection.slug);

    byNorm.set(key, [...(byNorm.get(key) ?? []), collection.slug]);
  }

  for (const [key, slugs] of byNorm) {
    if (slugs.length < 2 || collisions.has(key)) continue;
    collisions.add(key);
    console.warn(
      `[Content Agent] Collection slugs ${slugs.map((slug) => `"${slug}"`).join(" and ")} normalize to the same ` +
        `MCP tool name ("find${key}"/"update${key}") - tool resolution cannot tell them apart. Rename one.`
    );
  }
}

export function warnMissingTools(
  coverage: CollectionCoverage[],
  instanceKey: string,
  hasLocalFallback = false
): void {
  const noTools = collectionsWithNoTools(coverage);

  if (noTools.length === 0) return;
  const signature = noTools
    .map((entry) => entry.slug)
    .sort()
    .join(",");
  const { signatures } = warnState(instanceKey);

  if (signatures.has(signature)) return;
  signatures.add(signature);
  const slugs = noTools.map((entry) => entry.slug).join(", ");

  console.warn(
    `[Content Agent] No MCP tools found for collection(s): ${slugs}. ` +
      (hasLocalFallback
        ? `Reads, edits, AND creates fall back to the Payload Local API with the chat user's permissions. `
        : `The agent can see ${noTools.length > 1 ? "them" : "it"} in the schema but cannot read or write ` +
          `${noTools.length > 1 ? "them" : "it"}. `) +
      `To restore full MCP coverage, enable each collection in mcpPlugin({ collections }) AND grant ` +
      `it in the MCP API key's scope (payload-mcp-api-keys → collections), then restart the server.`
  );
}

export function buildToolAvailabilityNote(
  coverage: CollectionCoverage[],
  hasLocalFallback = false
): string {
  const noTools = collectionsWithNoTools(coverage);

  if (noTools.length === 0) return "";
  const slugs = noTools.map((entry) => `"${entry.slug}"`).join(", ");

  if (hasLocalFallback) {
    return `\n# Collections With Limited MCP Tooling
These collections have NO MCP tools (find / create / update): ${slugs}.
They are still fully workable through the universal tools, which fall back to the CMS Local API with the current user's permissions:
- READ: readDocument / listDocuments / searchContent
- EDIT: editContent / findReplaceContent
- CREATE: createDocument (shell fields only - compose sections afterwards with editContent)
Note the fallback runs with the CURRENT USER's permissions - if the user's own role cannot access the collection, the tools will refuse (tell the user that plainly).`;
  }

  return `\n# Collections You CANNOT Access
You have NO CMS tools (find / create / update) for these collections: ${slugs}.
They appear in the schema, but the MCP API key does not grant access to them (or they are not enabled in the MCP plugin).
If the user asks you to create, read, or edit content in any of these collections, you MUST tell them plainly that you do not have access to the required tools, and that the MCP API key's scope (or the mcpPlugin config) needs to be updated for that collection and the server restarted. Do NOT attempt a workaround and do NOT output the content as JSON.`;
}
