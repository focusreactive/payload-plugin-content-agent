import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from "ai";
import { z } from "zod";
import { isRecord } from "../borders.js";

function isNativeFileType(mediaType: string): boolean {
  return mediaType.startsWith("image/") || mediaType === "application/pdf";
}

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export const MAX_EXTRACTED_TEXT_CHARS = 40_000;

export const MAX_NATIVE_ATTACHMENT_BYTES_PER_REQUEST = 12 * 1024 * 1024;

type Part = UIMessagePart<UIDataTypes, UITools>;

function dataUrlBytes(url: string): number {
  const comma = url.indexOf(",");

  if (comma === -1) return url.length;
  const payload = url.slice(comma + 1);

  if (!url.slice(0, comma).includes("base64")) return payload.length;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;

  return Math.floor((payload.length * 3) / 4) - padding;
}

// The AI SDK's `getTextFromDataUrl` calls `window.atob`:
// it throws on the server and decodes bytes as latin1.
// Buffer decodes base64 to real UTF-8.
function decodeDataUrl(url: string): Buffer {
  const comma = url.indexOf(",");
  const payload = comma === -1 ? url : url.slice(comma + 1);
  const isBase64 = comma !== -1 && url.slice(0, comma).includes("base64");

  return Buffer.from(
    isBase64 ? payload : decodeURIComponent(payload),
    isBase64 ? "base64" : "utf-8"
  );
}

function isTextType(mediaType: string, filename?: string): boolean {
  if (mediaType.startsWith("text/")) return true;
  if (mediaType === "application/json" || mediaType === "application/xml") return true;

  if (!mediaType || mediaType === "application/octet-stream") {
    return /\.(md|markdown|txt|csv|tsv|json|ya?ml|xml|log)$/iu.test(filename ?? "");
  }

  return false;
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function isDocx(mediaType: string, filename?: string): boolean {
  return mediaType === DOCX || /\.docx$/iu.test(filename ?? "");
}

function isXlsx(mediaType: string, filename?: string): boolean {
  return mediaType === XLSX || /\.xlsx$/iu.test(filename ?? "");
}

// The specifier goes through a variable
// so TypeScript and the bundler do not require the optional package.
async function optionalImport(specifier: string): Promise<unknown> {
  try {
    return await import(specifier);
  } catch {
    return null;
  }
}

const exportsOf = (module: unknown): unknown =>
  isRecord(module) ? (module.default ?? module) : module;

const docxTextSchema = z.object({ value: z.string() });

const workbookSchema = z.object({
  SheetNames: z.array(z.string()),
  Sheets: z.record(z.string(), z.unknown()),
});

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await optionalImport("mammoth");

  if (!mammoth) {
    throw new Error(
      "reading .docx needs the optional `mammoth` package, which is not installed in this project (`npm i mammoth`)"
    );
  }

  const library = exportsOf(mammoth);

  if (!isRecord(library) || typeof library.extractRawText !== "function") {
    throw new TypeError("the installed `mammoth` package has no `extractRawText` function");
  }

  const result: unknown = await library.extractRawText({ buffer });

  return docxTextSchema.parse(result).value;
}

async function extractXlsx(buffer: Buffer): Promise<string> {
  const xlsx = await optionalImport("xlsx");

  if (!xlsx) {
    throw new Error(
      "reading .xlsx needs the optional `xlsx` package 0.20.2 or newer, which is not installed in this project. Its versions from 0.20.2 on are published on the SheetJS CDN, not on npm: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`"
    );
  }

  return workbookText(exportsOf(xlsx), buffer);
}

/**
 * A row of the text takes at least one character, so the workbook is read only as far as the cap
 * of the extracted text, and no sheet is converted after the text reached it.
 */
