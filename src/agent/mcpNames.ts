// Matches plugin-mcp's toCamelCase, which splits on hyphens, underscores and spaces.
// Lossy: `a-b` and `ab` normalize to the same name.
export function normalizeSlug(slug: string): string {
  return slug.toLowerCase().replace(/[-_\s]/gu, "");
}

export function mcpToolName(verb: "find" | "create" | "update" | "delete", slug: string): string {
  return `${verb}${normalizeSlug(slug)}`;
}

export function findMcpToolName(
  toolNames: Iterable<string>,
  verb: "find" | "create" | "update" | "delete",
  slug: string
): string | null {
  const wanted = mcpToolName(verb, slug);

  for (const name of toolNames) {
    if (name.toLowerCase() === wanted) return name;
  }

  return null;
}
