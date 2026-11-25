"use client";

import React from "react";
import { TailChase } from "ldrs/react";
import { Check } from "lucide-react";
import { cn } from "../lib/cn.js";

// The loader is Tail Chase from ldrs (https://uiball.com/ldrs/, MIT).
// Its stylesheet is compiled into theme.css,
// because a stylesheet imported by the host never reaches the shadow root.
export function AgentGlyph({
  active,
  size = 20,
  className,
}: {
  active: boolean;
  size?: number;
  className?: string;
}) {
  if (!active)
    return <Check className={cn("text-ca-faint size-3.5 shrink-0", className)} aria-hidden />;

  return (
    <span
      className={cn("ca-loader inline-flex shrink-0 items-center justify-center", className)}
      aria-hidden
    >
      <TailChase size={size} speed={1.5} color="var(--color-ca-accent)" />
    </span>
  );
}
