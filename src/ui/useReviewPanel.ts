"use client";

import { isRecord, recordsOf, stringOf } from "./lib/narrow.js";
import React, { useCallback, useEffect, useState } from "react";
import type { EditedRef } from "./ReviewContext.js";

import { keyOf } from "./reviewUtils.js";

export interface DiffState {
  status: "loading" | "loaded" | "error";
  diff?: unknown;
  error?: string;
  scope?: "session" | "published";
}

type SetState<Value> = React.Dispatch<React.SetStateAction<Value>>;

interface Ref<Value> {
  current: Value;
}

interface DiffRequest {
  conversationId: string | null;
  apiRoute: string;
  conversationIdRef: Ref<string | null>;
  setDiffs: SetState<Record<string, DiffState>>;
}

async function fetchDiff(ref: EditedRef, request: DiffRequest) {
  const { conversationId, apiRoute, conversationIdRef, setDiffs } = request;
  const key = keyOf(ref);
  const requestedFor = conversationId;

  setDiffs((current) => ({ ...current, [key]: { status: "loading" } }));

  try {
    const params = new URLSearchParams({ collection: ref.collection, id: String(ref.id) });

    if (requestedFor) params.set("conversationId", requestedFor);
    const res = await fetch(`${apiRoute}/content-agent/diff?${params.toString()}`);
    const data: unknown = await res.json();
    const body = isRecord(data) ? data : {};

    if (conversationIdRef.current !== requestedFor) return;
    if (!res.ok) throw new Error(stringOf(body.error) || `HTTP ${res.status}`);
    const scope = body.scope === "session" || body.scope === "published" ? body.scope : undefined;

    setDiffs((current) => ({
      ...current,
      [key]: { status: "loaded", diff: body.diff, scope },
    }));
  } catch (err) {
    if (conversationIdRef.current !== requestedFor) return;
    setDiffs((current) => ({
      ...current,
      [key]: { status: "error", error: err instanceof Error ? err.message : String(err) },
    }));
  }
}

function takeReedited(seen: Record<string, number>, editVersions: Record<string, number>) {
  const reedited: string[] = [];

  for (const [key, version] of Object.entries(editVersions)) {
    if ((seen[key] ?? 0) < version) reedited.push(key);
    // oxlint-disable-next-line react/immutability
    seen[key] = version;
  }

  return reedited;
}

function withKeys(previous: Set<string>, keys: string[]): Set<string> {
  const next = new Set(previous);

  for (const key of keys) next.add(key);

  return next;
}

function withoutKeys(previous: Set<string>, keys: string[]): Set<string> {
  const next = new Set(previous);

  for (const key of keys) next.delete(key);

  return next;
}

function withoutDiffs(previous: Record<string, DiffState>, keys: string[]) {
  const dropped = new Set(keys);

  return Object.fromEntries(Object.entries(previous).filter(([key]) => !dropped.has(key)));
}

function toggled(previous: Set<string>, key: string): Set<string> {
  const next = new Set(previous);

  if (next.has(key)) next.delete(key);
  else next.add(key);

  return next;
}

interface ExpandRequest {
  expanded: Set<string>;
  diffs: Record<string, DiffState>;
  loadDiff: (ref: EditedRef) => Promise<void>;
  setExpanded: SetState<Set<string>>;
}

function expandRow(ref: EditedRef, { expanded, diffs, loadDiff, setExpanded }: ExpandRequest) {
  const key = keyOf(ref);
  const willExpand = !expanded.has(key);

  setExpanded((previous) => {
    const next = new Set(previous);

    if (willExpand) next.add(key);
    else next.delete(key);

    return next;
  });
  if (willExpand && (!diffs[key] || diffs[key].status === "error")) loadDiff(ref);
}

/** What the footer counts and Publish sends: selected, not published yet and not discarded. */
export function chosenRefs(
  refs: EditedRef[],
  {
    selected,
    publishedKeys,
    discardedKeys,
  }: { selected: Set<string>; publishedKeys: Set<string>; discardedKeys: Set<string> }
): EditedRef[] {
  return refs.filter((ref) => {
    const key = keyOf(ref);

    return selected.has(key) && !publishedKeys.has(key) && !discardedKeys.has(key);
  });
}

interface PublishRun {
  chosen: EditedRef[];
  apiRoute: string;
  conversationId: string | null;
  conversationIdRef: Ref<string | null>;
  seenVersionsRef: Ref<Record<string, number>>;
  setPublishing: SetState<boolean>;
  setPublishMsg: SetState<string>;
  setPublishedKeys: SetState<Set<string>>;
}

interface PublishTally {
  published: number;
  errors: string[];
  versionAtPublish: Map<string, number>;
  requestedFor: string | null;
}

