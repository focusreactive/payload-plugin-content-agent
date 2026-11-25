"use client";

import React, { createContext, use, useEffect, useMemo, useSyncExternalStore } from "react";
import { useFormModified, useRouteCache } from "@payloadcms/ui";
import { useReview } from "./ReviewContext.js";
import { keyOf } from "./reviewUtils.js";
import type { PageContext } from "./useChatSession.js";

/** `null`: the page shows no document form that reports its state. */
type Modified = boolean | null;

interface Store<Value> {
  get: () => Value;
  set: (next: Value) => void;
  subscribe: (listener: () => void) => () => void;
}

function createStore<Value>(initial: Value): Store<Value> {
  let current = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => current,
    set: (next) => {
      if (next === current) return;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
}

const newFormStore = () => createStore<Modified>(null);
const DETACHED = newFormStore();
const Context = createContext<Store<Modified>>(DETACHED);

export function OpenFormProvider({ children }: { children: React.ReactNode }) {
  const store = useMemo(() => newFormStore(), []);

  return <Context value={store}>{children}</Context>;
}

/** Whether the document form on the page holds edits the person did not save. */
export function useOpenFormModified(): Modified {
  const store = use(Context);

  return useSyncExternalStore(store.subscribe, store.get, () => null);
}

/** Sits inside the document form of the admin: tells the chat when it has unsaved edits. */
export function DocumentFormBridge(): null {
  const store = use(Context);
  const modified = useFormModified();

  useEffect(() => {
    store.set(modified);

    return () => store.set(null);
  }, [modified, store]);

  return null;
}

export type OpenDocumentState = "stale" | "unsaved" | null;

/** What the chat says about the open form: `version` counts the writes to its document. */
export function openDocumentState(
  version: number,
  shown: number,
  formModified: Modified
): OpenDocumentState {
  if (version <= shown || formModified === false) return null;

  return formModified ? "unsaved" : "stale";
}

const NO_VERSIONS: Record<string, number> = {};

/**
 * After a write to the open document, the form of the admin still shows the old values. A form
 * with no unsaved edits is loaded again. `unsaved`: the form holds edits of the person, so the
 * person decides. `stale`: the page does not report the state of its form.
 */
export function useOpenDocumentRefresh(pageContext: PageContext | undefined): OpenDocumentState {
  const formModified = useOpenFormModified();
  const { clearRouteCache } = useRouteCache();
  const { editVersions } = useReview();
  const key =
    pageContext?.collection && pageContext.documentId
      ? keyOf({ collection: pageContext.collection, id: pageContext.documentId })
      : "";
  const version = editVersions[key] ?? 0;
  const shownStore = useMemo(() => createStore(NO_VERSIONS), []);
  const shown =
    useSyncExternalStore(shownStore.subscribe, shownStore.get, shownStore.get)[key] ?? 0;

  useEffect(() => {
    if (version <= shown || formModified !== false) return;
    clearRouteCache();
    shownStore.set({ ...shownStore.get(), [key]: version });
  }, [key, version, shown, shownStore, formModified, clearRouteCache]);

  return openDocumentState(version, shown, formModified);
}
