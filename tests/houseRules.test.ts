// House rules: facts about the repo, each checked by code so a breaking change fails `npm run validate`.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSync } from "vite";
import { buildSystemPrompt } from "../src/agent/systemPrompt.js";
import { createTools } from "../src/agent/tools/index.js";
import type { SchemaContext } from "../src/types.js";
import { PAID_TERMS } from "./paidTerms.js";
import { pluginOptions } from "./harness.js";

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const schema: SchemaContext = {
  globals: [
    {
      slug: "site-settings",
      fields: [{ name: "siteName", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
    },
  ],
  collections: [
    {
      slug: "posts",
      fields: [{ name: "title", type: "text" }],
      hasVersions: true,
      hasDrafts: true,
      hasAuth: false,
      timestamps: true,
    },
  ],
  locales: ["en", "es"],
  defaultLocale: "en",
} as SchemaContext;

const options = pluginOptions();

describe("house rule: the system prompt names only tools that exist", () => {
  for (const withMemory of [true, false]) {
    it(`every \`tool(\` in the prompt is a registered tool (memory ${withMemory ? "on" : "off"})`, () => {
      const memory = withMemory
        ? ({ pendingBulk: undefined, changesets: { record: async () => {} } } as any)
        : undefined;
      const tools: Record<string, any> = createTools(
        {},
        schema,
        options,
        withMemory ? { memory, conversationId: "c", userId: "u" } : {}
      );
      const { stable, volatile } = buildSystemPrompt({
        schemaContext: schema,
        schemaPromptMode: "auto",
        memoryEnabled: withMemory,
      });
      const named = [...`${stable}\n${volatile}`.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)\(/gu)].map(
        (m) => m[1]
      );

      expect(named.length).toBeGreaterThan(5);
      const unknown = [...new Set(named)].filter((name) => !(name in tools));

      expect(unknown).toEqual([]);
    });
  }
});

function optionsInTypes(): string[] {
  const source = readFileSync(root("src/types.ts"), "utf-8");
  const start = source.indexOf("export interface ContentAgentPluginOptions {");

  expect(start).toBeGreaterThan(-1);
  const names: string[] = [];
  let depth = 0;
  let inBlockComment = false;

  for (const line of source.slice(start).split("\n")) {
    const text = line.trim();

    if (inBlockComment) {
      if (text.includes("*/")) inBlockComment = false;
      continue;
    }

    if (text.startsWith("/*")) {
      if (!text.includes("*/")) inBlockComment = true;
      continue;
    }

    if (text.startsWith("//")) continue;

    if (depth === 1) {
      const member = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\??:/u);

      if (member) names.push(member[1]);
    }

    depth += (text.match(/[{([]/gu) ?? []).length - (text.match(/[})\]]/gu) ?? []).length;
    if (depth === 0 && names.length) break;
  }

  return names.sort();
}

function optionsInDocs(): string[] {
  const docs = readFileSync(root("DOCS.md"), "utf-8");
  const section = docs.slice(
    docs.indexOf("\n## Options"),
    docs.indexOf("\n## ", docs.indexOf("\n## Options") + 1)
  );
  const names = new Set<string>();
  let inOptionTable = false;

  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) inOptionTable = false;
    else if (/^\|\s*Option\s*\|/u.test(line)) inOptionTable = true;
    else if (inOptionTable) {
      const cell = line.split("|")[1]?.match(/`([^`]+)`/u)?.[1];

      if (cell) names.add(cell.split(".")[0].replace(/\?$/u, ""));
    }
  }

  return [...names].sort();
}

describe("house rule: the options in DOCS.md are the options in the code", () => {
  it("lists the same top-level options", () => {
    const inTypes = optionsInTypes();

    expect(inTypes.length).toBeGreaterThan(10);
    expect(optionsInDocs()).toEqual(inTypes);
  });
});

describe("house rule: the lab, the evals and the repo docs name no module feature", () => {
  const SKIP = new Set(["node_modules", ".next", ".state", "results"]);
  const walk = (path: string): string[] =>
    !existsSync(path)
      ? []
      : statSync(path).isDirectory()
        ? readdirSync(path)
            .filter((name) => !SKIP.has(name))
            .flatMap((name) => walk(`${path}/${name}`))
        : /\.(mjs|ts|tsx|md|yml|json)$/u.test(path) && !path.endsWith("package-lock.json")
          ? [path]
          : [];

  it("finds no paid term", () => {
    const files = [
      "lab",
      "evals",
      "scripts/lib",
      ".github",
      "scripts/telemetryReport.mjs",
      "scripts/checkDist.mjs",
      "AGENTS.md",
    ]
      .flatMap((p) => walk(root(p)))
      .filter((file) => !file.startsWith(root("evals/modules/")));

    expect(files.length).toBeGreaterThan(10);
    const offending = files.flatMap((file) =>
      readFileSync(file, "utf-8")
        .split("\n")
        .flatMap((line, i) =>
          PAID_TERMS.test(line)
            ? [`${file.slice(root("").length)}:${i + 1}: ${line.trim().slice(0, 120)}`]
            : []
        )
    );

    expect(offending).toEqual([]);
  });
});

describe("house rule: a development host keeps full telemetry", () => {
  it("runs the lab host with telemetry full", () => {
    const config = readFileSync(root("lab/src/payload.config.ts"), "utf-8");

    expect(config).toMatch(/telemetry: "full"/u);
  });
});

describe("house rule: code and comments in src stay within 100 characters", () => {
  const LIMIT = 100;
  const LITERAL_TYPES = new Set(["TemplateLiteral", "JSXText"]);

  type Span = [start: number, end: number];

  const sourceFiles = (path: string): string[] =>
    statSync(path).isDirectory()
      ? readdirSync(path).flatMap((name) => sourceFiles(`${path}/${name}`))
      : /\.tsx?$/u.test(path) && !path.endsWith("generatedStyles.ts")
        ? [path]
        : [];

  const isLiteral = (node: Record<string, unknown>) =>
    LITERAL_TYPES.has(String(node.type)) ||
    (node.type === "Literal" && (typeof node.value === "string" || "regex" in node));

  const literalSpans = (node: unknown, spans: Span[] = []): Span[] => {
    if (Array.isArray(node)) {
      for (const child of node) literalSpans(child, spans);
    } else if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;

      if (isLiteral(record)) spans.push([Number(record.start), Number(record.end)]);
      else for (const child of Object.values(record)) literalSpans(child, spans);
    }

    return spans;
  };

  const longLines = (file: string): string[] => {
    const source = readFileSync(file, "utf-8");
    const spans = literalSpans(parseSync(file, source).program);
    const found: string[] = [];
    let lineStart = 0;

    for (const [index, line] of source.split("\n").entries()) {
      const lineEnd = lineStart + line.length;
      const inLiterals = spans.reduce(
        (sum, [start, end]) =>
          sum + Math.max(0, Math.min(end, lineEnd) - Math.max(start, lineStart)),
        0
      );

      if (line.length - inLiterals > LIMIT) {
        found.push(`${file.slice(root("").length)}:${index + 1}`);
      }

      lineStart = lineEnd + 1;
    }

    return found;
  };

  it("counts a line without its string, template, regex and JSX text literals", () => {
    const files = sourceFiles(root("src"));

    expect(files.length).toBeGreaterThan(100);
    expect(files.flatMap(longLines)).toEqual([]);
  });
});
