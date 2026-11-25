import { describe, it, expect, vi, afterEach } from "vitest";
import type { UIMessage } from "ai";
import {
  HOST_REFUSAL_MESSAGE,
  IMAGE_MAX_SIDE,
  MAX_FILES,
  MAX_REQUEST_FILE_BYTES,
  fetchWithHostRefusal,
  fitFiles,
  fittedSize,
  refusalNote,
  shrinkImage,
  withinFileBudget,
} from "../src/ui/lib/attachmentFit.js";

const MB = 1024 * 1024;

const sized = (name: string, size: number) => ({ name, size });

const inlineFile = (filename: string, bytes: number) => ({
  type: "file",
  mediaType: "image/png",
  filename,
  url: `data:image/png;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`,
});

const message = (id: string, role: "user" | "assistant", parts: any[]): UIMessage =>
  ({ id, role, parts }) as UIMessage;

const urlsOf = (messages: UIMessage[]) =>
  messages.flatMap((m) => m.parts).flatMap((part: any) => (part.type === "file" ? [part.url] : []));

afterEach(() => vi.unstubAllGlobals());

describe("fittedSize", () => {
  it("scales the long side down and keeps the proportion", () => {
    expect(fittedSize(4096, 1024)).toEqual({ width: IMAGE_MAX_SIDE, height: 512 });
    expect(fittedSize(1000, 5000)).toEqual({ width: 410, height: IMAGE_MAX_SIDE });
  });

  it("never scales a small picture up", () => {
    expect(fittedSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("fitFiles", () => {
  it("refuses the files that would take the request over the body budget", () => {
    const { accepted, refused } = fitFiles(
      [sized("a.png", MB)],
      [sized("b.png", MB), sized("big.pdf", 2 * MB), sized("c.png", 0.5 * MB)]
    );

    expect(accepted.map((f) => f.name)).toEqual(["b.png", "c.png"]);
    expect(refused.map((f) => f.name)).toEqual(["big.pdf"]);
  });

  it("refuses the files over the count of one message", () => {
    const incoming = Array.from({ length: MAX_FILES + 2 }, (_, i) => sized(`${i}.txt`, 10));
    const { accepted, refused } = fitFiles([], incoming);

    expect(accepted).toHaveLength(MAX_FILES);
    expect(refused).toHaveLength(2);
  });

  it("keeps base64 of a full budget under a 4.5 MB body, with the text of a long conversation", () => {
    expect(Math.ceil((MAX_REQUEST_FILE_BYTES * 4) / 3) + 300_000).toBeLessThan(4.5 * 1000 * 1000);
  });
});

describe("refusalNote", () => {
  it("names each refused file with its size, and both limits", () => {
    const note = refusalNote([sized("big.pdf", 4.2 * MB)]);

    expect(note).toContain("big.pdf (4.2 MB)");
    expect(note).toContain(`${MAX_FILES} files`);
    expect(note).toContain("3.0 MB");
  });

  it("is empty when every file fits", () => {
    expect(refusalNote([])).toBe("");
  });
});

describe("withinFileBudget", () => {
  it("keeps the newest files and sends the older ones without their bytes", () => {
    const messages = [
      message("1", "user", [{ type: "text", text: "first" }, inlineFile("old.png", 2 * MB)]),
      message("2", "assistant", [{ type: "text", text: "reply" }]),
      message("3", "user", [inlineFile("new.png", 2 * MB)]),
    ];
    const sent = withinFileBudget(messages);
    const [oldUrl, newUrl] = urlsOf(sent);

    expect(oldUrl).toBe("");
    expect(newUrl).toMatch(/^data:image\/png/u);
    expect((sent[0].parts[1] as any).filename).toBe("old.png");
  });

  it("does not change the messages that the chat shows", () => {
    const messages = [
      message("1", "user", [inlineFile("old.png", 2 * MB)]),
      message("2", "user", [inlineFile("new.png", 2 * MB)]),
    ];
    const before = urlsOf(messages);

    withinFileBudget(messages);
    expect(urlsOf(messages)).toEqual(before);
  });

  it("returns the same parts when everything fits", () => {
    const messages = [message("1", "user", [inlineFile("a.png", MB), inlineFile("b.png", MB)])];

    expect(urlsOf(withinFileBudget(messages))).toEqual(urlsOf(messages));
  });

  it("holds the whole request under the budget over a long conversation", () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      message(String(i), "user", [inlineFile(`${i}.png`, MB)])
    );
    const kept = urlsOf(withinFileBudget(messages)).filter(Boolean);

    expect(kept).toHaveLength(3);
    expect(JSON.stringify(withinFileBudget(messages)).length).toBeLessThan(4.5 * 1000 * 1000);
  });
});

describe("shrinkImage", () => {
  it("leaves a file that is not a picture, and a small picture, as they are", async () => {
    const pdf = new File([new Uint8Array(2 * MB)], "a.pdf", { type: "application/pdf" });
    const small = new File([new Uint8Array(1000)], "a.png", { type: "image/png" });

    expect(await shrinkImage(pdf)).toBe(pdf);
    expect(await shrinkImage(small)).toBe(small);
  });

  it("keeps the original when the browser cannot decode the picture", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("cannot decode");
    });
    const broken = new File([new Uint8Array(MB)], "a.png", { type: "image/png" });

    expect(await shrinkImage(broken)).toBe(broken);
  });

  it("draws a large picture at the fitted size and returns the smaller JPEG", async () => {
    const drawn: number[][] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: "",
        fillRect: () => undefined,
        drawImage: (_: unknown, ...box: number[]) => drawn.push(box),
      }),
      toBlob: (done: (blob: Blob) => void, type: string) =>
        done(new Blob([new Uint8Array(1000)], { type })),
    };

    vi.stubGlobal("createImageBitmap", async () => ({
      width: 4096,
      height: 2048,
      close: () => undefined,
    }));
    vi.stubGlobal("document", { createElement: () => canvas });

    const large = new File([new Uint8Array(2 * MB)], "chart.final.png", { type: "image/png" });
    const result = await shrinkImage(large);

    expect(drawn).toEqual([[0, 0, IMAGE_MAX_SIDE, 1024]]);
    expect(result.name).toBe("chart.final.jpg");
    expect(result.type).toBe("image/jpeg");
    expect(result.size).toBe(1000);
  });
});

describe("fetchWithHostRefusal", () => {
  it("turns the 413 page of a host into an answer that the chat can show", async () => {
    vi.stubGlobal("fetch", async () => new Response("Request Entity Too Large", { status: 413 }));
    const res = await fetchWithHostRefusal("/chat");

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: HOST_REFUSAL_MESSAGE });
  });

  it("passes the 413 of the endpoint and every other answer through", async () => {
    const own = Response.json({ error: "too large, by the endpoint" }, { status: 413 });
    const ok = new Response("stream", { status: 200 });

    vi.stubGlobal("fetch", async () => own);
    expect(await fetchWithHostRefusal("/chat")).toBe(own);
    vi.stubGlobal("fetch", async () => ok);
    expect(await fetchWithHostRefusal("/chat")).toBe(ok);
  });
});