export function workbookText(library: unknown, buffer: Buffer): string {
  const utils = isRecord(library) ? library.utils : undefined;

  if (!isRecord(library) || typeof library.read !== "function" || !isRecord(utils)) {
    throw new TypeError("the installed `xlsx` package has no `read` function and `utils`");
  }

  const sheetToCsv = utils.sheet_to_csv;

  if (typeof sheetToCsv !== "function") {
    throw new TypeError("the installed `xlsx` package has no `utils.sheet_to_csv` function");
  }

  const workbook = workbookSchema.parse(
    library.read(buffer, { type: "buffer", sheetRows: MAX_EXTRACTED_TEXT_CHARS })
  );
  const sheets: string[] = [];
  let length = 0;

  for (const name of workbook.SheetNames) {
    if (length > MAX_EXTRACTED_TEXT_CHARS) break;
    const sheet = `## Sheet: ${name}\n${sheetToCsv.call(utils, workbook.Sheets[name])}`;

    sheets.push(sheet);
    length += sheet.length;
  }

  return sheets.join("\n\n");
}

function cap(text: string, filename: string): string {
  if (text.length <= MAX_EXTRACTED_TEXT_CHARS) return text;

  return (
    text.slice(0, MAX_EXTRACTED_TEXT_CHARS) +
    `\n\n... [truncated: "${filename}" holds ${text.length} chars, ${MAX_EXTRACTED_TEXT_CHARS} shown. ` +
    "Ask the user to narrow the file or point at the part that matters rather than assuming the rest is empty.]"
  );
}

function attachmentText(filename: string, body: string): Part {
  return { type: "text", text: `<attachment filename="${filename}">\n${body}\n</attachment>` };
}

function attachmentProblem(filename: string, reason: string): Part {
  return {
    type: "text",
    text:
      `<attachment filename="${filename}" status="unavailable">\nThis attachment could not be read: ${reason}. ` +
      "Tell the user plainly; do not guess at its contents.\n</attachment>",
  };
}

export interface AttachmentOutcome {
  filename: string;
  mediaType: string;
  handling: "native" | "text" | "dropped";
  reason?: string;
}

export interface NormalizedAttachments {
  messages: UIMessage[];
  outcomes: AttachmentOutcome[];
}

interface AttachmentFile {
  part: Part;
  url: string;
  declaredFilename: string | undefined;
  filename: string;
  mediaType: string;
}

interface HandledAttachment {
  part: Part;
  outcome: AttachmentOutcome;
}

interface NativeBudget {
  remaining: number;
}

function overMessageLimit(file: AttachmentFile): HandledAttachment {
  const { filename, mediaType } = file;

  return {
    part: attachmentProblem(
      filename,
      `more than ${MAX_ATTACHMENTS_PER_MESSAGE} files were attached to one message`
    ),
    outcome: {
      filename,
      mediaType,
      handling: "dropped",
      reason: "per-message limit",
    },
  };
}

function tooLarge(file: AttachmentFile, bytes: number): HandledAttachment {
  const { filename, mediaType } = file;
  const reason = `it is ${Math.round(bytes / 1024 / 1024)} MB, over the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit`;

  return {
    part: attachmentProblem(filename, reason),
    outcome: { filename, mediaType, handling: "dropped", reason: "too large" },
  };
}

function droppedEarlier(file: AttachmentFile): HandledAttachment {
  const { filename, mediaType } = file;

  return {
    part: attachmentProblem(
      filename,
      "it was attached earlier in this conversation and had to be dropped to keep the request within size limits. Ask the user to re-attach it if it is still relevant"
    ),
    outcome: { filename, mediaType, handling: "dropped", reason: "request budget" },
  };
}

function nativeAttachment(
  file: AttachmentFile,
  bytes: number,
  nativeBudget: NativeBudget
): HandledAttachment {
  const { filename, mediaType } = file;
  const inline = file.url.startsWith("data:");

  if (inline && bytes > nativeBudget.remaining) return droppedEarlier(file);

  if (inline) nativeBudget.remaining -= bytes;

  return { part: file.part, outcome: { filename, mediaType, handling: "native" } };
}

