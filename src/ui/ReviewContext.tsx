"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useApiRoute } from "./routes.js";
import { isRecord, isText, recordsOf, stringOf } from "./lib/narrow.js";
import { keyOf, dedupMerge, extractEditedRefs } from "./reviewUtils.js";
import type { EditedRef } from "./reviewUtils.js";
import { summaryOf } from "./components/reviewSummary.js";
import type { ReviewSummaryData } from "./components/reviewSummary.js";

export { type EditedRef, extractEditedRefs };

interface ReviewContextValue {
  refs: EditedRef[];
  /** The broad view of the changes, built by the server. `null` until it is loaded. */
  summary: ReviewSummaryData | null;
  register: (refs: EditedRef[]) => void;
  setConversation: (id: string | null) => void;
  refresh: () => void;
  editVersions: Record<string, number>;
  /** Documents whose changes of this conversation were discarded. */
  discardedKeys: Set<string>;
  conversationId: string | null;
  open: boolean;
  setOpen: (value: boolean) => void;
}

const ReviewContext = createContext<ReviewContextValue | null>(null);

interface ServerRef extends EditedRef {
  updatedAt?: string;
  discarded: boolean;
}

function serverRefsOf(data: unknown): ServerRef[] | null {
  if (!isRecord(data) || !Array.isArray(data.refs)) return null;

  return recordsOf(data.refs).flatMap((ref) =>
    typeof ref.collection === "string" && isText(ref.id)
      ? [
          {
            collection: ref.collection,
            id: ref.id,
            updatedAt: stringOf(ref.updatedAt),
            discarded: ref.op === "discarded",
          },
        ]
      : []
  );
}

const withoutUpdatedAt = ({ collection, id }: ServerRef): EditedRef => ({ collection, id });

// A document has one stored change per written locale: it is discarded when all of them are.
function discardedKeysOf(serverRefs: ServerRef[]): Set<string> {
  const standing = new Set(serverRefs.filter((ref) => !ref.discarded).map(keyOf));

  return new Set(
    serverRefs
      .filter((ref) => ref.discarded)
      .map(keyOf)
      .filter((key) => !standing.has(key))
  );
}

interface ServerView {
  summary: ReviewSummaryData | null;
  discardedKeys: Set<string>;
}

const NO_SERVER_VIEW: ServerView = { summary: null, discardedKeys: new Set() };

const serverViewOf = (data: unknown, serverRefs: ServerRef[]): ServerView => ({
  summary: summaryOf(data),
  discardedKeys: discardedKeysOf(serverRefs),
});

function advancedKeys(lastSeen: Record<string, string>, serverRefs: ServerRef[]): string[] {
  const advanced: string[] = [];

  for (const ref of serverRefs) {
    if (!ref.collection || ref.id == null || !ref.updatedAt) continue;
    const key = keyOf(ref);

    if ((lastSeen[key] ?? "") < ref.updatedAt) {
      lastSeen[key] = ref.updatedAt;
      advanced.push(key);
    }
  }

  return advanced;
}

function bumpVersions(prev: Record<string, number>, advanced: string[]) {
  const next = { ...prev };

  for (const key of advanced) next[key] = (next[key] ?? 0) + 1;

  return next;
}

const fetchChanges = async (apiRoute: string, conversationId: string): Promise<unknown> => {
  const response = await fetch(
    `${apiRoute}/content-agent/changes?conversationId=${encodeURIComponent(conversationId)}`
  );

  return response.ok ? response.json() : { refs: [] };
};

function useLatest<Value>(value: Value) {
  const ref = React.useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

export function ReviewProvider({ children }: { children: React.ReactNode }) {
  const apiRoute = useApiRoute();
  const [refs, setRefs] = useState<EditedRef[]>([]);
  const [serverView, setServerView] = useState<ServerView>(NO_SERVER_VIEW);
  const [editVersions, setEditVersions] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useLatest(conversationId);

  // Edit versions are bumped only when a doc's server `updated_at` advances, never from `register`:
  // it fires on every streamed message, and a bump there loops setState and render.
  const lastSeenUpdatedAt = React.useRef<Record<string, string>>({});
  const bumpFromServer = useCallback((serverRefs: ServerRef[]) => {
    const advanced = advancedKeys(lastSeenUpdatedAt.current, serverRefs);

    if (!advanced.length) return;
    setEditVersions((prev) => bumpVersions(prev, advanced));
  }, []);

  const register = useCallback((incoming: EditedRef[]) => {
    if (!incoming.length) return;
    setRefs((prev) => dedupMerge(prev, incoming));
  }, []);

  const setConversation = useCallback((id: string | null) => {
    setConversationId((prev) => (prev === id ? prev : id));
  }, []);

  useEffect(() => {
    let cancelled = false;

    // oxlint-disable-next-line react/set-state-in-effect
    setRefs([]);
    setServerView(NO_SERVER_VIEW);
    setEditVersions({});
    lastSeenUpdatedAt.current = {};
    if (!conversationId) return;

    const load = async () => {
      try {
        const data = await fetchChanges(apiRoute, conversationId);
        const serverRefs = serverRefsOf(data);

        if (cancelled || !serverRefs) return;
        setServerView(serverViewOf(data, serverRefs));
        const persisted = serverRefs.map(withoutUpdatedAt);

        setRefs((prev) => dedupMerge(persisted, prev));

        for (const ref of serverRefs) {
          if (ref.collection && ref.updatedAt)
            lastSeenUpdatedAt.current[keyOf(ref)] = ref.updatedAt;
        }
      } catch {}
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [conversationId, apiRoute]);

  const refresh = useCallback(() => {
    if (!conversationId) return;
    const requestedFor = conversationId;

    const load = async () => {
      try {
        const data = await fetchChanges(apiRoute, requestedFor);

        if (conversationIdRef.current !== requestedFor) return;
        const serverRefs = serverRefsOf(data);

        if (!serverRefs) return;
        setServerView(serverViewOf(data, serverRefs));
        setRefs((prev) => dedupMerge(prev, serverRefs.map(withoutUpdatedAt)));
        bumpFromServer(serverRefs);
      } catch {}
    };

    void load();
  }, [conversationId, conversationIdRef, apiRoute, bumpFromServer]);

  const value = useMemo(
    () => ({
      refs,
      ...serverView,
      register,
      setConversation,
      refresh,
      editVersions,
      conversationId,
      open,
      setOpen,
    }),
    [refs, serverView, register, setConversation, refresh, editVersions, conversationId, open]
  );

  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

export function useReview(): ReviewContextValue {
  const ctx = useContext(ReviewContext);

  if (!ctx) throw new Error("useReview must be used within a ReviewProvider");

  return ctx;
}
