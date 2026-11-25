"use client";

import React, { useRef, useEffect, useState } from "react";
import { Paperclip, Square, ArrowUp, X } from "lucide-react";
import { Button, Textarea, Tooltip } from "./components/primitives.js";
import { cn } from "./lib/cn.js";
import { MAX_FILES, fitFiles, formatBytes, refusalNote, shrinkImage } from "./lib/attachmentFit.js";

interface ChatInputProps {
  onSend: (text: string, files?: File[]) => void;
  onStop?: () => void;
  isLoading: boolean;
  value?: string;
  onChange?: (value: string) => void;
}

const ACCEPTED =
  "image/*,application/pdf,.md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml,.xml,.log,.docx,.xlsx";

const MAX_AUTO_HEIGHT = 320;

const DEFAULT_ROWS = 3;

// Computed from styles, not `offsetHeight`: the panel mounts behind `display:none`, where layout
// measures 0 and computed styles still resolve.
export function rowsHeight(
  element: { rows?: number },
  styles: Pick<
    CSSStyleDeclaration,
    | "fontSize"
    | "lineHeight"
    | "paddingTop"
    | "paddingBottom"
    | "borderTopWidth"
    | "borderBottomWidth"
  >,
  rows: number = DEFAULT_ROWS
): number {
  const fontSize = parseFloat(styles.fontSize) || 16;
  const line = parseFloat(styles.lineHeight) || fontSize * 1.5;
  const padding = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
  const border =
    (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);

  return Math.round(line * rows + padding + border);
}

function useAttachments() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState("");
  const filesRef = useRef(files);

  const replaceFiles = (next: File[]) => {
    filesRef.current = next;
    setFiles(next);
    setNote("");
  };

  const addFiles = async (incoming: File[]) => {
    if (!incoming.length) return;
    const prepared = await Promise.all(incoming.map(shrinkImage));
    const { accepted, refused } = fitFiles(filesRef.current, prepared);

    replaceFiles([...filesRef.current, ...accepted]);
    setNote(refusalNote(refused));
  };

  return { files, replaceFiles, note, dragging, setDragging, addFiles };
}

function useTextareaSizing(input: string, isLoading: boolean) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const manuallyResized = useRef(false);
  const autoHeight = useRef(0);
  const minHeight = useRef(0);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea || manuallyResized.current) return;
    minHeight.current = rowsHeight(textarea, getComputedStyle(textarea));
    textarea.style.height = "auto";
    const next = Math.min(Math.max(textarea.scrollHeight, minHeight.current), MAX_AUTO_HEIGHT);

    textarea.style.height = `${next}px`;
    autoHeight.current = next;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [input]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!textarea.offsetHeight || !autoHeight.current) return;
      if (Math.abs(textarea.offsetHeight - autoHeight.current) > 2) manuallyResized.current = true;
    });

    observer.observe(textarea);

    return () => observer.disconnect();
  }, []);

  // `readOnly`, not `disabled`:
  // a disabled textarea blurs when streaming starts and never sees Escape.
  // Refocusing keeps Escape-to-stop on this element and off a window listener.
  useEffect(() => {
    if (isLoading) textareaRef.current?.focus();
  }, [isLoading]);

  return textareaRef;
}

function AttachmentChips({
  files,
  replaceFiles,
  note,
}: {
  files: File[];
  replaceFiles: (next: File[]) => void;
  note: string;
}) {
  if (files.length === 0 && !note) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {files.map((file, i) => (
        <span
          key={`${file.name}-${i}`}
          className="border-ca-border bg-ca-bg text-2xs text-ca-fg inline-flex max-w-56 items-center gap-1.5 rounded-lg border py-0.5 pr-1 pl-2"
        >
          <span className="truncate">{file.name}</span>
          <span className="text-ca-faint shrink-0">{formatBytes(file.size)}</span>
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            onClick={() => replaceFiles(files.filter((_, index) => index !== i))}
            className="text-ca-faint hover:text-ca-danger shrink-0 cursor-pointer border-0 bg-transparent p-0"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {note && (
        <p role="alert" className="text-2xs text-ca-danger m-0 w-full">
          {note}
        </p>
      )}
    </div>
  );
}

function AttachControl({
  fileInputRef,
  addFiles,
  isLoading,
  attachmentsFull,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  addFiles: (incoming: File[]) => void;
  isLoading: boolean;
  attachmentsFull: boolean;
}) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED}
        onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
        className="hidden"
      />

      <Tooltip label={attachmentsFull ? `Up to ${MAX_FILES} files per message` : "Attach files"}>
        <Button
          variant="outline"
          size="icon"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading || attachmentsFull}
          aria-label="Attach files"
          className="size-12 shrink-0"
        >
          <Paperclip />
        </Button>
      </Tooltip>
    </>
  );
}

function SendControl({
  isLoading,
  canSend,
  onStop,
  submit,
}: {
  isLoading: boolean;
  canSend: boolean;
  onStop?: () => void;
  submit: () => void;
}) {
  return isLoading ? (
    <Button
      type="button"
      variant="danger"
      size="lg"
      onClick={onStop}
      className="shrink-0 rounded-xl"
    >
      <Square className="fill-current" />
      Stop
    </Button>
  ) : (
    <Button
      type="button"
      size="icon"
      onClick={submit}
      disabled={!canSend}
      aria-label="Send"
      className="size-12 shrink-0 rounded-xl"
    >
      <ArrowUp />
    </Button>
  );
}

export function ChatInput({ onSend, onStop, isLoading, value, onChange }: ChatInputProps) {
  const [uncontrolledInput, setUncontrolledInput] = useState("");
  const input = value !== undefined ? value : uncontrolledInput;
  const setInput = onChange !== undefined ? onChange : setUncontrolledInput;
  const { files, replaceFiles, note, dragging, setDragging, addFiles } = useAttachments();
  const textareaRef = useTextareaSizing(input, isLoading);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if ((input.trim() || files.length) && !isLoading) {
      onSend(input, files.length ? files : undefined);
      setInput("");
      replaceFiles([]);
    }
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const pasted = Array.from(event.clipboardData?.files ?? []);

    if (!pasted.length) return;
    event.preventDefault();
    void addFiles(pasted);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && isLoading) {
      event.preventDefault();
      onStop?.();

      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      submit();
    }
  };

  const canSend = Boolean(input.trim() || files.length > 0) && !isLoading;
  const attachmentsFull = files.length >= MAX_FILES;

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!isLoading) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!isLoading) void addFiles(Array.from(event.dataTransfer?.files ?? []));
      }}
      className={cn(
        "border-ca-border bg-ca-surface shrink-0 border-t px-3.5 py-3 transition-colors",
        dragging && "bg-ca-accent/5 outline-ca-accent outline-2 -outline-offset-4 outline-dashed"
      )}
    >
      <AttachmentChips files={files} replaceFiles={replaceFiles} note={note} />

      <div className="flex items-end gap-2">
        <AttachControl
          fileInputRef={fileInputRef}
          addFiles={addFiles}
          isLoading={isLoading}
          attachmentsFull={attachmentsFull}
        />

        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            isLoading ? "Press ESC or Stop to interrupt..." : "Ask about your content..."
          }
          rows={DEFAULT_ROWS}
          readOnly={isLoading}
          // No CSS max-height: it would stop the drag partway.
          // The automatic growth is bounded in JS.
          className={cn("flex-1 resize-y rounded-xl", isLoading && "opacity-50")}
        />

        <SendControl isLoading={isLoading} canSend={canSend} onStop={onStop} submit={submit} />
      </div>
    </div>
  );
}
