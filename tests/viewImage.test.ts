import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentIO } from "../src/agent/content/documentIo.js";
import { createTools } from "../src/agent/tools/index.js";
import sharp from "sharp";
import {
  createImageConverter,
  createImageLoader,
  createViewImageTool,
  renditionToShow,
  viewImage,
} from "../src/agent/tools/viewImage.js";
import type { ImageLoader } from "../src/agent/tools/viewImage.js";
import type { SchemaContext } from "../src/types.js";
import { pluginOptions } from "./harness.js";

const collection = (slug: string, upload: boolean) => ({
  slug,
  upload,
  fields: [{ name: "label", type: "text" }],
  hasVersions: false,
  hasDrafts: false,
  hasAuth: false,
  timestamps: true,
});

const schema = {
  globals: [],
  collections: [collection("files", true), collection("notes", false)],
} as unknown as SchemaContext;

const stored = {
  id: 7,
  filename: "a.png",
  mimeType: "image/png",
  url: "/files/a.png",
  width: 4000,
  height: 3000,
  sizes: {
    small: { url: "/files/a-400.png", mimeType: "image/png", width: 400, height: 300 },
    middle: { url: "/files/a-1024.png", mimeType: "image/png", width: 1024, height: 768 },
    large: { url: "/files/a-2048.png", mimeType: "image/png", width: 2048, height: 1536 },
    empty: { url: null, mimeType: null, width: null, height: null },
  },
};

const ioWith = (docs: Record<string, unknown>): DocumentIO =>
  ({
    read: async (_target: unknown, { id }: { id: string | number }) => ({
      doc: docs[String(id)] ?? null,
    }),
  }) as unknown as DocumentIO;

const loaded: ImageLoader = async ({ mimeType }) => ({ mediaType: mimeType, data: "QUJD" });
const empty: ImageLoader = async ({ mimeType }) => ({ mediaType: mimeType, data: "" });

describe("renditionToShow", () => {
  it("takes the smallest stored size that still shows the detail", () => {
    expect(renditionToShow(stored)?.url).toBe("/files/a-1024.png");
  });

  it("takes the largest one when every size is small", () => {
    const doc = { ...stored, width: 500, height: 300, sizes: { small: stored.sizes.small } };

    expect(renditionToShow(doc)?.url).toBe("/files/a.png");
  });

  it("takes a size of a type it can show when the file itself has another type", () => {
    const doc = { ...stored, mimeType: "image/tiff" };

    expect(renditionToShow(doc)?.url).toBe("/files/a-1024.png");
  });

  it("gives nothing for a file with no type it can show", () => {
    expect(renditionToShow({ id: 1, url: "/files/a.svg", mimeType: "image/svg+xml" })).toBeNull();
  });
});

const refusedLoad: ImageLoader = async () => ({ error: "it answered HTTP 403." });

describe("viewImage", () => {
  const context = { io: ioWith({ 7: stored, 8: { id: 8, mimeType: "image/svg+xml" } }), schema };

  it("names the upload collections when the collection has no files", async () => {
    const result = await viewImage({ ...context, load: loaded }, { collection: "notes", id: 1 });

    expect(result).toEqual({ error: expect.stringContaining("Upload collections: files.") });
  });

  it("names the tool that finds an id when the document does not exist", async () => {
    const result = await viewImage({ ...context, load: loaded }, { collection: "files", id: 99 });

    expect(result).toEqual({ error: expect.stringContaining("listDocuments") });
  });

  it("names the types it shows when the file has another type", async () => {
    const result = await viewImage({ ...context, load: loaded }, { collection: "files", id: 8 });

    expect(result).toEqual({ error: expect.stringContaining("image/png, image/jpeg") });
  });

  it("reports why a file did not load", async () => {
    const result = await viewImage(
      { ...context, load: refusedLoad },
      { collection: "files", id: 7 }
    );

    expect(result).toEqual({ error: expect.stringContaining("HTTP 403") });
  });

  it("refuses a file that answers with no bytes, so no empty picture reaches the model", async () => {
    const result = await viewImage({ ...context, load: empty }, { collection: "files", id: 7 });

    expect(result).toEqual({ error: expect.stringContaining("no bytes") });
  });

  it("returns the picture with the facts of the file", async () => {
    const result = await viewImage({ ...context, load: loaded }, { collection: "files", id: 7 });

    expect(result).toMatchObject({
      filename: "a.png",
      width: 4000,
      height: 3000,
      shown: { url: "/files/a-1024.png" },
      image: { mediaType: "image/png", data: "QUJD" },
    });
  });
});

