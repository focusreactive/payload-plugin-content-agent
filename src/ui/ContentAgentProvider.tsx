"use client";

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useAuth, useConfig } from "@payloadcms/ui";
import { Bot } from "lucide-react";
import { ShadowScope } from "./ShadowScope.js";
import { TooltipProvider } from "./components/primitives.js";
import { ContentAgentPanel } from "./ContentAgentPanel.js";
import { ContentAgentChat } from "./ContentAgentChat.js";
import { ReviewProvider } from "./ReviewContext.js";
import { ReviewPanel } from "./ReviewPanel.js";
import { identityKey, useAdminRoute, useConversationStorageKey } from "./routes.js";
import { OpenFormProvider } from "./openForm.js";

// Payload's admin root does not re-render on nested route changes, and `next/navigation` is not a
// dependency, so the pathname is tracked by patching
// history.pushState/replaceState plus `popstate`.
function useCurrentPathname(): string {
  const [pathname, setPathname] = useState(() =>
    typeof window !== "undefined" ? window.location.pathname : ""
  );

  useEffect(() => {
    const update = () => setPathname(window.location.pathname);

    window.addEventListener("popstate", update);
    const origPush = window.history.pushState;
    const origReplace = window.history.replaceState;

    window.history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
      origPush.apply(this, args);
      update();
    };

    window.history.replaceState = function (
      this: History,
      ...args: Parameters<History["replaceState"]>
    ) {
      origReplace.apply(this, args);
      update();
    };

    return () => {
      window.removeEventListener("popstate", update);
      window.history.pushState = origPush;
      window.history.replaceState = origReplace;
    };
  }, []);

  return pathname;
}

function usePageContext() {
  const adminRoute = useAdminRoute();
  const pathname = useCurrentPathname();
  const { config } = useConfig();
  const folders = config?.folders ? config.folders.slug : undefined;
  // The segment after a collection is a document id, except these views of the list.
  const notDocuments = useMemo(
    () => new Set(["create", "trash", ...(folders ? [folders] : [])]),
    [folders]
  );

  return useMemo(() => {
    if (!pathname) return {};
    const esc = adminRoute.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const collectionMatch = pathname.match(
      new RegExp(`${esc}/collections/([^/]+)(?:/([^/]+))?`, "u")
    );

    if (collectionMatch) {
      const segment = collectionMatch[2];
      const docId = segment && !notDocuments.has(segment) ? segment : undefined;

      return { collection: collectionMatch[1], documentId: docId };
    }

    const globalMatch = pathname.match(new RegExp(`${esc}/globals/([^/]+)`, "u"));

    if (globalMatch) return { global: globalMatch[1] };

    return {};
  }, [pathname, adminRoute, notDocuments]);
}

function ContentAgentInner() {
  const [open, setOpen] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const pageContext = usePageContext();
  const storageKey = useConversationStorageKey();

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const handleMinimize = useCallback(() => {
    setOpen(false);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);

    try {
      sessionStorage.removeItem(storageKey);
    } catch {}

    setChatKey((key) => key + 1);
  }, [storageKey]);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={handleOpen}
          title="Open Content Agent"
          style={{ zIndex: 99998 }}
          className="bg-ca-fg text-ca-bg focus-visible:outline-ca-accent fixed right-6 bottom-6 flex size-16 cursor-pointer items-center justify-center rounded-full border-0 shadow-xl transition-transform duration-200 hover:scale-108 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Bot className="size-8" />
        </button>
      )}

      <div style={{ display: open ? "contents" : "none" }}>
        <ContentAgentPanel open={open} onMinimize={handleMinimize} onClose={handleClose}>
          <ContentAgentChat key={chatKey} pageContext={pageContext} />
        </ContentAgentPanel>
      </div>
    </>
  );
}

class AgentErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.warn("[Content Agent] UI failed to mount:", error.message);
  }
  render() {
    if (this.state.hasError) return null;

    return this.props.children;
  }
}

// Gates the whole agent surface and keys it by identity: Payload's logout is a soft navigation that
// does not remount this tree, so nothing else clears the open panels and their state.
function AuthedAgentUI() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <ShadowScope>
      <TooltipProvider>
        <ReviewProvider key={identityKey(user)}>
          <ContentAgentInner />
          <ReviewPanel />
        </ReviewProvider>
      </TooltipProvider>
    </ShadowScope>
  );
}

export function ContentAgentProvider({ children }: { children: React.ReactNode }) {
  return (
    <OpenFormProvider>
      {children}
      <AgentErrorBoundary>
        <AuthedAgentUI />
      </AgentErrorBoundary>
    </OpenFormProvider>
  );
}
