import type { SchemaField } from "../../../types.js";
import { bodyHint } from "../bodyHint.js";
import { getByPath, isObjectLike, parsePath, resolveFieldAtPath } from "../discovery.js";
import type { Path } from "../discovery.js";
import { inlineMarkupError } from "../editorFit.js";
import { inlineNodesFromMarkdown, startsWithBlockMarkdown } from "../lexicalEngine.js";
import { htmlMarkupError, plainHtmlError } from "../richtext/surgical.js";
import { validateFieldValue } from "../schemaValues.js";
import { normalizeForMatch } from "../guards.js";
import { documentText } from "../documentText.js";
import { unusableLinkError } from "../linkUrl.js";
import { PROSE_TYPES, rootFields, sharedRefusal } from "./slots.js";
import type { ApplyRun, RewriteContext } from "./slots.js";

interface AppendEntry {
  ref: string;
  para: string;
  path: Path;
}

function paragraphNode(
  text: string,
  field: SchemaField,
  direction: unknown
): { node: Record<string, unknown>; links: number } | { error: string } {
  const plain = {
    type: "text",
    detail: 0,
    format: 0,
    mode: "normal",
    style: "",
    text,
    version: 1,
  };
  const inline = inlineNodesFromMarkdown(text, plain);

  if (inline?.unusableUrl) return { error: `append: ${unusableLinkError(inline.unusableUrl)}` };
  const misfit = inline ? inlineMarkupError(field, inline) : null;

  if (misfit) return { error: misfit };

  return {
    links: inline?.links ?? 0,
    node: {
      type: "paragraph",
      children: inline ? inline.nodes : [plain],
      direction: direction ?? null,
      format: "",
      indent: 0,
      textFormat: 0,
      textStyle: "",
      version: 1,
    },
  };
}

function appendRichParagraph(
  { workspace }: RewriteContext,
  run: ApplyRun,
  { ref, para, path }: AppendEntry,
  field: SchemaField
): string | null {
  const value = getByPath(workspace.ref.current, path);

  if (!isObjectLike(value) || !isObjectLike(value.root) || !Array.isArray(value.root.children))
    return `"${ref}" is an empty rich text field, and \`append\` adds after text that is already there. Nothing was appended. Write its first paragraph with applyRichText({ ref: "${ref}", mode: "surgical", edits: [{ key: "0", action: "insertAfter", markdown: "<the paragraph>" }] }).`;
  if (field.unsupported || (field.editor && field.editor !== "lexical"))
    return `"${ref}" uses a "${field.editor ?? "unsupported"}" rich text editor, not Lexical: this agent cannot write it. Nothing was appended. Say so in your summary.`;
  const html = htmlMarkupError(`append["${ref}"]`, para);

  if (html) return html;
  const paragraphs = para
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const block = paragraphs.find(startsWithBlockMarkdown);

  if (block !== undefined)
    return `append["${ref}"] holds block markdown ("${block.slice(0, 12)}…"), and \`append\` adds plain paragraphs only: a heading, list item, quote or code fence would be stored as literal characters. Nothing was appended. Add this content with applyRichText({ ref: "${ref}", mode: "surgical" }) and an "insertAfter" edit on the last node.`;
  const nodes: Record<string, unknown>[] = [];
  let links = 0;

  for (const paragraph of paragraphs) {
    const built = paragraphNode(paragraph, field, value.root.direction);

    if ("error" in built) return built.error;
    nodes.push(built.node);
    links += built.links;
  }

  value.root.children.push(...nodes);
  run.linksCreated += links;

  return null;
}

