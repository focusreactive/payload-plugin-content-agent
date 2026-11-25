import { describe, it, expect } from "vitest";
import { PLUGIN_STYLES } from "../src/ui/generatedStyles.js";
import { propertyRules } from "../src/ui/ShadowScope.js";

describe("ShadowScope: @property rules for the document", () => {
  it("finds the rules that borders and shadows depend on in the plugin stylesheet", () => {
    const rules = propertyRules(PLUGIN_STYLES);
    const names = rules.map((r) => r.match(/@property\s+(--[\w-]+)/u)?.[1]);

    expect(names).toEqual(
      expect.arrayContaining(["--tw-border-style", "--tw-shadow", "--tw-ring-shadow"])
    );
    expect(rules.find((r) => r.includes("--tw-border-style"))).toMatch(/initial-value:\s*solid/u);
  });

  it("returns only @property rules, each one complete", () => {
    const css =
      '.a{color:red}@property --tw-x{syntax:"*";inherits:false;initial-value:0}.b{margin:0}@property --tw-y{syntax:"*";inherits:false}';

    expect(propertyRules(css)).toEqual([
      '@property --tw-x{syntax:"*";inherits:false;initial-value:0}',
      '@property --tw-y{syntax:"*";inherits:false}',
    ]);
    expect(propertyRules(".a{color:red}")).toEqual([]);
  });
});

describe("the review diff inside the shadow root", () => {
  it("marks added and removed text with rules of the plugin stylesheet", () => {
    const compact = PLUGIN_STYLES.replace(/\s+/gu, "");

    expect(compact).toMatch(
      /\.html-diff\[data-match-type=("?)create\1\]:not\(img\)\{[^}]*background-color/u
    );
    expect(compact).toMatch(
      /\.html-diff\[data-match-type=("?)delete\1\]:not\(img\)\{[^}]*text-decoration:line-through/u
    );
  });
});
