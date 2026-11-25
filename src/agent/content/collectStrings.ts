import { isObjectLike } from "./discovery.js";

type Strings = { path: string; text: string }[];

/** Payload's own keys of a document: its address, its timestamps and its draft state. */
const DOCUMENT_KEYS = new Set(["id", "_key", "createdAt", "updatedAt", "_status"]);
/** Payload's own keys of a block row. */
const ROW_KEYS = new Set(["blockType", "blockName"]);

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

function push(text: unknown, path: string, out: Strings): void {
  if (typeof text === "string" && text.trim()) out.push({ path, text });
}

/** A rich text node gives its text, a link its address and an embedded block its fields. The
 *  rest of a node (mode, format, direction, tag, list type) is how the text is shown. */
function nodeStrings(node: unknown, path: string, out: Strings): void {
  if (!isObjectLike(node)) return;
  if (typeof node.text === "string") return push(node.text, join(path, "text"), out);
  const fields = isObjectLike(node.fields) ? node.fields : undefined;

  if (node.type === "link" || node.type === "autolink") {
    if (fields) push(fields.url, join(path, "fields.url"), out);
    else push(node.url, join(path, "url"), out);
  } else if (fields) {
    collectStrings(fields, join(path, "fields"), out);
  }

  if (Array.isArray(node.children))
    node.children.forEach((child: unknown, i) =>
      nodeStrings(child, `${join(path, "children")}[${i}]`, out)
    );
}

export function collectStrings(value: unknown, path: string, out: Strings): void {
  if (typeof value === "string") return push(value, path, out);

  if (Array.isArray(value)) {
    value.forEach((item: unknown, i) => {
      const key =
        isObjectLike(item) && (item.id ?? item._key) ? `[${item.id ?? item._key}]` : `[${i}]`;

      collectStrings(item, `${path}${key}`, out);
    });

    return;
  }

  if (!isObjectLike(value)) return;
  if (isObjectLike(value.root) && value.root.type === "root")
    return nodeStrings(value.root, join(path, "root"), out);
  const row = typeof value.blockType === "string";

  for (const [key, child] of Object.entries(value)) {
    if (DOCUMENT_KEYS.has(key) || (row && ROW_KEYS.has(key))) continue;
    collectStrings(child, join(path, key), out);
  }
}
