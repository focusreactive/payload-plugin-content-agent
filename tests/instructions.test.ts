import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildInstructionsGlobal,
  buildInstructionsNote,
  buildSubAgentInstructionsNote,
  describeInjectedInstructions,
  INSTRUCTIONS_GLOBAL_SLUG,
  INSTRUCTION_SCOPES,
  loadInstructions,
  MAX_INSTRUCTION_CHARS,
  MAX_INSTRUCTIONS_TOTAL_CHARS,
} from "../src/agent/instructions.js";
import type { AgentInstruction } from "../src/types.js";
import { contentAgentPlugin } from "../src/plugin.js";

const brandVoice: AgentInstruction = {
  label: "Brand voice",
  scope: "writing",
  instruction: "Write in second person. Never use exclamation marks.",
};

const fakePayload = (instructions: any, opts: { throws?: boolean } = {}): any => ({
  findGlobal: vi.fn(async () => {
    if (opts.throws) throw new Error('relation "globals" does not exist');

    return { instructions };
  }),
});

afterEach(() => vi.restoreAllMocks());

describe("buildInstructionsGlobal", () => {
  it("registers a slug that cannot collide with a host global", () => {
    expect(buildInstructionsGlobal(true).slug).toBe(INSTRUCTIONS_GLOBAL_SLUG);
    expect(INSTRUCTIONS_GLOBAL_SLUG).toContain("content-agent");
  });

  it("offers exactly the scopes the code injects, so a scope cannot be picked that goes nowhere", () => {
    const array: any = buildInstructionsGlobal(true).fields[0];
    const scopeField = array.fields.find((f: any) => f.name === "scope");

    expect(scopeField.options.map((o: any) => o.value)).toEqual([...INSTRUCTION_SCOPES]);
  });

  it("caps the instruction field in the admin UI at the same limit the loader enforces", () => {
    const array: any = buildInstructionsGlobal(true).fields[0];
    const field = array.fields.find((f: any) => f.name === "instruction");

    expect(field.maxLength).toBe(MAX_INSTRUCTION_CHARS);
  });

  it("honours slug, admin group, access and versions overrides", () => {
    const access = { update: () => true };
    const global = buildInstructionsGlobal({
      slug: "ai-rules",
      adminGroup: "Settings",
      access,
      versions: false,
    });

    expect(global.slug).toBe("ai-rules");
    expect(global.admin?.group).toBe("Settings");
    expect(global.access).toBe(access);
    expect(global.versions).toBeUndefined();
  });
});

describe("plugin registration", () => {
  const base = { provider: "anthropic" as const, mcpApiKey: "k" };
  const apply = (instructions?: any) =>
    contentAgentPlugin({ ...base, ...(instructions === undefined ? {} : { instructions }) })({
      globals: [],
    } as any) as any;

  it("registers the global only when asked", () => {
    expect(apply(true).globals?.map((g: any) => g.slug)).toEqual([INSTRUCTIONS_GLOBAL_SLUG]);
    expect(apply(undefined).globals).toEqual([]);
    expect(apply(false).globals).toEqual([]);
  });

  it("registers NOTHING when the host provides its own source", () => {
    expect(apply({ source: async () => [] }).globals).toEqual([]);
  });

  it("keeps globals the host already had", () => {
    const config: any = { globals: [{ slug: "site-settings", fields: [] }] };
    const result: any = contentAgentPlugin({ ...base, instructions: true })(config);

    expect(result.globals?.map((g: any) => g.slug)).toEqual([
      "site-settings",
      INSTRUCTIONS_GLOBAL_SLUG,
    ]);
  });
});

const big = (label: string) => ({
  label,
  scope: "always",
  instruction: "x".repeat(MAX_INSTRUCTION_CHARS + 500),
});

