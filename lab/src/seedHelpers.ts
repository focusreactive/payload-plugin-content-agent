import type { Payload } from "payload";

type Inline = string | { link: string; text: string } | { bold: string };

const textNode = (text: string, format = 0) => ({
  type: "text",
  version: 1,
  text,
  format,
  style: "",
  mode: "normal",
  detail: 0,
});

function inline(parts: Inline[]) {
  return parts.map((part) => {
    if (typeof part === "string") return textNode(part);
    if ("bold" in part) return textNode(part.bold, 1);

    return {
      type: "link",
      version: 3,
      direction: "ltr",
      format: "",
      indent: 0,
      fields: { linkType: "custom", newTab: false, url: part.link },
      children: [textNode(part.text)],
    };
  });
}

const block = (type: string, extra: object, parts: Inline[]) => ({
  type,
  version: 1,
  direction: "ltr",
  format: "",
  indent: 0,
  ...extra,
  children: inline(parts),
});

export const p = (...parts: Inline[]) =>
  block("paragraph", { textFormat: 0, textStyle: "" }, parts);
export const h2 = (text: string) => block("heading", { tag: "h2" }, [text]);
export const ul = (...items: string[]) => ({
  type: "list",
  listType: "bullet",
  tag: "ul",
  start: 1,
  version: 1,
  direction: "ltr",
  format: "",
  indent: 0,
  children: items.map((item, i) => block("listitem", { value: i + 1 }, [item])),
});
export const link = (url: string, text: string) => ({ link: url, text });
export const bold = (text: string) => ({ bold: text });
export const richText = (...children: object[]) => ({
  root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children },
});

export type Created = { id: string | number };

// Typed loosely because each schema differs.
export const creator =
  (payload: Payload) =>
  (collection: string, data: object): Promise<Created> =>
    payload.create({
      collection: collection as never,
      data: { ...data, _status: "published" } as never,
    }) as unknown as Promise<Created>;
