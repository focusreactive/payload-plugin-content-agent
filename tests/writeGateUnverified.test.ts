import { describe, expect, it, vi } from "vitest";
import { createTurnApprovals, decideApproval } from "../src/agent/approvals.js";
import type { DocumentIO } from "../src/agent/content/documentIo.js";
import { destructiveUpdateApproval, gatedMcpWrite } from "../src/agent/tools/mcp/writeGate.js";
import type { WriteTarget } from "../src/agent/tools/mcp/writeGate.js";
import type { SchemaContext } from "../src/types.js";

const schema: SchemaContext = {
  collections: [
    {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "slug", type: "text", readOnly: true },
      ],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
    {
      slug: "users",
      fields: [{ name: "role", type: "select", options: ["editor", "admin"] }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: true,
      timestamps: true,
    },
  ],
  globals: [],
};

const target = (slug: string): WriteTarget => ({
  name: "updateDocument",
  lower: "update",
  writeSlug: slug,
  writeGlobalSlug: undefined,
});
const opts: any = { toolCallId: "call-1", messages: [] };

/** A site whose read of the current document fails. */
function failingRead() {
  const io = {
    transports: () => ({ read: "local", write: "local", create: "local" }),
    read: vi.fn(async () => ({ doc: null, error: "pooler hiccup" })),
    write: vi.fn(async (_target: unknown, { patch }: any) => ({ doc: { id: 1, ...patch } })),
    create: vi.fn(),
    list: vi.fn(),
    lockRefusal: vi.fn(async () => null),
  } as unknown as DocumentIO & { write: ReturnType<typeof vi.fn> };
  const approvals = createTurnApprovals();
  const context = { schema, documentIo: () => io, recordEdits: () => {}, approvals };

  return { io, context, approvals };
}

describe("an update whose read of the current document fails", () => {
  it("is refused when it writes a read-only field", async () => {
    const { io, context } = failingRead();
    const res: any = await gatedMcpWrite(context, target("posts"), { id: 1, slug: "new" }, opts);

    expect(res.error).toMatch(/read-only/u);
    expect(io.write).not.toHaveBeenCalled();
  });

  it("asks the person before it changes an account", async () => {
    const { io, context, approvals } = failingRead();

    approvals.policies.set("updateDocument", destructiveUpdateApproval(context, target("users")));
    const asked = await decideApproval(approvals, {
      toolName: "updateDocument",
      toolCallId: "call-1",
      input: { id: 3, role: "admin" },
    });
    const res: any = await gatedMcpWrite(
      context,
      target("users"),
      { id: 3, role: "admin" },
      { ...opts, toolCallId: "call-2" }
    );

    expect(asked?.type).toBe("user-approval");
    expect(res.writeStatus).toBe("needs-confirmation");
    expect(io.write).not.toHaveBeenCalled();
  });

  it("still writes a plain scalar change of a field with no risk", async () => {
    const { io, context } = failingRead();
    const res: any = await gatedMcpWrite(context, target("posts"), { id: 1, title: "New" }, opts);

    expect(res.error).toBeUndefined();
    expect(io.write).toHaveBeenCalledTimes(1);
  });
});