describe("loadInstructions", () => {
  it("returns nothing when the option is off, without touching the database", async () => {
    const payload = fakePayload([brandVoice]);

    expect(await loadInstructions(payload, undefined)).toEqual([]);
    expect(await loadInstructions(payload, false)).toEqual([]);
    expect(payload.findGlobal).not.toHaveBeenCalled();
  });

  it("reads the global when enabled", async () => {
    const payload = fakePayload([brandVoice]);

    expect(await loadInstructions(payload, true)).toEqual([brandVoice]);
    expect(payload.findGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ slug: INSTRUCTIONS_GLOBAL_SLUG })
    );
  });

  it("uses a host-provided source instead of the global, and reads no global at all", async () => {
    const payload = fakePayload([{ ...brandVoice, label: "from global" }]);
    const result = await loadInstructions(payload, {
      source: async () => [{ label: "from host", scope: "writing", instruction: "Host rule." }],
    });

    expect(result[0].label).toBe("from host");
    expect(payload.findGlobal).not.toHaveBeenCalled();
  });

  it("never throws when the global cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await loadInstructions(fakePayload(null, { throws: true }), true)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("continuing without them"));
    warn.mockRestore();
  });

  it("drops disabled, blank and malformed blocks", async () => {
    const result = await loadInstructions(
      fakePayload([
        { ...brandVoice, enabled: false },
        { label: "Blank", scope: "writing", instruction: "   " },
        { label: "No text", scope: "writing" },
        null,
        brandVoice,
      ]),
      true
    );

    expect(result).toEqual([brandVoice]);
  });

  it("falls back to `always` for an unknown scope rather than silently discarding the rule", async () => {
    const result = await loadInstructions(
      fakePayload([{ label: "Legacy", scope: "seo-stuff", instruction: "Keep titles short." }]),
      true
    );

    expect(result[0].scope).toBe("always");
  });

  it("truncates an over-long block and stops at the total budget, warning about what was skipped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const many = Array.from({ length: 10 }, (_, i) => big(`Block ${i}`));
    const result = await loadInstructions(fakePayload(many), true);
    const total = result.reduce((n, i) => n + i.instruction.length, 0);

    expect(result.every((i) => i.instruction.length <= MAX_INSTRUCTION_CHARS)).toBe(true);
    expect(total).toBeLessThanOrEqual(MAX_INSTRUCTIONS_TOTAL_CHARS);
    expect(result.length).toBeLessThan(many.length);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("were skipped"));
    warn.mockRestore();
  });
});

describe("buildInstructionsNote", () => {
  it("is empty for a scope with no blocks, so nothing is spent where it does not apply", () => {
    expect(buildInstructionsNote([brandVoice], "always")).toBe("");
    expect(buildInstructionsNote([brandVoice], "review")).toBe("");
    expect(buildInstructionsNote([], "writing")).toBe("");
  });

  it("renders only the requested scope, with the label as a heading", () => {
    const note = buildInstructionsNote(
      [brandVoice, { label: "Checklist", scope: "review", instruction: "Every CTA needs a link." }],
      "writing"
    );

    expect(note).toContain("## Brand voice");
    expect(note).toContain("Never use exclamation marks");
    expect(note).not.toContain("Checklist");
  });

  it("states that these instructions cannot widen what the agent may do", () => {
    const note = buildInstructionsNote([brandVoice], "writing");

    expect(note).toContain("cannot widen what you are permitted to do");
    expect(note).toContain("writes follow the drafts and confirmation rules above");
    expect(note).toMatch(/tell the user about the conflict/u);
  });
});

describe("buildSubAgentInstructionsNote", () => {
  const glossary = {
    label: "Glossary",
    scope: "always" as const,
    instruction: "A term: its meaning.",
  };

  it("adds the blocks for every request to the blocks of the sub-agent's own scope", () => {
    const note = buildSubAgentInstructionsNote([glossary, brandVoice], "writing");

    expect(note).toContain("## Glossary");
    expect(note).toContain("## Brand voice");
    expect(note.match(/cannot widen what you are permitted to do/gu)).toHaveLength(1);
  });

  it("leaves the blocks of another scope out", () => {
    const note = buildSubAgentInstructionsNote([glossary, brandVoice], "review");

    expect(note).toContain("## Glossary");
    expect(note).not.toContain("Brand voice");
    expect(buildSubAgentInstructionsNote([brandVoice], "review")).toBe("");
  });
});

describe("describeInjectedInstructions", () => {
  it("names the blocks per scope for the log, and is empty when none apply", () => {
    expect(describeInjectedInstructions([brandVoice], "writing")).toBe("writing: Brand voice");
    expect(describeInjectedInstructions([brandVoice], "review")).toBe("");
  });
});

describe("instruction length bounds", () => {
  it("fits a real editorial brief, not just a rule of thumb", () => {
    expect(MAX_INSTRUCTION_CHARS).toBeGreaterThanOrEqual(16_000);
    expect(MAX_INSTRUCTIONS_TOTAL_CHARS).toBeGreaterThanOrEqual(MAX_INSTRUCTION_CHARS * 2);
  });

  it("still bounds the total: an `always` block rides the cached prefix on every turn", () => {
    expect(MAX_INSTRUCTIONS_TOTAL_CHARS).toBeLessThanOrEqual(60_000);
  });
});