const failing = async () => ({ error: "unsupported image format." });
const webp = (data: string) => Buffer.from(data, "base64").subarray(8, 12).toString("latin1");

describe("viewImage of a file with no type a model reads", () => {
  const avif = {
    id: 9,
    filename: "photo.avif",
    mimeType: "image/avif",
    url: "/files/photo.avif",
    width: 1974,
    height: 1481,
  };
  const context = { io: ioWith({ 9: avif }), schema, load: loaded };
  const convert = vi.fn(async () => ({ mediaType: "image/webp", data: "V0VCUA==" }));

  it("loads the file itself and converts it when the site gives a converter", async () => {
    const result = await viewImage({ ...context, convert }, { collection: "files", id: 9 });

    expect(convert).toHaveBeenCalledWith({ mediaType: "image/avif", data: "QUJD" });
    expect(result).toMatchObject({
      filename: "photo.avif",
      mimeType: "image/avif",
      shown: { url: "/files/photo.avif", mimeType: "image/avif" },
      convertedTo: "image/webp",
      image: { mediaType: "image/webp", data: "V0VCUA==" },
    });
  });

  it("says why it cannot show the file when the site gives no converter", async () => {
    const result = await viewImage(context, { collection: "files", id: 9 });

    expect(result).toEqual({ error: expect.stringContaining("`sharp`") });
  });

  it("reports a file that does not convert", async () => {
    const result = await viewImage(
      { ...context, convert: failing },
      { collection: "files", id: 9 }
    );

    expect(result).toEqual({ error: expect.stringContaining("unsupported image format.") });
  });
});

describe("createImageConverter", () => {
  const convert = createImageConverter(sharp);

  it("turns an AVIF file into WebP no larger than the long side it keeps", async () => {
    const avif = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: "#c00" },
    })
      .avif()
      .toBuffer();
    const result = await convert({ mediaType: "image/avif", data: avif.toString("base64") });

    expect(result).toMatchObject({ mediaType: "image/webp" });
    const data = (result as { data: string }).data;
    const meta = await sharp(Buffer.from(data, "base64")).metadata();

    expect(webp(data)).toBe("WEBP");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1568);
  });

  it("draws an SVG file", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#00c"/></svg>';
    const result = await convert({
      mediaType: "image/svg+xml",
      data: Buffer.from(svg).toString("base64"),
    });

    expect(webp((result as { data: string }).data)).toBe("WEBP");
  });

  it("reports bytes that are no picture", async () => {
    expect(await convert({ mediaType: "image/avif", data: "QUJD" })).toEqual({
      error: expect.any(String),
    });
  });
});

const made = () =>
  createViewImageTool({ io: ioWith({ 7: stored }), schema, load: loaded }) as unknown as {
    description: string;
    execute: (input: unknown, options: { toolCallId: string }) => Promise<Record<string, any>>;
    toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => any;
  };

describe("the viewImage tool", () => {
  const input = { collection: "files", id: 7 };

  it("lists the upload collections of the schema in its description", () => {
    expect(made().description).toMatch(/Upload collections: files$/u);
  });

  it("names the types it shows, or says that it converts the others", () => {
    const converting = createViewImageTool({
      io: ioWith({}),
      schema,
      load: loaded,
      convert: async () => ({ error: "x" }),
    }) as unknown as { description: string };

    expect(made().description).toContain(
      "It shows image/png, image/jpeg, image/webp, image/gif files."
    );
    expect(converting.description).toContain("converts a picture of another type");
  });

  it("says that only the caller sees the picture, so the saved text must be passed word for word", () => {
    expect(made().description).toContain("pass it word for word");
  });

  it("keeps the bytes out of the stored result and gives them to the model once", async () => {
    const tool = made();
    const output = await tool.execute(input, { toolCallId: "call-1" });

    expect(JSON.stringify(output)).not.toContain("QUJD");
    expect(tool.toModelOutput({ toolCallId: "call-1", input, output })).toEqual({
      type: "content",
      value: [
        { type: "text", text: expect.stringContaining("a.png") },
        { type: "file", mediaType: "image/png", data: { type: "data", data: "QUJD" } },
      ],
    });
  });

  it("says that the picture is gone for a result of an earlier turn", async () => {
    const output = await made().execute(input, { toolCallId: "call-1" });
    const later = made().toModelOutput({ toolCallId: "call-1", input, output });

    expect(later.type).toBe("text");
    expect(later.value).toContain("Call viewImage again");
  });

  it("gives an error as text", async () => {
    const tool = made();
    const output = await tool.execute({ collection: "notes", id: 1 }, { toolCallId: "call-2" });

    expect(tool.toModelOutput({ toolCallId: "call-2", input, output })).toEqual({
      type: "text",
      value: expect.stringContaining("not an upload collection"),
    });
  });
});