async function publishCollection(
  [collection, ids]: [string, (string | number)[]],
  run: PublishRun,
  tally: PublishTally
) {
  const { apiRoute, conversationIdRef, seenVersionsRef, setPublishedKeys } = run;
  const { errors, versionAtPublish, requestedFor } = tally;

  try {
    const res = await fetch(`${apiRoute}/content-agent/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection, ids }),
    });
    const data: unknown = await res.json();
    const body = isRecord(data) ? data : {};

    if (conversationIdRef.current !== requestedFor) return;
    if (!res.ok) throw new Error(stringOf(body.error) || `HTTP ${res.status}`);

    for (const result of recordsOf(body.results)) {
      if (result.ok) {
        tally.published++;
        const key = `${collection}:${result.id}`;
        const capturedVersion = versionAtPublish.get(key) ?? 0;

        setPublishedKeys((keys) =>
          (seenVersionsRef.current[key] ?? 0) !== capturedVersion ? keys : new Set(keys).add(key)
        );
      } else errors.push(`${collection}/${result.id}: ${result.error}`);
    }
  } catch (err) {
    if (conversationIdRef.current !== requestedFor) return;
    errors.push(`${collection}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function publishSelected(run: PublishRun) {
  const { chosen: toPublish, conversationId, conversationIdRef } = run;
  const { seenVersionsRef, setPublishing, setPublishMsg } = run;

  if (!toPublish.length) return;
  // Every setState after an await is guarded by conversation:
  // the version check alone passes for a stale response,
  // because a conversation switch resets seenVersionsRef.
  const requestedFor = conversationId;

  setPublishing(true);
  setPublishMsg("");
  const versionAtPublish = new Map<string, number>();

  for (const ref of toPublish)
    versionAtPublish.set(keyOf(ref), seenVersionsRef.current[keyOf(ref)] ?? 0);
  const byCollection = new Map<string, (string | number)[]>();

  for (const ref of toPublish)
    byCollection.set(ref.collection, [...(byCollection.get(ref.collection) ?? []), ref.id]);

  const tally: PublishTally = { published: 0, errors: [], versionAtPublish, requestedFor };

  for (const entry of byCollection) await publishCollection(entry, run, tally);
  const { published, errors } = tally;

  if (conversationIdRef.current !== requestedFor) return;
  setPublishing(false);
  setPublishMsg(
    `Published ${published}${errors.length ? ` · ${errors.length} failed: ${errors[0]}` : ""}`
  );
}

export interface DiscardState {
  phase: "idle" | "confirm" | "running";
  message: string;
  failed: boolean;
  /** Documents with fields someone changed after the agent: kept until the person insists. */
  changedSince: EditedRef[];
}

const NO_DISCARD: DiscardState = { phase: "idle", message: "", failed: false, changedSince: [] };

const plural = (count: number) => `${count} document${count === 1 ? "" : "s"}`;

// A change without the state from before the agent cannot be put back: it failed too.
const discardFailed = (result: Record<string, unknown>) =>
  result.status === "failed" || result.status === "no-snapshot";

const failureReason = (result: Record<string, unknown>) =>
  stringOf(result.error) ??
  (result.status === "no-snapshot" ? "the state from before the agent was not kept" : undefined);

const documentCount = (rows: Record<string, unknown>[]) =>
  new Set(rows.map((result) => `${result.collection}:${result.id}`)).size;

/** The line under the panel, and whether it reports a failure. */
export function discardOutcome(
  results: Record<string, unknown>[],
  changedSince: EditedRef[]
): { message: string; failed: boolean } {
  const count = (status: string) =>
    documentCount(results.filter((result) => result.status === status));
  const failures = results.filter(discardFailed);
  const reason = failures.map(failureReason).find(Boolean);
  const parts = [
    count("restored") ? `Discarded in ${plural(count("restored"))}` : "",
    changedSince.length ? `${changedSince.length} changed after the agent, kept` : "",
    count("created") ? `${count("created")} created by the agent, not removed` : "",
    failures.length ? `${documentCount(failures)} failed${reason ? `: ${reason}` : ""}` : "",
  ];

  return {
    message: parts.filter(Boolean).join(" · ") || "Nothing to discard: already as before",
    failed: failures.length > 0,
  };
}

interface DiscardRun {
  apiRoute: string;
  conversationId: string | null;
  conversationIdRef: Ref<string | null>;
  setDiscard: SetState<DiscardState>;
  refresh: () => void;
}

async function discardDocuments(run: DiscardRun, documents: EditedRef[], force: boolean) {
  const { apiRoute, conversationId, conversationIdRef, setDiscard, refresh } = run;

  if (!conversationId || !documents.length) return;
  setDiscard({ ...NO_DISCARD, phase: "running" });

  try {
    const res = await fetch(`${apiRoute}/content-agent/discard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, documents, force }),
    });
    const data: unknown = await res.json();
    const body = isRecord(data) ? data : {};

    if (conversationIdRef.current !== conversationId) return;
    if (!res.ok) throw new Error(stringOf(body.error) || `HTTP ${res.status}`);
    const results = recordsOf(body.results);
    const keptKeys = new Set(
      results
        .filter((result) => result.status === "changed-since")
        .map((result) => `${result.collection}:${result.id}`)
    );
    const changedSince = documents.filter((document) => keptKeys.has(keyOf(document)));

    setDiscard({ phase: "idle", ...discardOutcome(results, changedSince), changedSince });
    refresh();
  } catch (err) {
    if (conversationIdRef.current !== conversationId) return;
    setDiscard({
      ...NO_DISCARD,
      message: `Discard failed: ${err instanceof Error ? err.message : String(err)}`,
      failed: true,
    });
  }
}

function useDiscard(run: Omit<DiscardRun, "setDiscard">) {
  const { apiRoute, conversationId, conversationIdRef, refresh } = run;
  const [discard, setDiscard] = useState<DiscardState>(NO_DISCARD);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setDiscard(NO_DISCARD);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [conversationId]);

  const discardRefs = useCallback(
    (documents: EditedRef[], force: boolean) =>
      discardDocuments(
        { apiRoute, conversationId, conversationIdRef, setDiscard, refresh },
        documents.map(({ collection, id }) => ({ collection, id })),
        force
      ),
    [apiRoute, conversationId, conversationIdRef, refresh]
  );
  const askDiscard = (asking: boolean) =>
    setDiscard({ ...NO_DISCARD, phase: asking ? "confirm" : "idle" });

  return { discard, discardRefs, askDiscard };
}

interface ReviewInput {
  refs: EditedRef[];
  conversationId: string | null;
  editVersions: Record<string, number>;
  refresh: () => void;
}

export function useReviewPanelState(review: ReviewInput, apiRoute: string) {
  const { refs, conversationId, editVersions, refresh } = review;
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState("");
  const [publishedKeys, setPublishedKeys] = useState<Set<string>>(new Set());

  const conversationIdRef = React.useRef<string | null>(conversationId);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const loadDiff = useCallback(
    (ref: EditedRef) => fetchDiff(ref, { conversationId, apiRoute, conversationIdRef, setDiffs }),
    [conversationId, apiRoute]
  );
  const knownKeysRef = React.useRef<Set<string>>(new Set());
  const seenVersionsRef = React.useRef<Record<string, number>>({});

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setDiffs({});
    setSelected(new Set());
    setExpanded(new Set());
    setPublishedKeys(new Set());
    setPublishMsg("");
    setPublishing(false);
    knownKeysRef.current = new Set();
    seenVersionsRef.current = {};
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [conversationId]);

  // Additive: rebuilding the set from refs would re-check documents the user deselected.
  useEffect(() => {
    const known = knownKeysRef.current;
    const fresh = refs.map(keyOf).filter((key) => !known.has(key));

    if (fresh.length) {
      fresh.forEach((key) => known.add(key));
      setSelected((previous) => withKeys(previous, fresh));
    }
  }, [refs]);

  useEffect(() => {
    const reedited = takeReedited(seenVersionsRef.current, editVersions);

    if (!reedited.length) return;
    // oxlint-disable-next-line react/set-state-in-effect
    setPublishedKeys((previous) => withoutKeys(previous, reedited));
    setDiffs((previous) => withoutDiffs(previous, reedited));
    setSelected((previous) => withKeys(previous, reedited));

    // An expanded row fetches only on the collapsed-to-expanded transition,
    // so refetch its dropped diff here.
    for (const key of reedited) {
      if (!expanded.has(key)) continue;
      const editedRef = refs.find((ref) => keyOf(ref) === key);

      if (editedRef) loadDiff(editedRef);
    }
  }, [editVersions, expanded, refs, loadDiff]);

  const toggleSelect = (key: string) => setSelected((previous) => toggled(previous, key));

  const toggleExpand = useCallback(
    (ref: EditedRef) => expandRow(ref, { expanded, diffs, loadDiff, setExpanded }),
    [expanded, diffs, loadDiff]
  );

  const publish = useCallback(
    (chosen: EditedRef[]) =>
      publishSelected({
        chosen,
        apiRoute,
        conversationId,
        conversationIdRef,
        seenVersionsRef,
        setPublishing,
        setPublishMsg,
        setPublishedKeys,
      }),
    [apiRoute, conversationId]
  );

  const { discard, discardRefs, askDiscard } = useDiscard({
    apiRoute,
    conversationId,
    conversationIdRef,
    refresh,
  });

  const view = { diffs, selected, expanded, publishing, publishMsg, publishedKeys, discard };

  return { view, toggleSelect, toggleExpand, publish, discardRefs, askDiscard };
}
