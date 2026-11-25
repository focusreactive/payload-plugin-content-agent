import type { SchemaField } from "../../types.js";
import {
  TEXT_TYPES,
  collectContentFields,
  getByPath,
  isObjectLike,
  parsePath,
} from "./discovery.js";

export interface TextSection {
  ref: string;
  type: string;
  text: string;
}

function renderChildren(node: Record<string, unknown>): string[] {
  return Array.isArray(node.children) ? node.children.map(renderNode) : [];
}

function renderNode(node: unknown): string {
  if (!isObjectLike(node)) return "";

  switch (node.type) {
    case "text":
      return typeof node.text === "string" ? node.text : "";
    case "linebreak":
      return "\n";
    case "horizontalrule":
      return "---";
    case "upload":
      return "";
    case "block":
    case "inlineBlock":
      return fieldsText(node.fields);
    case "list":
      return renderChildren(node).join("\n");
    case "listitem":
      return `- ${renderChildren(node).join("")}`;

    case "heading": {
      const level = Number(String(node.tag ?? "h2").replace(/\D/gu, "")) || 2;

      return `${"#".repeat(Math.min(6, Math.max(1, level)))} ${renderChildren(node).join("")}`;
    }

    case "table":
      return renderChildren(node).join("\n");
    case "tablerow":
      return `| ${renderChildren(node).join(" | ")} |`;
    default:
      return renderChildren(node).join("");
  }
}

export function richTextToPlain(value: unknown): string {
  const root = isObjectLike(value) ? value.root : undefined;

  if (!isObjectLike(root) || !Array.isArray(root.children)) return "";

  return root.children
    .map(renderNode)
    .filter((line) => line.trim() !== "")
    .join("\n");
}

function fieldsText(fields: unknown): string {
  const out: string[] = [];

  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.trim()) out.push(value);

      return;
    }

    if (Array.isArray(value)) return value.forEach(walk);

    if (isObjectLike(value)) {
      if (isObjectLike(value.root) && value.root.children) {
        const plain = richTextToPlain(value);

        if (plain) out.push(plain);

        return;
      }

      for (const [key, child] of Object.entries(value)) {
        if (key === "id" || key === "blockType" || key === "blockName") continue;
        walk(child);
      }
    }
  };

  walk(fields);

  return out.join("\n");
}

export function documentText(fields: SchemaField[], doc: unknown): TextSection[] {
  const leaves = collectContentFields(fields, doc, {
    basePath: "",
    parentLocalized: false,
    warnings: [],
  });
  const out: TextSection[] = [];
  // The text of a rich text field holds the fields of the blocks embedded in it.
  const richRefs: string[] = [];

  for (const leaf of leaves) {
    if (richRefs.some((ref) => leaf.ref.startsWith(`${ref}[`))) continue;

    if (leaf.richText) {
      richRefs.push(leaf.ref);
      const text = richTextToPlain(getByPath(doc, parsePath(leaf.ref)));

      if (text.trim()) out.push({ ref: leaf.ref, type: leaf.type, text });
      continue;
    }

    if (typeof leaf.value !== "string" || !leaf.value.trim()) continue;
    if (!TEXT_TYPES.has(leaf.type)) continue;
    out.push({ ref: leaf.ref, type: leaf.type, text: leaf.value });
  }

  return out;
}

const TEXT_PAGE_CHARS = 24_000;

export function pageSections(
  sections: TextSection[],
  cursor: string | undefined,
  budget: number = TEXT_PAGE_CHARS
): { sections: TextSection[]; next?: string; from: number; to: number; total: number } {
  const [rawIdx, rawOff] = (cursor ?? "0").split(":");
  let i = Math.max(0, Number(rawIdx) || 0);
  let offset = Math.max(0, Number(rawOff) || 0);
  const from = i;
  const out: TextSection[] = [];
  let used = 0;

  while (i < sections.length && used < budget) {
    const section = sections[i];
    const rest = section.text.slice(offset);
    const room = budget - used;

    if (rest.length <= room) {
      out.push(offset ? { ...section, text: rest } : section);
      used += rest.length;
      i += 1;
      offset = 0;
      continue;
    }

    if (rest.length <= budget && out.length > 0) break;
    let cut = rest.lastIndexOf("\n", room);

    if (cut < room / 2) cut = room;
    out.push({ ...section, text: rest.slice(0, cut) });
    offset += cut + (rest[cut] === "\n" ? 1 : 0);
    used = budget;
  }

  const done = i >= sections.length;

  return {
    sections: out,
    from,
    to: done ? sections.length : i,
    total: sections.length,
    ...(done ? {} : { next: offset ? `${i}:${offset}` : String(i) }),
  };
}
