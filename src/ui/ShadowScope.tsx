"use client";

import React from "react";
import { createPortal } from "react-dom";
import { PLUGIN_STYLES } from "./generatedStyles.js";

// Theming does not use `:host-context()`: Firefox does not implement it. The host admin's theme
// is read in JS and mirrored onto the wrapper as a `.dark` class.

// The scope element itself, from its ref: without constructable stylesheets the shadow root's
// first child is the style tag, and a portal there renders nothing.
const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext);
}

let sharedSheet: CSSStyleSheet | null = null;

function getSharedSheet(): CSSStyleSheet | null {
  if (typeof CSSStyleSheet === "undefined") return null;

  try {
    if (!sharedSheet) {
      sharedSheet = new CSSStyleSheet();
      sharedSheet.replaceSync(PLUGIN_STYLES);
    }

    return sharedSheet;
  } catch {
    return null;
  }
}

export function propertyRules(css: string): string[] {
  return css.match(/@property\s+--[\w-]+\s*\{[^}]*\}/gu) ?? [];
}

// Browsers ignore `@property` inside a shadow root,
// so the rules are registered once on the document.
function registerPropertiesOnDocument(): void {
  if (typeof document === "undefined" || document.head.querySelector("style[data-ca-properties]"))
    return;
  const rules = propertyRules(PLUGIN_STYLES);

  if (!rules.length) return;
  const tag = document.createElement("style");

  tag.setAttribute("data-ca-properties", "");
  tag.textContent = rules.join("\n");
  document.head.append(tag);
}

function readHostTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const declared = document.documentElement.getAttribute("data-theme");

  if (declared === "dark" || declared === "light") return declared;

  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ShadowScope({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [root, setRoot] = React.useState<ShadowRoot | null>(null);
  const [scope, setScope] = React.useState<HTMLDivElement | null>(null);
  const [theme, setTheme] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const host = hostRef.current;

    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });

    registerPropertiesOnDocument();
    const sheet = getSharedSheet();

    if (sheet) {
      if (!shadow.adoptedStyleSheets.includes(sheet)) {
        shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
      }
    } else if (!shadow.querySelector("style[data-ca-styles]")) {
      const tag = document.createElement("style");

      tag.setAttribute("data-ca-styles", "");
      tag.textContent = PLUGIN_STYLES;
      shadow.append(tag);
    }

    setRoot(shadow);
  }, []);

  React.useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setTheme(readHostTheme());
    const observer = new MutationObserver(() => setTheme(readHostTheme()));

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    const media =
      typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    const onMedia = () => setTheme(readHostTheme());

    media?.addEventListener("change", onMedia);

    return () => {
      observer.disconnect();
      media?.removeEventListener("change", onMedia);
    };
  }, []);

  return (
    <div ref={hostRef} style={{ display: "contents" }}>
      {root
        ? createPortal(
            <PortalContainerContext.Provider value={scope}>
              <div
                ref={setScope}
                className={`ca-scope ${theme === "dark" ? "dark" : ""} ${className ?? ""}`}
              >
                {children}
              </div>
            </PortalContainerContext.Provider>,
            root
          )
        : null}
    </div>
  );
}
