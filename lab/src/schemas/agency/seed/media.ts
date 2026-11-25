import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { Payload } from "payload";
import sharp from "sharp";

type Shape = "cover" | "logo" | "photo" | "badge";

const SIZES: Record<Shape, [number, number]> = {
  cover: [1200, 630],
  logo: [320, 160],
  photo: [240, 240],
  badge: [200, 200],
};

// The picture is drawn from the file name alone, so it is the same on every run.
function draw(name: string, shape: Shape) {
  const [width, height] = SIZES[shape];
  const hash = createHash("sha1").update(name).digest();
  const hue = (hash[0] * 360) / 256;
  const second = (hue + 40 + hash[1] / 4) % 360;
  const cx = (hash[2] / 255) * width;
  const cy = (hash[3] / 255) * height;
  const radius = Math.min(width, height) * (0.25 + hash[4] / 512);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="hsl(${hue.toFixed(0)},55%,${shape === "logo" ? 94 : 42}%)"/>
<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${radius.toFixed(0)}" fill="hsl(${second.toFixed(0)},70%,60%)"/>
<rect x="${(width * 0.1).toFixed(0)}" y="${(height * 0.72).toFixed(0)}" width="${(width * (0.3 + hash[5] / 512)).toFixed(0)}" height="${(height * 0.08).toFixed(0)}" fill="hsl(${second.toFixed(0)},30%,20%)"/>
</svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

const PHOTOS = path.resolve(process.cwd(), "content", "agency", "photos");

// A real photo, cut to the size of the shape: a model that looks at it sees a scene, not shapes.
function photograph(file: string, shape: Shape) {
  const [width, height] = SIZES[shape];

  return sharp(readFileSync(path.join(PHOTOS, file)))
    .resize(width, height, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// `t` gives a text in the second locale.
export function mediaLibrary(payload: Payload, locale: string, t: (text: string) => string) {
  rmSync(path.resolve(process.cwd(), ".state", "agency", "media"), {
    recursive: true,
    force: true,
  });

  return async (
    name: string,
    shape: Shape,
    alt: string,
    extra: { caption?: string; credit?: string } = {},
    secondAlt = alt,
    photo?: string
  ): Promise<number | string> => {
    const data = await (photo ? photograph(photo, shape) : draw(name, shape));
    const created = await payload.create({
      collection: "media" as never,
      data: { alt, ...extra } as never,
      file: { data, mimetype: "image/png", name: `${name}.png`, size: data.length },
    });

    const { id } = created as { id: number | string };

    await payload.update({
      collection: "media" as never,
      id,
      locale: locale as never,
      data: {
        alt: t(secondAlt),
        ...(extra.caption ? { caption: t(extra.caption) } : {}),
      } as never,
    });

    return id;
  };
}

export type AddMedia = ReturnType<typeof mediaLibrary>;
