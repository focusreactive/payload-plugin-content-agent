import { defineConfig } from "oxlint";

export const ignorePatterns = [
  "**/.next/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/importMap.js",
  "src/ui/generatedStyles.ts",
  "lab/.state/**",
  "evals/results/**",
  "evals/baselines/**",
];

export default defineConfig({
  plugins: [],
  categories: { correctness: "off" },
  jsPlugins: ["@stylistic/eslint-plugin"],
  ignorePatterns,
  rules: {
    "@stylistic/padding-line-between-statements": [
      "error",
      { blankLine: "always", prev: "*", next: "return" },
      { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
      { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
      { blankLine: "always", prev: "*", next: "block-like" },
      { blankLine: "always", prev: "block-like", next: "*" },
    ],
  },
});
