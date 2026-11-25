import { tool } from "ai";
import type { SharpDependency } from "payload";
import { z } from "zod";
import { isRecord } from "../../borders.js";
import type { PayloadDoc } from "../../borders.js";
import type { SchemaContext } from "../../types.js";
import type { DocumentIO } from "../content/documentIo.js";
import { documentNotFoundError } from "../toolErrors.js";
import { stringifyCapped } from "./outputCap.js";
import { safeFetch } from "./web.js";
import { quiet } from "../../promises.js";

const MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 5_000_000;
const ENOUGH_PIXELS = 768;
const CONVERTED_LONG_SIDE = 1568;
const SVG_DENSITY = 144;
const TIMEOUT_MS = 15_000;

export interface Rendition {
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface ImageBytes {
  mediaType: string;
  data: string;
}

export type ImageLoader = (rendition: Rendition) => Promise<ImageBytes | { error: string }>;

/** Turns a picture of a type that a model does not read into one that it reads. */
export type ImageConverter = (image: ImageBytes) => Promise<ImageBytes | { error: string }>;

export interface ViewImageInput {
  collection: string;
  id: string | number;
}

export interface ViewImageContext {
  io: DocumentIO;
  schema: SchemaContext;
  load: ImageLoader;
  convert?: ImageConverter;
}

const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function renditionOf(value: unknown, anyImage = false): Rendition | null {
  if (!isRecord(value) || typeof value.url !== "string" || !value.url) return null;
  if (typeof value.mimeType !== "string") return null;
  if (!(anyImage ? value.mimeType.startsWith("image/") : MEDIA_TYPES.includes(value.mimeType)))
    return null;

  return {
    url: value.url,
    mimeType: value.mimeType,
    width: numberOf(value.width),
    height: numberOf(value.height),
  };
}

const longSide = ({ width, height }: Rendition): number =>
  width && height ? Math.max(width, height) : Number.POSITIVE_INFINITY;

/** The smallest stored size of the file that still shows its detail, else the largest one. */
export function renditionToShow(doc: PayloadDoc): Rendition | null {
  const sizes = isRecord(doc.sizes) ? Object.values(doc.sizes) : [];
  const all = [doc, ...sizes]
    .map((entry) => renditionOf(entry))
    .filter((entry): entry is Rendition => entry !== null)
    .sort((first, second) => longSide(first) - longSide(second));

  return all.find((entry) => longSide(entry) >= ENOUGH_PIXELS) ?? all.at(-1) ?? null;
}

const fileLabel = (collection: string, id: string | number, filename?: string) =>
  `${collection}/${id}${filename ? ` (${filename})` : ""}`;

const typeOf = (doc: PayloadDoc) => (typeof doc.mimeType === "string" ? doc.mimeType : "unknown");

const uploadSlugs = (schema: SchemaContext): string[] =>
  schema.collections.filter((collection) => collection.upload).map((collection) => collection.slug);

export async function viewImage(
  { io, schema, load, convert }: ViewImageContext,
  input: ViewImageInput
) {
  const { collection, id } = input;
  const slugs = uploadSlugs(schema);

  if (!slugs.includes(collection))
    return {
      error: `"${collection}" is not an upload collection, so its documents have no file. Upload collections: ${slugs.join(", ")}.`,
    };
  const { doc, error } = await io.read({ collection }, { id, callId: "view-image" });

  if (error) return { error };
  if (!doc) return { error: documentNotFoundError(`${collection}/${id}`) };
  const filename = typeof doc.filename === "string" ? doc.filename : undefined;
  const label = fileLabel(collection, id, filename);
  // A stored size that a model reads comes first; else the file itself, converted.
  const rendition = renditionToShow(doc) ?? (convert ? renditionOf(doc, true) : null);

  if (!rendition)
    return {
      error: `The file of ${label} has the type ${typeOf(doc)}, and no stored size of it has a type that viewImage shows (${MEDIA_TYPES.join(", ")}). The Payload config of the site has no \`sharp\`, so the plugin cannot convert it. Tell the person that you cannot see this file.`,
    };
  const loaded = await load(rendition);

  if ("error" in loaded)
    return {
      error: `The file of ${label} did not load: ${loaded.error} Tell the person that you cannot see this file.`,
    };
  // A provider refuses the whole request for one empty picture.
  if (!loaded.data)
    return {
      error: `The file of ${label} answered with no bytes: it is empty or missing in the storage of the site. Tell the person that you cannot see this file and that it looks broken.`,
    };
  const needsConverting = !MEDIA_TYPES.includes(rendition.mimeType);
  const image = needsConverting && convert ? await convert(loaded) : loaded;

  if ("error" in image)
    return {
      error: `The file of ${label} has the type ${rendition.mimeType}, and it did not convert to a type that a model reads: ${image.error} Tell the person that you cannot see this file.`,
    };

  return {
    collection,
    id,
    ...(filename ? { filename } : {}),
    mimeType: rendition.mimeType,
    width: numberOf(doc.width),
    height: numberOf(doc.height),
    shown: rendition,
    ...(needsConverting ? { convertedTo: image.mediaType } : {}),
    image,
  };
}

/** A converter from the `sharp` of the Payload config: WebP, at most CONVERTED_LONG_SIDE pixels. */
export function createImageConverter(sharp: SharpDependency): ImageConverter {
  return async ({ mediaType, data }) => {
    try {
      const input = Buffer.from(data, "base64");
      const output = await sharp(
        input,
        mediaType === "image/svg+xml" ? { density: SVG_DENSITY } : {}
      )
        .rotate()
        .resize({
          width: CONVERTED_LONG_SIDE,
          height: CONVERTED_LONG_SIDE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp()
        .toBuffer();

      return { mediaType: "image/webp", data: output.toString("base64") };
    } catch (err) {
      return { error: `${err instanceof Error ? err.message : String(err)}.` };
    }
  };
}

async function readBytes(res: globalThis.Response): Promise<Buffer | null> {
  const reader = res.body?.getReader();

  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) return Buffer.concat(chunks);
    total += value.byteLength;

    if (total > MAX_BYTES) {
      void quiet(reader.cancel());

      return null;
    }

    chunks.push(value);
  }
}

function absoluteUrl(url: string, siteUrl: string | undefined): string | null {
  try {
    return new URL(url, siteUrl || undefined).toString();
  } catch {
    return null;
  }
}

/** Loads a file of the site by its address. Only the host of `siteUrl` may be private. */
export function createImageLoader(
  siteUrl?: string,
  sessionHeaders?: Record<string, string>
): ImageLoader {
  const site = absoluteUrl("/", siteUrl);
  const siteOrigin = site ? new URL(site).origin : undefined;
  const trustedHosts = site ? new Set([new URL(site).host.toLowerCase()]) : undefined;

  return async ({ url, mimeType }) => {
    const address = absoluteUrl(url, siteUrl);

    if (!address)
      return {
        error: `its address "${url}" has no host, and the Payload config of the site has no \`serverURL\`.`,
      };

    try {
      const { res, error } = await safeFetch(address, {
        method: "GET",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        trustedHosts,
        // The file opens with the rights of the person who chats, and only on the site itself.
        ...(sessionHeaders && new URL(address).origin === siteOrigin
          ? { firstHostHeaders: sessionHeaders }
          : {}),
      });

      if (!res) return { error: `${error ?? "no answer"}.` };

      if (!res.ok) {
        void quiet(res.body?.cancel());

        return { error: `${address} answered HTTP ${res.status}.` };
      }

      const bytes = await readBytes(res);

      if (!bytes) return { error: `it is larger than ${MAX_BYTES / 1_000_000} MB.` };

      return { mediaType: mimeType, data: bytes.toString("base64") };
    } catch (err) {
      return { error: `${err instanceof Error ? err.message : String(err)}.` };
    }
  };
}

export const viewImageInput = z.object({
  collection: z.string().describe("The slug of the upload collection."),
  id: z.union([z.string(), z.number()]).describe("The id of the document that holds the file."),
});

const NOT_KEPT =
  "The picture itself is not kept in the history of the conversation. Call viewImage again to see it.";

export function createViewImageTool(context: ViewImageContext) {
  // The bytes stay out of the stored result: the model gets them once, with the call that asked.
  const shown = new Map<string, ImageBytes>();

  return tool({
    description:
      `Shows you ONE picture: the file of a document of an upload collection, by id. The result carries the picture itself, so you see what it shows, with its file name and its size in pixels. ` +
      `Call it whenever the task needs what a picture shows and no text of the site says it: writing or checking an alt text, a caption or a description, or checking that a picture fits the place where it is used. Never describe a picture from its file name or from the text around it: look at it first. ` +
      `One call shows one picture: for several pictures call it once for each of them, and write the text of each picture from what you saw in it. ` +
      `Only you see the picture: no other tool and no editor does. Write the text yourself and pass it word for word to the tool that saves it. ` +
      (context.convert
        ? `It shows every picture: it converts a picture of another type than ${MEDIA_TYPES.join(", ")} before you see it. `
        : `It shows ${MEDIA_TYPES.join(", ")} files. `) +
      `Upload collections: ${uploadSlugs(context.schema).join(", ")}`,
    inputSchema: viewImageInput,
    execute: async (input: ViewImageInput, { toolCallId }) => {
      const output = await viewImage(context, input);

      if ("error" in output) return output;
      const { image, ...facts } = output;

      shown.set(toolCallId, image);

      return facts;
    },
    toModelOutput: ({ toolCallId, output }) => {
      const image = shown.get(toolCallId);

      const facts = stringifyCapped(output);

      if (!image)
        return {
          type: "text" as const,
          value: "error" in output ? facts : `${facts}\n${NOT_KEPT}`,
        };

      return {
        type: "content" as const,
        value: [
          { type: "text" as const, text: facts },
          {
            type: "file" as const,
            mediaType: image.mediaType,
            data: { type: "data" as const, data: image.data },
          },
        ],
      };
    },
  });
}

export const hasUploads = (schema: SchemaContext): boolean => uploadSlugs(schema).length > 0;