async function textAttachment(file: AttachmentFile): Promise<HandledAttachment> {
  const { filename, mediaType } = file;

  try {
    let text: string;

    if (isTextType(mediaType, file.declaredFilename)) {
      text = decodeDataUrl(file.url).toString("utf-8");
    } else if (isDocx(mediaType, file.declaredFilename)) {
      text = await extractDocx(decodeDataUrl(file.url));
    } else if (isXlsx(mediaType, file.declaredFilename)) {
      text = await extractXlsx(decodeDataUrl(file.url));
    } else {
      return {
        part: attachmentProblem(
          filename,
          `this file type (${mediaType || "unknown"}) cannot be read. Images and PDFs are read directly; .docx/.xlsx and plain-text formats are converted to text. Suggest exporting it as PDF or plain text`
        ),
        outcome: {
          filename,
          mediaType,
          handling: "dropped",
          reason: "unsupported type",
        },
      };
    }

    if (!text.trim()) {
      return {
        part: attachmentProblem(
          filename,
          "it contains no extractable text (it may be empty, or a scan with no text layer)"
        ),
        outcome: { filename, mediaType, handling: "dropped", reason: "no text" },
      };
    }

    return {
      part: attachmentText(filename, cap(text, filename)),
      outcome: { filename, mediaType, handling: "text" },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);

    console.warn(`[Content Agent] Attachment "${filename}" could not be read: ${reason}`);

    return {
      part: attachmentProblem(filename, reason),
      outcome: { filename, mediaType, handling: "dropped", reason },
    };
  }
}

async function handleAttachment(
  file: AttachmentFile,
  attachmentCount: number,
  nativeBudget: NativeBudget
): Promise<HandledAttachment> {
  if (attachmentCount > MAX_ATTACHMENTS_PER_MESSAGE) return overMessageLimit(file);

  // The chat sends an older file without its bytes when the request would grow too large.
  if (!file.url) return droppedEarlier(file);

  const bytes = dataUrlBytes(file.url);

  if (bytes > MAX_ATTACHMENT_BYTES) return tooLarge(file, bytes);

  if (isNativeFileType(file.mediaType)) return nativeAttachment(file, bytes, nativeBudget);

  return textAttachment(file);
}

async function rewriteMessageParts(
  messageParts: Part[],
  nativeBudget: NativeBudget
): Promise<{ parts: Part[]; messageOutcomes: AttachmentOutcome[] }> {
  const parts: Part[] = [];
  const messageOutcomes: AttachmentOutcome[] = [];
  let attachmentCount = 0;

  for (const part of messageParts) {
    if (part.type !== "file") {
      parts.push(part);
      continue;
    }

    const file = part as { type: "file"; mediaType: string; filename?: string; url: string };
    const filename = file.filename || "attachment";
    const mediaType = file.mediaType || "";

    attachmentCount++;
    const handled = await handleAttachment(
      { part, url: file.url, declaredFilename: file.filename, filename, mediaType },
      attachmentCount,
      nativeBudget
    );

    parts.push(handled.part);
    messageOutcomes.push(handled.outcome);
  }

  return { parts, messageOutcomes };
}

export async function normalizeAttachments(messages: UIMessage[]): Promise<NormalizedAttachments> {
  const outcomes: AttachmentOutcome[] = [];

  if (
    !messages.some(
      (message) => message.role === "user" && message.parts?.some((part) => part.type === "file")
    )
  ) {
    return { messages, outcomes };
  }

  const nativeBudget: NativeBudget = { remaining: MAX_NATIVE_ATTACHMENT_BYTES_PER_REQUEST };
  const rewritten = [...messages];

  for (let i = rewritten.length - 1; i >= 0; i--) {
    const message = rewritten[i];

    if (message.role !== "user" || !message.parts?.some((part) => part.type === "file")) continue;

    const { parts, messageOutcomes } = await rewriteMessageParts(message.parts, nativeBudget);

    rewritten[i] = { ...message, parts };
    // Messages are walked newest first.
    // Reversing the flat list instead would also flip the files within a message.
    outcomes.unshift(...messageOutcomes);
  }

  return { messages: rewritten, outcomes };
}

export function describeAttachments(outcomes: AttachmentOutcome[]): string {
  if (!outcomes.length) return "";
  const parts = outcomes.map((outcome) =>
    outcome.handling === "dropped"
      ? `${outcome.filename} (not read: ${outcome.reason})`
      : outcome.filename
  );

  return `[attached: ${parts.join(", ")}]`;
}