function appendPlainParagraph(
  { workspace, state }: RewriteContext,
  { ref, para, path }: AppendEntry,
  res: { field: SchemaField; value: unknown }
): string | null {
  const { current } = state;

  if (!PROSE_TYPES.has(res.field.type))
    return `"${ref}" is a ${res.field.type} field - append works on text, textarea and richText fields. Write this field with setValues({ edits: [{ ref: "${ref}", value }] }).`;
  if (typeof res.value !== "string")
    return `"${ref}" holds no text yet, and \`append\` adds after text that is already there. Nothing was appended. Write the field with setValues({ edits: [{ ref: "${ref}", value: "<the text>" }] }).`;
  const html = plainHtmlError(`append["${ref}"]`, res.value, para);

  if (html) return html;
  const next = `${res.value.replace(/\s+$/u, "")}\n\n${para.trim()}`;
  const guard = validateFieldValue(res.field, next);

  if (!guard.ok) return guard.error ?? `"${ref}" rejected by field validation`;
  const parent =
    path.length > 1 ? getByPath(workspace.ref.current, path.slice(0, -1)) : workspace.ref.current;
  const last = path[path.length - 1];

  if (!isObjectLike(parent) || typeof last !== "string") return `Could not write to "${ref}".`;
  parent[last] = next;
  const fieldParts = current?.parts.get(ref);

  // Only a field read in parts keeps its entries valid after an append; a short field's one
  // entry still holds the text without the paragraph, so it must be read again.
  if (fieldParts) {
    current?.known.set(ref, next);
    fieldParts.seps[fieldParts.parts.length - 1] =
      (fieldParts.seps[fieldParts.parts.length - 1] ?? "") +
      (fieldParts.seps[fieldParts.parts.length - 1]?.trim() === "" &&
      fieldParts.seps.length >= fieldParts.parts.length
        ? ""
        : "\n\n");
    if (fieldParts.seps.length < fieldParts.parts.length) fieldParts.seps.push("\n\n");
    fieldParts.parts.push(para.trim());
  }

  return null;
}

const lines = (text: string) =>
  text
    .split(/\n+/u)
    .map(normalizeForMatch)
    .filter((line) => line !== "");

/** Every line of the paragraph is a whole paragraph of the document text already. */
function holdsParagraph(fields: SchemaField[], doc: unknown, para: string): boolean {
  const held = new Set(documentText(fields, doc).flatMap(({ text }) => lines(text)));
  const wanted = lines(para);

  return wanted.length > 0 && wanted.every((line) => held.has(line));
}

function appendEntry(
  rewrite: RewriteContext,
  run: ApplyRun,
  [ref, para]: [string, string],
  scope: { body: ReturnType<typeof bodyHint>; appendRefs: string[] }
): string | null {
  const { workspace } = rewrite;
  const { body, appendRefs } = scope;

  if (body && appendRefs.length > 1 && appendRefs.includes(body.ref) && ref !== body.ref)
    return `Not appended to "${ref}": the article body is "${body.ref}" and the paragraph goes there once - appending it to "${ref}" as well would duplicate it on the page.`;
  if (typeof para !== "string" || !para.trim()) return `append["${ref}"] is empty.`;
  if (holdsParagraph(rootFields(rewrite), workspace.ref.current, para))
    return `Not appended: this paragraph is already in the document. Nothing to do for "${ref}" - report the document as already done.`;
  const path = parsePath(ref);
  const res = resolveFieldAtPath(rootFields(rewrite), workspace.ref.current, path);

  if (!res || !res.field)
    return `"${ref}" does not resolve to a field - use a ref from readDocumentText's \`fields\`.`;
  if (res.readOnly) return `"${ref}" is read-only and must not be modified. Nothing was appended.`;
  const shared = sharedRefusal(rewrite, ref);

  if (shared) return shared;
  const entry: AppendEntry = { ref, para, path };
  const error =
    res.field.type === "richText"
      ? appendRichParagraph(rewrite, run, entry, res.field)
      : appendPlainParagraph(rewrite, entry, { field: res.field, value: res.value });

  if (error !== null) return error;
  run.appended.push(ref);
  run.touchedRefs.add(ref);

  return null;
}

export function applyAppends(
  rewrite: RewriteContext,
  run: ApplyRun,
  append: Record<string, string> | undefined
): void {
  const body = bodyHint(rootFields(rewrite), rewrite.workspace.ref.current);
  const appendRefs = Object.keys(append ?? {});

  for (const pair of Object.entries(append ?? {})) {
    const error = appendEntry(rewrite, run, pair, { body, appendRefs });

    if (error !== null) run.failed.push({ n: pair[0], error });
  }
}
