// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ShadowScope, usePortalContainer } from "../src/ui/ShadowScope.js";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("the portal container of the shadow scope", () => {
  it("is the scope element also when the styles come in a style tag", async () => {
    vi.stubGlobal(
      "CSSStyleSheet",
      class {
        replaceSync() {
          throw new Error("no constructable stylesheets");
        }
      }
    );
    const seen: (HTMLElement | null)[] = [];

    const Probe = () => {
      seen.push(usePortalContainer());

      return null;
    };

    const host = document.createElement("div");

    document.body.append(host);
    await act(async () => {
      createRoot(host).render(React.createElement(ShadowScope, null, React.createElement(Probe)));
    });

    const shadow = host.querySelector("div")!.shadowRoot!;

    expect(shadow.querySelector("style[data-ca-styles]")).not.toBeNull();
    expect(seen.at(-1)?.classList.contains("ca-scope")).toBe(true);
    vi.unstubAllGlobals();
  });
});
