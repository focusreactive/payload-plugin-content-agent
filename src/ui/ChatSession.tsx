"use client";

import React, { useEffect, useState } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { Bot, Loader2, RefreshCw, ArrowRight } from "lucide-react";
import { ChatMessage } from "./ChatMessage.js";
import { ChatInput } from "./ChatInput.js";
import { Button } from "./components/primitives.js";
import { useReview } from "./ReviewContext.js";
import { standingRefs } from "./reviewUtils.js";
import { useAdminRoute, useApiRoute, useChatPath } from "./routes.js";
import { useChatRatingEnabled } from "./routes.js";
import { ChatRating } from "./ChatRating.js";
import { ApprovalProvider } from "./components/approvalCard.js";
import { useOpenDocumentRefresh } from "./openForm.js";
import { isTurnLive, showsThinking } from "./turnStatus.js";
import {
  fetchMessages,
  useReviewSync,
  useSessionChat,
  useStickToBottom,
} from "./useChatSession.js";
import type { SessionProps } from "./useChatSession.js";

const PENDING_REPLY: UIMessage = { id: "pending-reply", role: "assistant", parts: [] };

function friendlyErrorMessage(message: string): string {
  try {
    const parsed = JSON.parse(message);

    if (parsed && typeof parsed.error === "string") return parsed.error;
  } catch {}

  return message;
}

function EmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="bg-ca-fg text-ca-bg flex size-16 items-center justify-center rounded-2xl">
        <Bot className="size-8" />
      </div>
      <div>
        <div className="text-ca-fg text-base font-bold">Content Agent</div>
        <p className="text-ca-muted mx-auto mt-1 max-w-65 text-xs leading-relaxed">
          Ask me about your content. I can search, create, and update documents - always as drafts.
          I remember our past conversations.
        </p>
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-1.5">
        {[
          "Show me all drafts",
          "What collections do we have?",
          "Create a new document",
          "What did we do last time?",
        ].map((suggestion) => (
          <button
            type="button"
            key={suggestion}
            onClick={() => onSuggestion(suggestion)}
            className="border-ca-border bg-ca-surface text-2xs text-ca-muted hover:bg-ca-border hover:text-ca-fg cursor-pointer rounded-full border px-2.5 py-1 transition-colors"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

interface MessageListProps {
  messages: UIMessage[];
  status: string;
  thinking: boolean;
  error: Error | undefined;
  onSuggestion: (text: string) => void;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  handleMessagesScroll: () => void;
}

function MessageList(props: MessageListProps) {
  const { messages, status, thinking, error, messagesContainerRef, messagesEndRef } = props;
  const { handleMessagesScroll } = props;
  const lastMessage = messages[messages.length - 1];

  return (
    <div
      ref={messagesContainerRef}
      onScroll={handleMessagesScroll}
      className="min-h-0 flex-1 overflow-y-auto p-4.5"
    >
      {messages.length === 0 ? (
        <EmptyState onSuggestion={props.onSuggestion} />
      ) : (
        messages.map((msg, idx) => {
          const isLast = idx === messages.length - 1;

          return (
            <ChatMessage
              key={msg.id}
              message={msg}
              live={isTurnLive(isLast, status)}
              thinking={thinking && isLast && msg.role === "assistant"}
            />
          );
        })
      )}
      {thinking && lastMessage?.role !== "assistant" && (
        <ChatMessage key={PENDING_REPLY.id} message={PENDING_REPLY} live thinking />
      )}
      {error && (
        <div className="border-ca-danger/30 bg-ca-danger/10 text-ca-danger mx-auto my-2 max-w-90 rounded-xl border px-3.5 py-2.5 text-xs">
          {(error.message && friendlyErrorMessage(error.message)) || "Something went wrong."}
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

function ChatSessionInner(props: SessionProps & { savedMessages: UIMessage[] }) {
  const { conversationId, pageContext, active } = props;
  const apiRoute = useApiRoute();
  const chatPath = useChatPath();
  const chatRatingEnabled = useChatRatingEnabled();
  const [draft, setDraft] = useState("");
  const { messages, stop, status, error, isLoading, handleSend, answerApproval } = useSessionChat(
    props,
    { apiRoute, chatPath }
  );
  const lastMessage = messages[messages.length - 1];
  const thinking = showsThinking(lastMessage, status);
  const { messagesEndRef, messagesContainerRef, handleMessagesScroll } = useStickToBottom(
    messages,
    active
  );

  const openDocument = useOpenDocumentRefresh(pageContext);

  const adminRoute = useAdminRoute();

  const { register, refs, setOpen, refresh, discardedKeys } = useReview();
  const toReview = standingRefs(refs, discardedKeys).length;

  useReviewSync({ messages, status, active, register, refresh });

  return (
    <>
      {toReview > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border-ca-accent/25 bg-ca-accent/10 text-ca-accent hover:bg-ca-accent/15 flex w-full shrink-0 cursor-pointer items-center justify-between gap-2 border-0 border-b px-3 py-2 text-xs font-semibold"
        >
          <span>
            Review {toReview} change{toReview > 1 ? "s" : ""} - preview diffs &amp; publish
          </span>
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
      )}

      {openDocument && (
        <a
          href={`${adminRoute}/collections/${pageContext!.collection}/${pageContext!.documentId}`}
          className="border-ca-accent/25 bg-ca-accent/10 text-ca-accent flex shrink-0 cursor-pointer items-center justify-between gap-2 border-b px-3 py-2 text-xs no-underline"
        >
          <span>
            {openDocument === "unsaved"
              ? "Draft updated. The form has unsaved edits - a reload discards them"
              : "Draft updated - click to reload document"}
          </span>
          <RefreshCw className="size-3.5" />
        </a>
      )}

      <ApprovalProvider value={answerApproval}>
        <MessageList
          messages={messages}
          status={status}
          thinking={thinking}
          error={error}
          onSuggestion={setDraft}
          messagesContainerRef={messagesContainerRef}
          messagesEndRef={messagesEndRef}
          handleMessagesScroll={handleMessagesScroll}
        />
      </ApprovalProvider>
      {chatRatingEnabled && (
        <ChatRating
          conversationId={conversationId}
          hasReply={status === "ready" && messages.some((message) => message.role === "assistant")}
        />
      )}
      <ChatInput
        onSend={handleSend}
        onStop={stop}
        isLoading={isLoading}
        value={draft}
        onChange={setDraft}
      />
    </>
  );
}

export function ChatSession({
  conversationId,
  pageContext,
  isExisting,
  active,
  onRunningChange,
}: SessionProps & { isExisting?: boolean }) {
  const apiRoute = useApiRoute();
  const [loaded, setLoaded] = useState<UIMessage[] | null>(isExisting ? null : []);
  const [loadError, setLoadError] = useState<string | null>(null);

  // A retry clears the error, and that runs the load again.
  useEffect(() => {
    if (!isExisting || loadError) return;
    let cancelled = false;

    const load = async () => {
      try {
        const msgs = await fetchMessages(conversationId, apiRoute);

        if (!cancelled) setLoaded(msgs);
      } catch (err) {
        if (!cancelled)
          setLoadError(
            err instanceof Error ? err.message : "The conversation could not be loaded."
          );
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [conversationId, isExisting, apiRoute, loadError]);

  if (loaded === null && loadError) {
    return (
      <div className="text-ca-muted flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-xs">
        <span>{loadError} The messages are not lost.</span>
        <Button variant="outline" size="sm" onClick={() => setLoadError(null)}>
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      </div>
    );
  }

  if (loaded === null) {
    return (
      <div className="text-ca-muted flex flex-1 items-center justify-center gap-2 text-xs">
        <Loader2 className="size-4 animate-spin" />
        Loading conversation...
      </div>
    );
  }

  // The key forces useChat to re-init with the loaded initial messages.
  return (
    <ChatSessionInner
      key={conversationId + ":" + loaded.length}
      conversationId={conversationId}
      pageContext={pageContext}
      savedMessages={loaded}
      active={active}
      onRunningChange={onRunningChange}
    />
  );
}
