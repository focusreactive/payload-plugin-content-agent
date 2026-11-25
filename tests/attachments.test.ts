import { describe, it, expect, vi, afterEach } from "vitest";
import type { UIMessage } from "ai";
import {
  describeAttachments,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_NATIVE_ATTACHMENT_BYTES_PER_REQUEST,
  normalizeAttachments,
} from "../src/agent/attachments.js";

const dataUrl = (mediaType: string, body: string) =>
  `data:${mediaType};base64,${Buffer.from(body, "utf-8").toString("base64")}`;

const sizedDataUrl = (mediaType: string, bytes: number) =>
  `data:${mediaType};base64,${Buffer.alloc(bytes, 0x41).toString("base64")}`;

const userMessage = (parts: any[]): UIMessage => ({ id: "m1", role: "user", parts }) as UIMessage;

const file = (mediaType: string, filename: string, url: string) => ({
  type: "file",
  mediaType,
  filename,
  url,
});

const textOf = (result: Awaited<ReturnType<typeof normalizeAttachments>>) =>
  result.messages
    .flatMap((m) => m.parts ?? [])
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join("\n");

afterEach(() => vi.restoreAllMocks());

describe("normalizeAttachments", () => {
  it("tells the agent about a file that the chat sent without its bytes", async () => {
    const result = await normalizeAttachments([
      userMessage([{ type: "text", text: "look" }, file("image/png", "old.png", "")]),
    ]);

    expect(textOf(result)).toContain('filename="old.png" status="unavailable"');
    expect(textOf(result)).toContain("attached earlier");
    expect(result.messages[0].parts.some((p: any) => p.type === "file")).toBe(false);
    expect(result.outcomes).toEqual([
      {
        filename: "old.png",
        mediaType: "image/png",
        handling: "dropped",
        reason: "request budget",
      },
    ]);
  });

  it("returns the transcript untouched when nothing is attached", async () => {
    const messages = [userMessage([{ type: "text", text: "hi" }])];
    const result = await normalizeAttachments(messages);

    expect(result.messages).toBe(messages);
    expect(result.outcomes).toEqual([]);
  });

  it("forwards images and PDFs untouched: both providers read them natively", async () => {
    const image = file("image/png", "shot.png", sizedDataUrl("image/png", 1000));
    const pdf = file("application/pdf", "brief.pdf", sizedDataUrl("application/pdf", 1000));
    const result = await normalizeAttachments([userMessage([image, pdf])]);

    expect(result.messages[0].parts).toEqual([image, pdf]);
    expect(result.outcomes.map((o) => o.handling)).toEqual(["native", "native"]);
  });

  it("converts text-ish files to text parts, since OpenAI throws on a text/plain file part", async () => {
    const result = await normalizeAttachments([
      userMessage([
        file("text/markdown", "brief.md", dataUrl("text/markdown", "# Brief\nship it")),
      ]),
    ]);

    expect(result.messages[0].parts.every((p: any) => p.type === "text")).toBe(true);
    const text = textOf(result);

    expect(text).toContain('filename="brief.md"');
    expect(text).toContain("ship it");
    expect(result.outcomes[0].handling).toBe("text");
  });

  it("decodes non-ASCII text correctly", async () => {
    const body = "# Бриф\nЗаголовок должен быть на русском — ключевое слово «CMS».";
    const result = await normalizeAttachments([
      userMessage([file("text/markdown", "бриф.md", dataUrl("text/markdown", body))]),
    ]);

    expect(textOf(result)).toContain("Заголовок должен быть на русском");
  });

  it("falls back to the extension when the browser reports no media type", async () => {
    const result = await normalizeAttachments([
      userMessage([
        file(
          "application/octet-stream",
          "notes.csv",
          dataUrl("application/octet-stream", "a,b\n1,2")
        ),
      ]),
    ]);

    expect(textOf(result)).toContain("a,b");
    expect(result.outcomes[0].handling).toBe("text");
  });

  it("explains an unreadable file type instead of throwing", async () => {
    const result = await normalizeAttachments([
      userMessage([
        file(
          "application/x-7z-compressed",
          "archive.7z",
          sizedDataUrl("application/x-7z-compressed", 50)
        ),
      ]),
    ]);

    expect(result.messages[0].parts.every((p: any) => p.type === "text")).toBe(true);
    expect(textOf(result)).toContain('status="unavailable"');
    expect(result.outcomes[0]).toMatchObject({ handling: "dropped", reason: "unsupported type" });
  });

  it("rejects a file over the per-file byte cap without decoding it", async () => {
    const result = await normalizeAttachments([
      userMessage([
        file(
          "application/pdf",
          "huge.pdf",
          sizedDataUrl("application/pdf", MAX_ATTACHMENT_BYTES + 1024)
        ),
      ]),
    ]);

    expect(result.outcomes[0]).toMatchObject({ handling: "dropped", reason: "too large" });
    expect(textOf(result)).toContain("over the");
  });

  it("caps extracted text and says so, rather than silently truncating", async () => {
    const long = "x".repeat(MAX_EXTRACTED_TEXT_CHARS + 5000);
    const result = await normalizeAttachments([
      userMessage([file("text/plain", "big.txt", dataUrl("text/plain", long))]),
    ]);
    const text = textOf(result);

    expect(text).toContain("[truncated:");
    expect(text).toContain("big.txt");
    expect(text.length).toBeLessThan(long.length);
  });

  it("drops attachments past the per-message limit", async () => {
    const parts = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 2 }, (_, i) =>
      file("image/png", `s${i}.png`, sizedDataUrl("image/png", 100))
    );
    const result = await normalizeAttachments([userMessage(parts)]);

    expect(result.outcomes.filter((o) => o.handling === "native")).toHaveLength(
      MAX_ATTACHMENTS_PER_MESSAGE
    );
    expect(result.outcomes.filter((o) => o.reason === "per-message limit")).toHaveLength(2);
  });

  it("keeps the NEWEST attachments when the request-wide budget is exceeded", async () => {
    // `big` stays under the per-file cap, or that check fires first and the budget is never exercised.
    const big = MAX_ATTACHMENT_BYTES - 512;

    expect(big * 3).toBeGreaterThan(MAX_NATIVE_ATTACHMENT_BYTES_PER_REQUEST);
    const messages = [
      {
        id: "old",
        role: "user",
        parts: [file("image/png", "old.png", sizedDataUrl("image/png", big))],
      },
      {
        id: "mid",
        role: "user",
        parts: [file("image/png", "mid.png", sizedDataUrl("image/png", big))],
      },
      {
        id: "new",
        role: "user",
        parts: [file("image/png", "new.png", sizedDataUrl("image/png", big))],
      },
    ] as UIMessage[];
    const result = await normalizeAttachments(messages);
    const kept = result.outcomes.filter((o) => o.handling === "native").map((o) => o.filename);
    const dropped = result.outcomes
      .filter((o) => o.reason === "request budget")
      .map((o) => o.filename);

    expect(kept).toContain("new.png");
    expect(dropped).toContain("old.png");
    expect(kept).not.toContain("old.png");
  });

  it("does not charge a hosted URL against the inline budget", async () => {
    const messages = Array.from({ length: 4 }, (_, i) => ({
      id: `m${i}`,
      role: "user",
      parts: [
        {
          type: "file",
          mediaType: "image/png",
          filename: `remote${i}.png`,
          url: "https://cdn.test/a.png",
        },
      ],
    })) as UIMessage[];
    const result = await normalizeAttachments(messages);

    expect(result.outcomes.every((o) => o.handling === "native")).toBe(true);
  });

  it("reports a missing optional extractor as a readable reason, not a crash", async () => {
    const result = await normalizeAttachments([
      userMessage([
        file(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "spec.docx",
          sizedDataUrl("application/octet-stream", 100)
        ),
      ]),
    ]);

    expect(result.outcomes[0].handling).toBe("dropped");
    expect(textOf(result)).toContain('status="unavailable"');
  });

  it("names the source of an xlsx version in range, which npm does not have", async () => {
    const result = await normalizeAttachments([
      userMessage([
        file(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "prices.xlsx",
          sizedDataUrl("application/octet-stream", 100)
        ),
      ]),
    ]);

    expect(result.outcomes[0].handling).toBe("dropped");
    expect(textOf(result)).toContain("https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz");
    expect(textOf(result)).not.toContain("`npm i xlsx`");
  });

  it("reads a workbook only as far as the cap of the extracted text", async () => {
    const { workbookText } = await import("../src/agent/attachments.js");
    const reads: any[] = [];
    const converted: string[] = [];
    const library = {
      read: (_buffer: Buffer, options: any) => {
        reads.push(options);

        return { SheetNames: ["a", "b", "c"], Sheets: { a: "a", b: "b", c: "c" } };
      },
      utils: {
        sheet_to_csv: (sheet: string) => {
          converted.push(sheet);

          return "x".repeat(MAX_EXTRACTED_TEXT_CHARS);
        },
      },
    };

    workbookText(library, Buffer.from(""));

    expect(reads[0].sheetRows).toBe(MAX_EXTRACTED_TEXT_CHARS);
    expect(converted).toEqual(["a"]);
  });

  it("flags a file with no extractable text instead of sending an empty attachment", async () => {
    const result = await normalizeAttachments([
      userMessage([file("text/plain", "empty.txt", dataUrl("text/plain", "   "))]),
    ]);

    expect(result.outcomes[0]).toMatchObject({ handling: "dropped", reason: "no text" });
  });

  it("reports outcomes in the order the user attached them, across messages", async () => {
    const messages = [
      userMessage([file("image/png", "first.png", sizedDataUrl("image/png", 100))]),
      {
        id: "m2",
        role: "user",
        parts: [
          file("image/png", "second.png", sizedDataUrl("image/png", 100)),
          file("image/png", "third.png", sizedDataUrl("image/png", 100)),
        ],
      },
    ] as UIMessage[];
    const result = await normalizeAttachments(messages);

    expect(result.outcomes.map((o) => o.filename)).toEqual([
      "first.png",
      "second.png",
      "third.png",
    ]);
  });

  it("leaves assistant messages alone", async () => {
    const messages = [
      {
        id: "a",
        role: "assistant",
        parts: [file("image/png", "generated.png", sizedDataUrl("image/png", 100))],
      },
    ] as UIMessage[];
    const result = await normalizeAttachments(messages);

    expect(result.messages).toBe(messages);
    expect(result.outcomes).toEqual([]);
  });
});

describe("describeAttachments", () => {
  it("is empty when nothing was attached, so no marker is written", () => {
    expect(describeAttachments([])).toBe("");
  });

  it("names the files and says which were not read", () => {
    const marker = describeAttachments([
      { filename: "brief.pdf", mediaType: "application/pdf", handling: "native" },
      {
        filename: "huge.zip",
        mediaType: "application/zip",
        handling: "dropped",
        reason: "unsupported type",
      },
    ]);

    expect(marker).toBe("[attached: brief.pdf, huge.zip (not read: unsupported type)]");
  });
});
