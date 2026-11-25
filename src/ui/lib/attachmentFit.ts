import type { UIMessage } from "ai";

// Mirrors MAX_ATTACHMENTS_PER_MESSAGE in agent/attachments.ts.
export const MAX_FILES = 5;

// The files travel inside the JSON body as base64, which adds a third, and a host in front of
// the plugin may refuse a body of a few megabytes before the endpoint runs.
// 3 MB of files plus the text of a conversation stays under a 4.5 MB body.
export const MAX_REQUEST_FILE_BYTES = 3 * 1024 * 1024;

export const IMAGE_MAX_SIDE = 2048;

const SHRINK_ABOVE_BYTES = 400 * 1024;

const SHRUNK_TYPE = "image/jpeg";

const SHRUNK_QUALITY = 0.85;

const SHRINKABLE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const HOST_REFUSAL_MESSAGE =
  "The server refused this message because it is too large. Send it again with fewer or smaller files, or start a new chat.";

export function fittedSize(width: number, height: number, maxSide: number = IMAGE_MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

interface Sized {
  size: number;
}

export function fitFiles<T extends Sized>(current: T[], incoming: T[]) {
  const accepted: T[] = [];
  const refused: T[] = [];
  let bytes = current.reduce((sum, file) => sum + file.size, 0);

  for (const file of incoming) {
    const fits =
      current.length + accepted.length < MAX_FILES && bytes + file.size <= MAX_REQUEST_FILE_BYTES;

    if (fits) {
      accepted.push(file);
      bytes += file.size;
    } else {
      refused.push(file);
    }
  }

  return { accepted, refused };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function refusalNote(refused: Array<Sized & { name: string }>): string {
  if (!refused.length) return "";
  const names = refused.map((file) => `${file.name} (${formatBytes(file.size)})`).join(", ");

  return `Not attached: ${names}. One message takes up to ${MAX_FILES} files and ${formatBytes(MAX_REQUEST_FILE_BYTES)} in total.`;
}

const inlineBytes = (url: string) => Math.floor(((url.length - url.indexOf(",") - 1) * 3) / 4);

// The chat sends the whole conversation with each request, so the files of earlier messages
// would grow the body without end. The newest files stay; an older one goes without its bytes,
// and the endpoint tells the agent that it is no longer there.
export function withinFileBudget<T extends UIMessage>(
  messages: T[],
  budget: number = MAX_REQUEST_FILE_BYTES
): T[] {
  let remaining = budget;
  const result = [...messages];

  for (let i = result.length - 1; i >= 0; i--) {
    const message = result[i];

    if (!message.parts?.some((part) => part.type === "file")) continue;

    const parts = [...message.parts];

    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j];

      if (part.type !== "file" || !part.url.startsWith("data:")) continue;

      const bytes = inlineBytes(part.url);

      if (bytes <= remaining) remaining -= bytes;
      else parts[j] = { ...part, url: "" };
    }

    result[i] = { ...message, parts };
  }

  return result;
}

const shrunkName = (name: string) => `${name.replace(/\.[^.]+$/u, "")}.jpg`;

export async function shrinkImage(file: File): Promise<File> {
  if (!SHRINKABLE_TYPES.has(file.type) || file.size <= SHRINK_ABOVE_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fittedSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) return file;

    // JPEG has no transparency: without a ground a transparent picture turns black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, SHRUNK_TYPE, SHRUNK_QUALITY)
    );

    if (!blob || blob.size >= file.size) return file;

    return new File([blob], shrunkName(file.name), { type: SHRUNK_TYPE });
  } catch {
    return file;
  }
}

// A host that caps the body answers 413 with its own page, not with the JSON of the endpoint.
export async function fetchWithHostRefusal(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, init);
  const isOwnAnswer = response.headers.get("content-type")?.includes("application/json");

  if (response.status !== 413 || isOwnAnswer) return response;

  return Response.json({ error: HOST_REFUSAL_MESSAGE }, { status: 413 });
}
