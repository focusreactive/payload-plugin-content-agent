import { convertMarkdownToLexical, editorConfigFactory } from "@payloadcms/richtext-lexical";
import type { SanitizedServerEditorConfig } from "@payloadcms/richtext-lexical";
import type { Payload } from "payload";
import { stableId } from "./corpus";

type Node = Record<string, any>;

const LANGUAGES = new Set(["ts", "tsx", "js", "json", "bash", "graphql"]);

export const blockNode = (key: string, blockType: string, fields: object): Node => ({
  type: "block",
  version: 2,
  format: "",
  fields: { id: stableId(key), blockName: "", blockType, ...fields },
});

export const inlineBlockNode = (key: string, blockType: string, fields: object): Node => ({
  type: "inlineBlock",
  version: 1,
  fields: { id: stableId(key), blockType, ...fields },
});

export const textNode = (text: string, format = 0): Node => ({
  type: "text",
  version: 1,
  text,
  format,
  style: "",
  mode: "normal",
  detail: 0,
});

const plainText = (node: Node): string =>
  node.type === "text" ? node.text : (node.children ?? []).map(plainText).join("");

// The converter keeps the spaces of the markdown cell: "| a |" gives " a ".
function trimCell(cell: Node) {
  for (const paragraph of cell.children ?? []) {
    const children: Node[] = paragraph.children ?? [];
    const first = children[0];
    const last = children.at(-1);

    if (first?.type === "text") first.text = first.text.trimStart();
    if (last?.type === "text") last.text = last.text.trimEnd();
    paragraph.children = children.filter((child) => child.type !== "text" || child.text !== "");
  }
}

// The converter gives every link a random id: the place of the link gives it here.
function tidy(node: Node, linkId: () => string) {
  if (node.type === "tablecell") trimCell(node);
  if (node.type === "link" || node.type === "autolink") node.id = linkId();
  for (const child of node.children ?? []) tidy(child, linkId);
}

// A quote that opens with a bold label, "**Note:** text", is a callout block.
function calloutOf(node: Node, key: string): Node | null {
  const [label, ...rest] = node.children ?? [];

  if (node.type !== "quote" || label?.type !== "text" || !(label.format & 1)) return null;
  if (!label.text.trim().endsWith(":")) return null;

  const title = label.text.trim().slice(0, -1);

  return blockNode(key, "callout", {
    tone: /tip/iu.test(title) ? "tip" : /warn/iu.test(title) ? "warning" : "note",
    title,
    text: rest.map(plainText).join("").trim(),
  });
}

export function markdownConverter(payload: Payload, collection: string, fieldName: string) {
  const field = payload.collections[collection].config.flattenedFields.find(
    (candidate) => candidate.name === fieldName
  );
  const editorConfig: SanitizedServerEditorConfig = editorConfigFactory.fromField({
    field: field as never,
  });

  // Fenced code is a `codeSample` block; the text between two fences goes through the converter.
  return (markdown: string, key: string) => {
    const children: Node[] = [];
    let links = 0;
    const linkId = () => stableId(`${key}:link:${links++}`);
    const pieces = markdown.split(/^[ \t]*```(\w*)[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/mu);

    for (let i = 0; i < pieces.length; i += 3) {
      const text = pieces[i].trim();

      if (text) {
        const { root } = convertMarkdownToLexical({ editorConfig, markdown: text });

        tidy(root, linkId);
        children.push(
          ...root.children.map(
            (node: Node, n: number) => calloutOf(node, `${key}:callout:${i}:${n}`) ?? node
          )
        );
      }

      if (i + 2 < pieces.length) {
        const code = pieces[i + 2];
        const indent = /^[ \t]*/u.exec(code)?.[0].length ?? 0;

        children.push(
          blockNode(`${key}:code:${i}`, "codeSample", {
            ...(LANGUAGES.has(pieces[i + 1]) ? { language: pieces[i + 1] } : {}),
            code: code
              .split("\n")
              .map((line) => line.slice(Math.min(indent, /^[ \t]*/u.exec(line)?.[0].length ?? 0)))
              .join("\n"),
          })
        );
      }
    }

    return {
      root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children },
    };
  };
}

export type ToLexical = ReturnType<typeof markdownConverter>;

// The tone of a callout is read from an English label, so a translation takes it from its source.
export function withTonesOf<T extends { root: Node }>(source: { root: Node }, target: T): T {
  const callouts = (state: { root: Node }): Node[] =>
    state.root.children.filter((node: Node) => node.fields?.blockType === "callout");
  const tones = callouts(source).map((node) => node.fields.tone);

  for (const [i, node] of callouts(target).entries())
    node.fields.tone = tones[i] ?? node.fields.tone;

  return target;
}
