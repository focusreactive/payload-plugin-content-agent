import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { approvalReason, parseApprovalRequest } from "../src/approvalRequest.js";

vi.mock("@payloadcms/ui", () => ({
  useConfig: () => ({
    config: {
      routes: { admin: "/admin" },
      collections: [{ slug: "notes", labels: { plural: "Field notes" } }],
      globals: [{ slug: "shop", label: "Shop settings" }],
    },
  }),
}));
const { ApprovalCard, ApprovalProvider } = await import("../src/ui/components/approvalCard.js");

const render = (requestReason: string, state = "approval-requested") =>
  renderToStaticMarkup(
    React.createElement(
      ApprovalProvider,
      { value: () => undefined },
      React.createElement(ApprovalCard, {
        part: {
          type: "tool-editContent",
          toolCallId: "t",
          state,
          input: {},
          approval: { id: "a", requestReason, approved: false },
        } as any,
      })
    )
  );

const documents = [{ id: 4, title: "First note" }, { id: 9 }];

describe("the request the chat shows before a run", () => {
  it("asks about an edit of many documents with the label of the collection", () => {
    const html = render(
      approvalReason({
        kind: "edit",
        collection: "notes",
        count: 16,
        documents,
        instruction: "Add a closing line.",
      })
    );

    expect(html).toContain("Edit 16 documents in Field notes?");
    expect(html).toContain("Add a closing line.");
    expect(html).toContain("First note");
    expect(html).toContain("Document 9");
    expect(html).toContain('href="/admin/collections/notes/4"');
    expect(html).toContain("and 14 more");
    expect(html).toContain("Nothing is published.");
    expect(html).toContain(">Edit 16 documents<");
  });

  it("shows both texts of a replacement, and says when the text is removed", () => {
    const html = render(
      approvalReason({
        kind: "replace",
        collection: "notes",
        count: 6,
        documents: [],
        find: "2025",
        replace: "",
      })
    );

    expect(html).toContain("Replace this text in 6 documents in Field notes?");
    expect(html).toContain("2025");
    expect(html).toContain("nothing: the text is removed");
    expect(html).toContain(">Replace in 6 documents<");
  });

  it("names both languages of a translation", () => {
    const html = render(
      approvalReason({
        kind: "translate",
        collection: "notes",
        count: 7,
        documents,
        from: "en",
        to: "es",
      })
    );

    expect(html).toContain("Translate 7 documents in Field notes?");
    expect(html).toContain(">en<");
    expect(html).toContain(">es<");
  });

  it("lists what an update removes and offers to keep the content", () => {
    const html = render(
      approvalReason({
        kind: "risky-update",
        global: "shop",
        effects: ['"Tagline" has a value now. The update empties it.'],
      })
    );

    expect(html).toContain("This update removes content from Shop settings. Save it?");
    expect(html).toContain("The update empties it.");
    expect(html).toContain(">Save the update<");
    expect(html).toContain(">Keep the content<");
  });

  it("asks before one more document than a request changes by itself", () => {
    const html = render(
      approvalReason({
        kind: "more-documents",
        changed: 5,
        collection: "notes",
        document: { id: 9, title: "Sixth note" },
      })
    );

    expect(html).toContain("The agent already worked on 5 documents for this request.");
    expect(html).toContain("Change one more, in &quot;Sixth note&quot;?");
    expect(html).toContain(">Change it<");
    expect(html).toContain(">Stop here<");
    expect(html).toContain("The change is saved as a draft. Nothing is published.");
    expect(html).toContain('href="/admin/collections/notes/9"');
    expect(parseApprovalRequest('{"kind":"more-documents","collection":"notes"}')).toBeNull();
  });

  it("says after a decline what stays changed, and nothing false", () => {
    const more = approvalReason({ kind: "more-documents", changed: 5, collection: "notes" });
    const run = approvalReason({
      kind: "edit",
      collection: "notes",
      count: 7,
      documents,
      instruction: "x",
    });

    expect(render(more, "output-denied")).toContain("this document was not changed");
    expect(render(more, "output-denied")).not.toContain("nothing was changed");
    expect(render(run, "output-denied")).toContain("Cancelled - nothing was changed");
  });

  it("shows a reason that is plain text as it is", () => {
    const html = render("Send 40 emails");

    expect(html).toContain("Confirm before the agent goes on");
    expect(html).toContain("Send 40 emails");
  });
});

describe("parseApprovalRequest", () => {
  it("reads only a request of a known kind", () => {
    expect(parseApprovalRequest(undefined)).toBeNull();
    expect(parseApprovalRequest("{not json")).toBeNull();
    expect(parseApprovalRequest('{"kind":"other"}')).toBeNull();
    expect(parseApprovalRequest('{"kind":"edit","count":2}')).toBeNull();
    expect(parseApprovalRequest('{"kind":"risky-update","effects":[]}')).toEqual({
      kind: "risky-update",
      effects: [],
    });
  });
});
