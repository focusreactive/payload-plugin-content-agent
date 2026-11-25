import { isObjectLike } from "../../content/discovery.js";

export function stripContent(doc: unknown, depth = 0): unknown {
  if (Array.isArray(doc)) {
    const first: unknown = doc[0];

    if (doc.length > 0 && isObjectLike(first) && first.blockType) return `[${doc.length} blocks]`;

    return depth > 6 ? doc : doc.map((item: unknown) => stripContent(item, depth + 1));
  }

  if (!isObjectLike(doc)) return doc;
  if (isObjectLike(doc.root) && doc.root.children)
    return "[rich text - use searchContent tool to search inside]";
  if (depth > 6) return doc;
  const stripped: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(doc)) {
    stripped[key] = stripContent(val, depth + 1);
  }

  return stripped;
}
