"use client";

import React, { useEffect } from "react";
import { Bot, Minus, X } from "lucide-react";
import { useFloatingWindow, ResizeHandles } from "./useFloatingWindow.js";
import { Button, Tooltip } from "./components/primitives.js";

interface ContentAgentPanelProps {
  open: boolean;
  onMinimize: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

export function ContentAgentPanel({ open, onMinimize, onClose, children }: ContentAgentPanelProps) {
  const { panel, z, bringToFront, onDragStart, onResizeStart } = useFloatingWindow({
    storageKey: "content-agent-panel",
    width: 440,
    height: 620,
    minWidth: 380,
    minHeight: 440,
  });

  useEffect(() => {
    if (open) bringToFront();
  }, [open, bringToFront]);

  // Never return null when minimized: display:none keeps the chat and any in-flight stream mounted.

  return (
    <div
      role="presentation"
      onMouseDown={bringToFront}
      style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height, zIndex: z }}
      className="border-ca-border bg-ca-bg fixed flex flex-col overflow-hidden rounded-2xl border shadow-2xl"
    >
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <header
        onMouseDown={onDragStart}
        className="border-ca-border bg-ca-surface flex shrink-0 cursor-grab items-center justify-between border-b px-4 py-3 select-none active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          <span className="bg-ca-fg text-ca-bg flex size-10 items-center justify-center rounded-xl">
            <Bot className="size-6" />
          </span>
          <span className="text-ca-fg text-sm font-bold tracking-tight">Content Agent</span>
        </div>
        <div className="flex gap-0.5">
          <Tooltip label="Minimize - reopen to continue this chat">
            <Button variant="ghost" size="icon" onClick={onMinimize} aria-label="Minimize">
              <Minus />
            </Button>
          </Tooltip>
          <Tooltip label="Close - next open starts a new chat">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close"
              className="hover:bg-ca-danger/10 hover:text-ca-danger"
            >
              <X />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>

      <ResizeHandles onResizeStart={onResizeStart} />
    </div>
  );
}