describe("createImageLoader", () => {
  afterEach(() => vi.unstubAllGlobals());

  const rendition = { url: "/files/a.png", mimeType: "image/png" };

  it("refuses an address without a host when the site names no address", async () => {
    expect(await createImageLoader()(rendition)).toEqual({
      error: expect.stringContaining("serverURL"),
    });
  });

  it("loads a file of the site as base64", async () => {
    const fetched = vi.fn(
      async (_url: string) => new Response(Buffer.from("ABC"), { status: 200 })
    );

    vi.stubGlobal("fetch", fetched);

    expect(await createImageLoader("http://localhost:3999")(rendition)).toEqual({
      mediaType: "image/png",
      data: "QUJD",
    });
    expect(fetched.mock.calls[0]?.[0]).toBe("http://localhost:3999/files/a.png");
  });

  it("sends the login of the person to the site and not to a host it redirects to", async () => {
    const fetched = vi.fn(async (url: string, _init: { headers?: Record<string, string> }) =>
      url.startsWith("http://localhost:3999")
        ? new Response(null, { status: 302, headers: { location: "https://93.184.216.34/a.png" } })
        : new Response(Buffer.from("ABC"), { status: 200 })
    );

    vi.stubGlobal("fetch", fetched);
    const load = createImageLoader("http://localhost:3999", { cookie: "session=1" });

    expect(await load(rendition)).toEqual({ mediaType: "image/png", data: "QUJD" });
    expect(fetched.mock.calls[0]?.[1].headers).toEqual({ cookie: "session=1" });
    expect(fetched.mock.calls[1]?.[1].headers).toBeUndefined();
  });

  it("sends no login to a file on another host", async () => {
    const fetched = vi.fn(
      async (_url: string, _init: { headers?: Record<string, string> }) =>
        new Response(Buffer.from("ABC"), { status: 200 })
    );

    vi.stubGlobal("fetch", fetched);
    const load = createImageLoader("http://localhost:3999", { cookie: "session=1" });

    await load({ url: "https://93.184.216.34/a.png", mimeType: "image/png" });
    expect(fetched.mock.calls[0]?.[1].headers).toBeUndefined();
  });

  it("sends no login to the host of the site over another scheme", async () => {
    const fetched = vi.fn(
      async (_url: string, _init: { headers?: Record<string, string> }) =>
        new Response(Buffer.from("ABC"), { status: 200 })
    );

    vi.stubGlobal("fetch", fetched);
    const load = createImageLoader("https://localhost:3999", { cookie: "session=1" });

    await load({ url: "http://localhost:3999/a.png", mimeType: "image/png" });
    expect(fetched.mock.calls[0]?.[1].headers).toBeUndefined();
  });

  it("reports the status of a file that does not open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 403 }))
    );

    expect(await createImageLoader("http://localhost:3999")(rendition)).toEqual({
      error: expect.stringContaining("HTTP 403"),
    });
  });

  it("refuses a file over the size limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(Buffer.alloc(5_000_001), { status: 200 }))
    );

    expect(await createImageLoader("http://localhost:3999")(rendition)).toEqual({
      error: expect.stringContaining("larger than 5 MB"),
    });
  });
});

const options = (imageInput: boolean) => pluginOptions({ mcpUrl: undefined, imageInput });

describe("createTools and viewImage", () => {
  const withoutUploads = { ...schema, collections: [collection("notes", false)] } as SchemaContext;

  it("is there for a schema with an upload collection", () => {
    expect(createTools({}, schema, options(true)).viewImage).toBeDefined();
  });

  it("is not there when the option is off", () => {
    expect(createTools({}, schema, options(false)).viewImage).toBeUndefined();
  });

  it("is not there for a schema without an upload collection", () => {
    expect(createTools({}, withoutUploads, options(true)).viewImage).toBeUndefined();
  });
});
