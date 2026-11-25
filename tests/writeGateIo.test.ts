import { describe, expect, it, vi } from "vitest";
import { createTurnApprovals } from "../src/agent/approvals.js";
import type { DocumentIO } from "../src/agent/content/documentIo.js";
import { parseMcpDoc } from "../src/agent/mcpParse.js";
import { gatedMcpWrite } from "../src/agent/tools/mcp/writeGate.js";
import type { WriteTarget } from "../src/agent/tools/mcp/writeGate.js";
import { writeStatusOf } from "../src/agent/writeStatus.js";
import type { EditRecordRef, SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
      ],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
  globals: [
    {
      slug: "site-settings",
      fields: [{ name: "tagline", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
    },
  ],
};

const post = { id: 7, title: "A", tags: [1, 2, 3] };
const settings = { id: 1, tagline: "Old" };
const opts: any = { toolCallId: "call-1", messages: [] };

const postTarget: WriteTarget = {
  name: "updateDocument",
  lower: "update",
  writeSlug: "posts",
  writeGlobalSlug: undefined,
};
const globalTarget: WriteTarget = {
  name: "updateDocument",
  lower: "update",
  writeSlug: undefined,
  writeGlobalSlug: "site-settings",
};

function makeGate(overrides: Partial<DocumentIO> = {}) {
  const io = {
    transports: vi.fn(() => ({ read: "local", write: "local", create: "local" })),
    read: vi.fn(async (target: any) => ({ doc: target.global ? settings : post })),
    write: vi.fn(async (target: any, { patch }: any) => ({
      doc: { ...(target.global ? settings : post), ...patch },
    })),
    create: vi.fn(),
    list: vi.fn(),
    lockRefusal: vi.fn(async () => null),
    ...overrides,
  } as unknown as DocumentIO & { write: ReturnType<typeof vi.fn> };
  const recorded: EditRecordRef[] = [];
  const context = {
    schema,
    documentIo: () => io,
    recordEdits: (refs: EditRecordRef[]) => {
      recorded.push(...refs);
    },
    approvals: createTurnApprovals(),
  };

  return { io, context, recorded };
}

describe("the write gate on a target with no tool of the site", () => {
  it("writes the fields through DocumentIO, without the control keys, and records the change", async () => {
    const { io, context, recorded } = makeGate();
    const res = await gatedMcpWrite(context, postTarget, { id: 7, title: "B", locale: "es" }, opts);

    expect(io.write).toHaveBeenCalledTimes(1);
    expect(io.write).toHaveBeenCalledWith(
      { collection: "posts" },
      { id: 7, patch: { title: "B" }, locale: "es", callId: "gate-write" }
    );
    expect(writeStatusOf(res)).toBe("done");
    expect(parseMcpDoc(res)).toEqual({ ...post, title: "B" });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      collection: "posts",
      id: 7,
      op: "update",
      before: post,
      after: { ...post, title: "B" },
      locale: "es",
      toolName: "updateDocument",
    });
  });

  it("writes a global and records it under the global", async () => {
    const { io, context, recorded } = makeGate();

    await gatedMcpWrite(context, globalTarget, { tagline: "New" }, opts);

    expect(io.write).toHaveBeenCalledWith(
      { global: "site-settings" },
      { id: undefined, patch: { tagline: "New" }, locale: undefined, callId: "gate-write" }
    );
    expect(recorded[0]).toMatchObject({
      collection: "global:site-settings",
      id: "site-settings",
      after: { ...settings, tagline: "New" },
    });
  });

  it("returns the error of the write as a failed write and records nothing", async () => {
    const { context, recorded } = makeGate({
      write: vi.fn(async () => ({ error: "You are not allowed to perform this action." })),
    } as any);
    const res: any = await gatedMcpWrite(context, postTarget, { id: 7, title: "B" }, opts);

    expect(res).toEqual({ error: "You are not allowed to perform this action." });
    expect(writeStatusOf(res)).toBe("failed");
    expect(recorded).toEqual([]);
  });

  it("refuses a destructive update the person did not confirm and writes nothing", async () => {
    const { io, context, recorded } = makeGate();
    const res: any = await gatedMcpWrite(context, postTarget, { id: 7, tags: [] }, opts);

    expect(res.writeStatus).toBe("needs-confirmation");
    expect(io.write).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it("writes nothing when the fields already hold the value", async () => {
    const { io, context } = makeGate();
    const res: any = await gatedMcpWrite(context, postTarget, { id: 7, title: "A" }, opts);

    expect(res.writeStatus).toBe("nothing-changed");
    expect(io.write).not.toHaveBeenCalled();
  });

  it("refuses a document another person has open", async () => {
    const { io, context } = makeGate({
      lockRefusal: vi.fn(async () => "Another person is editing this document."),
    } as any);
    const res: any = await gatedMcpWrite(context, postTarget, { id: 7, title: "B" }, opts);

    expect(res.error).toBe("Another person is editing this document.");
    expect(io.write).not.toHaveBeenCalled();
  });
});

const createTarget = (): WriteTarget => ({
  name: "createPosts",
  lower: "createposts",
  writeSlug: "posts",
  writeGlobalSlug: undefined,
  mcpTool: {
    execute: async () => ({
      content: [{ type: "text", text: JSON.stringify({ id: 9, title: "N" }) }],
    }),
  } as any,
});

describe("the write gate under a tool that records its own change", () => {
  it("records a create that a model called by itself", async () => {
    const { context, recorded } = makeGate();

    await gatedMcpWrite(context, createTarget(), { title: "N" }, opts);

    expect(recorded.map((ref) => ref.toolName)).toEqual(["createPosts"]);
  });

  it.each(["create-document", "clone-create", "import-article"])(
    "leaves the record of a %s write to the tool that made it",
    async (toolCallId) => {
      const { context, recorded } = makeGate();
      const res: any = await gatedMcpWrite(context, createTarget(), { title: "N" }, {
        toolCallId,
        messages: [],
      } as any);

      expect(res.error).toBeUndefined();
      expect(recorded).toEqual([]);
    }
  );
});
