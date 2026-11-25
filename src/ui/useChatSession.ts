"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import type { ToolUIPart } from "ai";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "@ai-sdk/react";
import { isRecord, listOf, recordsOf, stringOf } from "./lib/narrow.js";
import { fetchWithHostRefusal, withinFileBudget } from "./lib/attachmentFit.js";
import { extractEditedRefs } from "./ReviewContext.js";
import type { EditedRef } from "./ReviewContext.js";

export interface PageContext {
  collection?: string;
  documentId?: string;
  global?: string;
}

function browserTimeZone(): string | undefined {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

type StoredToolPart = Extract<ToolUIPart, { state: "output-available" }>;

const isStoredToolPart = (part: unknown): part is StoredToolPart =>
  isRecord(part) &&
  typeof part.type === "string" &&
  part.type.startsWith("tool-") &&
  typeof part.toolCallId === "string" &&
  part.state === "output-available";

/** The stored messages of a conversation. A failed load throws: it is not an empty conversation. */
export async function fetchMessages(
  conversationId: string,
  apiRoute: string
): Promise<UIMessage[]> {
  const res = await fetch(`${apiRoute}/content-agent/messages?conversationId=${conversationId}`);

  if (!res.ok) throw new Error(`The conversation could not be loaded (HTTP ${res.status}).`);
  const data: unknown = await res.json();
  const stored = isRecord(data) ? recordsOf(data.messages) : [];

  return stored.flatMap((message) => {
    const { id, role } = message;

    if (typeof id !== "string" || (role !== "user" && role !== "assistant")) return [];

    const text = stringOf(message.content) ?? "";

    return [
      {
        id,
        role,
        parts: [
          ...listOf(message.parts).filter(isStoredToolPart),
          ...(text.trim() ? [{ type: "text" as const, text }] : []),
        ],
        createdAt: new Date(stringOf(message.createdAt) ?? ""),
      },
    ];
  });
}

/** Read by the model with the result of a tool the person did not confirm. */
const DECLINED_REASON =
  "The person declined this in the chat. Nothing was written. Do not call the tool again unless the person asks.";

type AddApprovalResponse = ReturnType<typeof useChat>["addToolApprovalResponse"];

function useApprovalAnswer(addToolApprovalResponse: AddApprovalResponse) {
  return useCallback(
    ({ id, approved }: { id: string; approved: boolean }) => {
      void addToolApprovalResponse({
        id,
        approved,
        ...(approved ? {} : { reason: DECLINED_REASON }),
      });
    },
    [addToolApprovalResponse]
  );
}

export interface SessionProps {
  conversationId: string;
  pageContext?: PageContext;
  active: boolean;
  onRunningChange: (conversationId: string, running: boolean) => void;
}

export function useSessionChat(
  session: SessionProps & { savedMessages: UIMessage[] },
  routes: { apiRoute: string; chatPath: string }
) {
  const { conversationId, pageContext, savedMessages, onRunningChange } = session;
  const { apiRoute, chatPath } = routes;
  const {
    messages: rawMessages,
    sendMessage,
    stop,
    status,
    error,
    addToolApprovalResponse,
  } = useChat({
    id: conversationId,
    // The person's click goes to the server by itself: the agent goes on from the same reply.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    messages: savedMessages.length > 0 ? savedMessages : undefined,
    // useChat reads the transport of the latest render on every send, also on the automatic send
    // after an approval: its body carries the current page context.
    transport: new DefaultChatTransport({
      api: `${apiRoute}${chatPath}`,
      fetch: fetchWithHostRefusal,
      prepareSendMessagesRequest: ({ body, id, messages, trigger, messageId }) => ({
        body: { ...body, id, messages: withinFileBudget(messages), trigger, messageId },
      }),
      body: {
        ...(pageContext ? { pageContext } : {}),
        conversationId,
        timeZone: browserTimeZone(),
      },
    }),
  });

  const messages = useMemo(() => {
    const seen = new Set<string>();

    return (
      rawMessages
        .filter((message) => {
          if (seen.has(message.id)) return false;
          seen.add(message.id);

          return true;
        })
        // Fresh references on every render: @ai-sdk/react mutates tool parts in place
        // (see 'use no memo' in ChatMessage).
        .map((message) => ({ ...message, parts: [...(message.parts ?? [])] }))
    );
  }, [rawMessages]);

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    onRunningChange(conversationId, isLoading);
  }, [conversationId, isLoading, onRunningChange]);
  useEffect(() => () => onRunningChange(conversationId, false), [conversationId, onRunningChange]);

  const handleSend = useCallback(
    (text: string, files?: File[]) => {
      if ((text.trim() || files?.length) && !isLoading) {
        let fileList: FileList | undefined;

        if (files?.length) {
          const transfer = new DataTransfer();

          for (const file of files) transfer.items.add(file);
          fileList = transfer.files;
        }

        sendMessage({ text, ...(fileList ? { files: fileList } : {}) });
      }
    },
    [sendMessage, isLoading]
  );

  const answerApproval = useApprovalAnswer(addToolApprovalResponse);

  return { messages, stop, status, error, isLoading, handleSend, answerApproval };
}

export function useStickToBottom(messages: UIMessage[], active: boolean) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    if (active && isNearBottomRef.current)
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [messages, active]);

  const handleMessagesScroll = useCallback(() => {
    const element = messagesContainerRef.current;

    if (!element) return;
    isNearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
  }, []);

  return { messagesEndRef, messagesContainerRef, handleMessagesScroll };
}

interface ReviewSync {
  messages: UIMessage[];
  status: string;
  active: boolean;
  register: (refs: EditedRef[]) => void;
  refresh: () => void;
}

export function useReviewSync({ messages, status, active, register, refresh }: ReviewSync) {
  useEffect(() => {
    if (!active) return;
    const found: EditedRef[] = [];

    for (const msg of messages) {
      for (const part of msg.parts ?? []) {
        if (part.type === "data-content-ops") found.push(...extractEditedRefs(part.data));
      }
    }

    if (found.length) register(found);
  }, [messages, register, active]);

  const prevStatus = useRef(status);

  useEffect(() => {
    if (active && prevStatus.current !== "ready" && status === "ready") refresh();
    prevStatus.current = status;
  }, [status, refresh, active]);
}
