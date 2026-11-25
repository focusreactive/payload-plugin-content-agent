"use client";

import React, { useEffect, useCallback, useState } from "react";
import { History, Loader2, Plus } from "lucide-react";
import { Button } from "./components/primitives.js";
import { ChatHistory } from "./ChatHistory.js";
import { ChatSession } from "./ChatSession.js";
import { InitBanner } from "./InitBanner.js";
import { useReview } from "./ReviewContext.js";
import { useConversationStorageKey } from "./routes.js";
import { backgroundRunning, mountedSessions } from "./sessionRegistry.js";
import type { MountedSession } from "./sessionRegistry.js";
import type { PageContext } from "./useChatSession.js";
import { randomUuid } from "./randomUuid.js";

function getPersistedConversationId(storageKey: string): { id: string; isExisting: boolean } {
  try {
    const saved = sessionStorage.getItem(storageKey);

    if (saved) return { id: saved, isExisting: true };
  } catch {}

  const id = randomUuid();

  try {
    sessionStorage.setItem(storageKey, id);
  } catch {}

  return { id, isExisting: false };
}

function persistConversationId(storageKey: string, id: string) {
  try {
    sessionStorage.setItem(storageKey, id);
  } catch {}
}

function useConversations() {
  const storageKey = useConversationStorageKey();
  const [current, setCurrent] = useState(() => {
    const persisted = getPersistedConversationId(storageKey);

    return { id: persisted.id, isExisting: persisted.isExisting };
  });
  const { id: conversationId, isExisting } = current;
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<MountedSession[]>(() => [
    { id: conversationId, isExisting },
  ]);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const handleRunningChange = useCallback((id: string, isRunning: boolean) => {
    setRunning((prev) => (Boolean(prev[id]) === isRunning ? prev : { ...prev, [id]: isRunning }));
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setSessions((prev) => {
      const next = mountedSessions(prev, { id: conversationId, isExisting }, running);

      return next.length === prev.length && next.every((session, i) => session.id === prev[i].id)
        ? prev
        : next;
    });
  }, [conversationId, isExisting, running]);
  const inBackground = backgroundRunning(sessions, conversationId, running);

  const { setConversation } = useReview();

  useEffect(() => {
    setConversation(conversationId);
  }, [conversationId, setConversation]);

  const handleNewChat = useCallback(() => {
    const newId = randomUuid();

    persistConversationId(storageKey, newId);
    setCurrent({ id: newId, isExisting: false });
    setShowHistory(false);
  }, [storageKey]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      persistConversationId(storageKey, id);
      setCurrent({ id, isExisting: true });
      setShowHistory(false);
    },
    [storageKey]
  );

  return {
    conversationId,
    showHistory,
    setShowHistory,
    sessions,
    running,
    handleRunningChange,
    inBackground,
    handleNewChat,
    handleSelectConversation,
  };
}

function contextLabelOf(pageContext?: PageContext): string | null {
  return pageContext?.global
    ? `Global: ${pageContext.global}`
    : pageContext?.documentId
      ? `${pageContext.collection} / ${pageContext.documentId}`
      : pageContext?.collection
        ? `Collection: ${pageContext.collection}`
        : null;
}

interface ChatHeaderProps {
  contextLabel: string | null;
  inBackground: string[];
  showHistory: boolean;
  setShowHistory: React.Dispatch<React.SetStateAction<boolean>>;
  handleNewChat: () => void;
  handleSelectConversation: (id: string) => void;
}

function ChatHeader(props: ChatHeaderProps) {
  const { contextLabel, inBackground, showHistory, setShowHistory } = props;
  const { handleNewChat, handleSelectConversation } = props;

  return (
    <div className="border-ca-border bg-ca-surface flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
      {contextLabel ? (
        <span className="text-2xs text-ca-faint truncate font-medium">{contextLabel}</span>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-1">
        {inBackground.length > 0 && (
          <button
            type="button"
            onClick={() => handleSelectConversation(inBackground[0])}
            title="A previous chat is still working. Click to go back to it."
            className="bg-ca-accent/10 text-2xs text-ca-accent hover:bg-ca-accent/15 flex cursor-pointer items-center gap-1 rounded border-0 px-1.5 py-0.5 font-semibold"
          >
            <Loader2 className="size-3 animate-spin" aria-hidden />
            {inBackground.length === 1
              ? "Working in background"
              : `${inBackground.length} working in background`}
          </button>
        )}
        <Button variant="outline" size="sm" onClick={handleNewChat} title="New chat">
          <Plus />
          New
        </Button>
        <Button
          variant={showHistory ? "default" : "outline"}
          size="sm"
          onClick={() => setShowHistory((shown) => !shown)}
          title="Chat history"
        >
          <History />
          History
        </Button>
      </div>
    </div>
  );
}

export function ContentAgentChat({ pageContext }: { pageContext?: PageContext }) {
  const conversations = useConversations();
  const { conversationId, showHistory, setShowHistory, sessions, running } = conversations;
  const { handleRunningChange, handleNewChat, handleSelectConversation } = conversations;

  const contextLabel = contextLabelOf(pageContext);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ChatHeader
        contextLabel={contextLabel}
        inBackground={conversations.inBackground}
        showHistory={showHistory}
        setShowHistory={setShowHistory}
        handleNewChat={handleNewChat}
        handleSelectConversation={handleSelectConversation}
      />

      <InitBanner />

      {showHistory && (
        <ChatHistory
          onSelect={handleSelectConversation}
          onNewChat={handleNewChat}
          onClose={() => setShowHistory(false)}
          currentConversationId={conversationId}
          runningIds={Object.keys(running).filter((id) => running[id])}
        />
      )}
      {/* A hidden session stays mounted, not unmounted, so its stream and transcript survive. */}
      {sessions.map((session) => {
        const visible = session.id === conversationId && !showHistory;

        return (
          <div key={session.id} style={{ display: visible ? "contents" : "none" }}>
            <ChatSession
              conversationId={session.id}
              pageContext={pageContext}
              isExisting={session.isExisting}
              active={session.id === conversationId}
              onRunningChange={handleRunningChange}
            />
          </div>
        );
      })}
    </div>
  );
}
