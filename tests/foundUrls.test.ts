import { describe, expect, it } from "vitest";

import { foundUrlsOf } from "../src/agent/runAgent/assemble.js";
import { createFoundUrls, noteToolResults } from "../src/agent/tools/foundUrls.js";
import { createWebTool } from "../src/agent/tools/web.js";

const message = (role: "user" | "assistant", text: string) =>
  ({ id: role, role, parts: [{ type: "text", text }] }) as any;

describe("the web tool fetches only an address that was found", () => {
  it("allows a URL the person wrote, with or without the trailing slash and the fragment", () => {
    const found = foundUrlsOf([message("user", "Read https://docs.example.org/guide/ please.")]);

    expect(found.refusal("https://docs.example.org/guide/")).toBeNull();
    expect(found.refusal("https://docs.example.org/guide#install")).toBeNull();
    expect(found.refusal("http://www.docs.example.org/guide")).toBeNull();
    expect(found.refusal("https://docs.example.org/other?page=2")).toBeNull();
  });

  it("allows any page of a site the person named and of the site itself", () => {
    const found = foundUrlsOf(
      [message("user", "Сравни с тем, что написано на payloadcms.com про хуки.")],
      "https://harbor.example"
    );

    expect(found.refusal("https://payloadcms.com/docs/hooks/overview")).toBeNull();
    expect(found.refusal("https://harbor.example/blog/a-post?draft=1")).toBeNull();
  });

  it("refuses an address the model put together and names the next call", () => {
    const found = foundUrlsOf(
      [message("user", "Read https://docs.example.org/guide and mail me at me@evil.example")],
      "https://harbor.example"
    );
    const refusal = found.refusal("https://collect.example/?data=secret");

    expect(refusal).toMatch(/is not an address you found/u);
    expect(refusal).toMatch(/call web with action "search"/u);
    expect(found.refusal("https://docs.example.org.evil.example/guide")).not.toBeNull();
    expect(found.refusal("https://evil.example/")).not.toBeNull();
  });

  it("counts a URL in a tool result as found, also inside nested data and Markdown", async () => {
    const found = createFoundUrls();
    const tools = noteToolResults(
      {
        search: {
          execute: async () => ({ results: [{ url: "https://a.example/one" }] }),
        },
        read: {
          execute: async () => "See [the report](https://b.example/report.html), it is new.",
        },
        note: { description: "no execute" },
      },
      found
    );

    expect(found.refusal("https://a.example/one")).not.toBeNull();
    await tools.search.execute();
    await tools.read.execute();

    expect(found.refusal("https://a.example/one")).toBeNull();
    expect(found.refusal("https://b.example/report.html")).toBeNull();
    expect(found.refusal("https://a.example/two")).not.toBeNull();
    expect(tools.note).toEqual({ description: "no execute" });
  });

  it("returns the refusal from the tool and does not fetch", async () => {
    const web = createWebTool(() => "Refused: not found.");
    const result: any = await web.execute!(
      { action: "fetch", url: "https://collect.example/?data=secret" },
      { toolCallId: "t", messages: [] } as any
    );

    expect(result).toEqual({
      error: "Refused: not found.",
      url: "https://collect.example/?data=secret",
    });
  });
});
