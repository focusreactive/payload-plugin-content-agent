"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "./components/primitives.js";
import { cn } from "./lib/cn.js";
import { useApiRoute } from "./routes.js";

const DONE_VISIBLE_MS = 4000;

function useInitState() {
  const apiRoute = useApiRoute();
  const [phase, setPhase] = useState<
    "checking" | "needed" | "running" | "done" | "error" | "hidden"
  >("checking");
  const [message, setMessage] = useState<string>("");
  // Set back to true in the effect body: StrictMode runs the cleanup once right after mount.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${apiRoute}/content-agent/init`);
        const data = response.ok ? await response.json() : null;

        if (cancelled) return;
        if (data && data.memoryEnabled && !data.initialized) setPhase("needed");
        else setPhase("hidden");
      } catch {
        if (!cancelled) setPhase("hidden");
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiRoute]);

  useEffect(() => {
    if (phase !== "done") return;
    const timer = setTimeout(() => setPhase("hidden"), DONE_VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [phase]);

  const runInit = useCallback(async () => {
    setPhase("running");

    try {
      const res = await fetch(`${apiRoute}/content-agent/init`, { method: "POST" });
      const data = await res.json().catch(() => null);

      if (!mountedRef.current) return;

      if (res.ok && data?.ok) {
        setMessage(
          `Scanned ${data.collections} collection${data.collections === 1 ? "" : "s"}${data.globals ? ` and ${data.globals} global${data.globals === 1 ? "" : "s"}` : ""}.`
        );
        setPhase("done");
      } else {
        setMessage(data?.error || "Initialization failed.");
        setPhase("error");
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setMessage(error instanceof Error ? error.message : "Initialization failed.");
      setPhase("error");
    }
  }, [apiRoute]);

  return { phase, message, runInit };
}

export function InitBanner() {
  const { phase, message, runInit } = useInitState();

  if (phase === "checking" || phase === "hidden") return null;

  const isDone = phase === "done";
  const isError = phase === "error";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5 text-xs",
        isDone && "border-ca-ok/25 bg-ca-ok/10 text-ca-ok",
        isError && "border-ca-danger/25 bg-ca-danger/10 text-ca-danger",
        !isDone && !isError && "border-ca-accent/25 bg-ca-accent/10 text-ca-accent"
      )}
    >
      <span className="leading-snug">
        {phase === "needed" &&
          "Build the knowledge base so I understand your collections, globals and content."}
        {phase === "running" && "Scanning your CMS through MCP…"}
        {isDone && (message || "Knowledge base ready.")}
        {isError && (message || "Initialization failed.")}
      </span>
      {/* Class names are spelled out, never interpolated:
          Tailwind finds classes by scanning the source. */}
      {(phase === "needed" || isError) && (
        <Button
          size="sm"
          onClick={runInit}
          className={cn(
            "shrink-0 text-white hover:opacity-90",
            isError ? "bg-ca-danger" : "bg-ca-accent"
          )}
        >
          {isError ? "Retry" : "Initialize"}
        </Button>
      )}
      {phase === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
    </div>
  );
}
