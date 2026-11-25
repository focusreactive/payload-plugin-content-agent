"use client";

import { ArrowLeft, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "./components/primitives.js";
import { cn } from "./lib/cn.js";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useApiRoute } from "./routes.js";
import { fetchConversationPage } from "./conversationPage.js";
import type { ConversationItem } from "./conversationPage.js";

interface ChatHistoryProps {
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onClose: () => void;
  currentConversationId: string;
  runningIds?: string[];
}

const NO_RUNNING_IDS: string[] = [];

type ConversationPage = Awaited<ReturnType<typeof fetchConversationPage>>;

/** The first page, again after a failed load when the person asks for it. */
function useFirstPage(
  fetchPage: () => Promise<ConversationPage>,
  onPage: (page: ConversationPage) => void
) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (loadError) return;
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchPage();

        if (cancelled) return;
        onPage(data);
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [fetchPage, onPage, loadError]);

  const retry = useCallback(() => {
    setLoadError(null);
    setLoading(true);
  }, []);

  return { loading, loadError, retry };
}

function useConversationList() {
  const apiRoute = useApiRoute();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(
    (cursor?: string) => fetchConversationPage(apiRoute, cursor),
    [apiRoute]
  );
  const onFirstPage = useCallback((data: ConversationPage) => {
    setConversations(data.conversations || []);
    setNextCursor(data.nextCursor);
    setMemoryEnabled(data.memoryEnabled !== false);
  }, []);
  const { loading, loadError, retry } = useFirstPage(fetchPage, onFirstPage);

  // A ref, not state: a scroll event that fires before the re-render would start a duplicate fetch.
  const loadingRef = useRef(false);

  // Set back to true in the effect body: StrictMode runs the cleanup once right after mount.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);

    try {
      const data = await fetchPage(nextCursor);

      if (!mountedRef.current) return;
      setConversations((prev) => [...prev, ...(data.conversations ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch {
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [nextCursor, fetchPage]);

  useEffect(() => {
    const element = scrollRef.current;

    if (!element) return;

    const onScroll = () => {
      if (element.scrollHeight - element.scrollTop - element.clientHeight < 80) {
        loadMore();
      }
    };

    element.addEventListener("scroll", onScroll, { passive: true });

    return () => element.removeEventListener("scroll", onScroll);
  }, [loadMore]);

  useEffect(() => {
    const element = scrollRef.current;

    if (!element || !nextCursor) return;
    if (element.scrollHeight <= element.clientHeight) loadMore();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [conversations, nextCursor, loadMore]);

  return { conversations, loading, loadingMore, memoryEnabled, scrollRef, loadError, retry };
}

function ConversationRow({
  conv,
  dateStr,
  isActive,
  isRunning,
  onSelect,
}: {
  conv: ConversationItem;
  dateStr: string;
  isActive: boolean;
  isRunning: boolean;
  onSelect: (conversationId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(conv.id)}
      className={cn(
        "block w-full cursor-pointer border-0 border-l-[3px] px-4 py-2.5 text-left transition-colors",
        isActive
          ? "border-l-ca-fg bg-ca-surface"
          : "hover:bg-ca-surface border-l-transparent bg-transparent"
      )}
    >
      <div
        className={cn(
          "text-ca-fg flex items-center gap-1.5 truncate text-sm",
          isActive ? "font-semibold" : "font-normal"
        )}
      >
        {isRunning && (
          <Loader2 className="text-ca-accent size-3 shrink-0 animate-spin" aria-label="working" />
        )}
        <span className="truncate">{conv.title || "Untitled conversation"}</span>
      </div>
      <div className="text-2xs text-ca-faint mt-0.5">{dateStr}</div>
    </button>
  );
}

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ChatHistory({
  onSelect,
  onNewChat,
  onClose,
  currentConversationId,
  runningIds = NO_RUNNING_IDS,
}: ChatHistoryProps) {
  const { conversations, loading, loadingMore, memoryEnabled, scrollRef, loadError, retry } =
    useConversationList();

  if (!memoryEnabled) {
    return (
      <div className="text-ca-faint p-6 text-center text-sm">
        Memory is not configured. Chat history is unavailable.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-ca-border flex shrink-0 items-center justify-between border-b px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft />
          Back
        </Button>
        <Button variant="outline" size="sm" onClick={onNewChat}>
          <Plus />
          New Chat
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="text-ca-faint flex items-center justify-center gap-2 p-6 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading...
          </div>
        ) : loadError ? (
          <div className="text-ca-muted flex flex-col items-center gap-3 p-6 text-center text-sm">
            <span>The conversations could not be loaded: {loadError}.</span>
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw className="size-3.5" />
              Try again
            </Button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-ca-faint p-6 text-center text-sm">
            No conversations yet. Start a new chat!
          </div>
        ) : (
          <>
            {conversations.map((conv) => {
              const isActive = conv.id === currentConversationId;
              const date = new Date(conv.updatedAt);
              const dateStr = formatRelativeDate(date);

              return (
                <ConversationRow
                  key={conv.id}
                  conv={conv}
                  dateStr={dateStr}
                  isActive={isActive}
                  isRunning={runningIds.includes(conv.id)}
                  onSelect={onSelect}
                />
              );
            })}
            {loadingMore && (
              <div className="text-ca-faint flex items-center justify-center gap-2 p-3 text-xs">
                <Loader2 className="size-3.5 animate-spin" />
                Loading more...
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
