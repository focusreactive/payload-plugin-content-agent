import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  printWidth: 100,
  sortImports: false,
  sortPackageJson: false,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "dist/**",
    "**/importMap.js",
    "src/ui/generatedStyles.ts",
    "lab/.state/**",
    "evals/results/**",
    "evals/baselines/**",
    "tests/fixtures/**",
    "package-lock.json",
    "**/*.md",
    "**/*.mdx",
  ],
});
