"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface FloatingState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FloatingOptions {
  storageKey: string;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  place?: (width: number, height: number) => { x: number; y: number };
}

let zTop = 99999;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

interface SizeLimits {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

type SetPanel = React.Dispatch<React.SetStateAction<FloatingState>>;

interface Ref<Value> {
  current: Value;
}

interface DragOrigin {
  startX: number;
  startY: number;
  origX: number;
  origY: number;
}

interface ResizeOrigin {
  startX: number;
  startY: number;
  orig: FloatingState;
  edges: string;
}

function loadState(opts: FloatingOptions): FloatingState {
  try {
    const raw = localStorage.getItem(opts.storageKey);

    if (raw) {
      const saved = JSON.parse(raw);

      if (
        saved &&
        typeof saved.x === "number" &&
        typeof saved.y === "number" &&
        typeof saved.width === "number" &&
        typeof saved.height === "number"
      ) {
        return saved;
      }
    }
  } catch {}

  return { x: -1, y: -1, width: opts.width, height: opts.height };
}

function initialState(opts: FloatingOptions, limits: SizeLimits): FloatingState {
  const { minWidth: MIN_W, minHeight: MIN_H, maxWidth: MAX_W, maxHeight: MAX_H } = limits;
  const initial = loadState(opts);

  if (initial.x === -1 && typeof window !== "undefined") {
    const pos = opts.place
      ? opts.place(initial.width, initial.height)
      : {
          x: window.innerWidth - initial.width - 24,
          y: window.innerHeight - initial.height - 24,
        };

    initial.x = pos.x;
    initial.y = pos.y;
  }

  if (typeof window !== "undefined") {
    initial.width = clamp(initial.width, MIN_W, Math.min(MAX_W, window.innerWidth));
    initial.height = clamp(initial.height, MIN_H, Math.min(MAX_H, window.innerHeight));
    initial.x = clamp(initial.x, 0, Math.max(0, window.innerWidth - 100));
    initial.y = clamp(initial.y, 0, Math.max(0, window.innerHeight - 60));
  }

  return initial;
}

function clampToViewport(previous: FloatingState, limits: SizeLimits): FloatingState {
  const { minWidth: MIN_W, minHeight: MIN_H, maxWidth: MAX_W, maxHeight: MAX_H } = limits;

  return {
    ...previous,
    width: clamp(previous.width, MIN_W, Math.min(MAX_W, window.innerWidth)),
    height: clamp(previous.height, MIN_H, Math.min(MAX_H, window.innerHeight)),
    x: clamp(previous.x, 0, window.innerWidth - 100),
    y: clamp(previous.y, 0, window.innerHeight - 60),
  };
}

function useSavedPanel(panel: FloatingState, storageKey: string) {
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(panel));
      } catch {}
    }, 200);

    return () => clearTimeout(id);
  }, [panel, storageKey]);
}

interface DragStart {
  origin: { x: number; y: number };
  bringToFront: () => void;
  dragRef: Ref<DragOrigin | null>;
  cleanupRef: Ref<(() => void) | null>;
  setPanel: SetPanel;
}

function startDrag(event: React.MouseEvent, drag: DragStart) {
  const { origin, bringToFront, dragRef, cleanupRef, setPanel } = drag;

  if ((event.target as HTMLElement).closest("button")) return;
  event.preventDefault();
  bringToFront();
  dragRef.current = {
    startX: event.clientX,
    startY: event.clientY,
    origX: origin.x,
    origY: origin.y,
  };

  const gesture = new AbortController();

  const onUp = () => {
    dragRef.current = null;
    cleanupRef.current = null;
    gesture.abort();
  };

  const onMove = (moveEvent: MouseEvent) => {
    if (!dragRef.current) return;

    // A mouse released outside the browser window fires no mouseup.
    if (moveEvent.buttons === 0) {
      onUp();

      return;
    }

    setPanel((previous) => ({
      ...previous,
      x: clamp(
        dragRef.current!.origX + (moveEvent.clientX - dragRef.current!.startX),
        0,
        window.innerWidth - 100
      ),
      y: clamp(
        dragRef.current!.origY + (moveEvent.clientY - dragRef.current!.startY),
        0,
        window.innerHeight - 60
      ),
    }));
  };

  window.addEventListener("mousemove", onMove, { signal: gesture.signal });
  window.addEventListener("mouseup", onUp, { signal: gesture.signal });
  cleanupRef.current = onUp;
}

function resized(
  { orig, edges }: ResizeOrigin,
  { deltaX, deltaY }: { deltaX: number; deltaY: number },
  limits: SizeLimits
): FloatingState {
  const { minWidth: MIN_W, minHeight: MIN_H, maxWidth: MAX_W, maxHeight: MAX_H } = limits;
  const next = { ...orig };

  if (edges.includes("e")) next.width = clamp(orig.width + deltaX, MIN_W, MAX_W);

  if (edges.includes("w")) {
    const newWidth = clamp(orig.width - deltaX, MIN_W, MAX_W);

    next.x = orig.x + (orig.width - newWidth);
    next.width = newWidth;
  }

  if (edges.includes("s")) next.height = clamp(orig.height + deltaY, MIN_H, MAX_H);

  if (edges.includes("n")) {
    const newHeight = clamp(orig.height - deltaY, MIN_H, MAX_H);

    next.y = orig.y + (orig.height - newHeight);
    next.height = newHeight;
  }

  next.x = clamp(next.x, 0, window.innerWidth - 100);
  next.y = clamp(next.y, 0, window.innerHeight - 60);

  return next;
}

interface ResizeStart {
  edges: string;
  panel: FloatingState;
  limits: SizeLimits;
  bringToFront: () => void;
  resizeRef: Ref<ResizeOrigin | null>;
  cleanupRef: Ref<(() => void) | null>;
  setPanel: SetPanel;
}

function startResize(event: React.MouseEvent, resize: ResizeStart) {
  const { edges, panel, limits, bringToFront, resizeRef, cleanupRef, setPanel } = resize;

  event.preventDefault();
  event.stopPropagation();
  bringToFront();
  resizeRef.current = {
    startX: event.clientX,
    startY: event.clientY,
    orig: { ...panel },
    edges,
  };

  const gesture = new AbortController();

  const onUp = () => {
    resizeRef.current = null;
    cleanupRef.current = null;
    gesture.abort();
  };

  const onMove = (moveEvent: MouseEvent) => {
    if (!resizeRef.current) return;

    if (moveEvent.buttons === 0) {
      onUp();

      return;
    }

    const origin = resizeRef.current;
    const deltaX = moveEvent.clientX - origin.startX;
    const deltaY = moveEvent.clientY - origin.startY;

    setPanel(() => resized(origin, { deltaX, deltaY }, limits));
  };

  window.addEventListener("mousemove", onMove, { signal: gesture.signal });
  window.addEventListener("mouseup", onUp, { signal: gesture.signal });
  cleanupRef.current = onUp;
}

export function useFloatingWindow(opts: FloatingOptions) {
  const MIN_W = opts.minWidth ?? 360;
  const MIN_H = opts.minHeight ?? 420;
  const MAX_W = opts.maxWidth ?? 1200;
  const MAX_H = opts.maxHeight ?? 1000;

  const [panel, setPanel] = useState<FloatingState>(() =>
    initialState(opts, { minWidth: MIN_W, minHeight: MIN_H, maxWidth: MAX_W, maxHeight: MAX_H })
  );
  const [z, setZ] = useState(() => ++zTop);
  const bringToFront = useCallback(() => setZ(++zTop), []);

  const dragRef = useRef<DragOrigin | null>(null);
  const resizeRef = useRef<ResizeOrigin | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    []
  );

  useSavedPanel(panel, opts.storageKey);

  useEffect(() => {
    const onResize = () =>
      setPanel((previous) =>
        clampToViewport(previous, {
          minWidth: MIN_W,
          minHeight: MIN_H,
          maxWidth: MAX_W,
          maxHeight: MAX_H,
        })
      );

    window.addEventListener("resize", onResize);

    return () => window.removeEventListener("resize", onResize);
  }, [MIN_W, MIN_H, MAX_W, MAX_H]);

  const onDragStart = useCallback(
    (event: React.MouseEvent) =>
      startDrag(event, {
        origin: { x: panel.x, y: panel.y },
        bringToFront,
        dragRef,
        cleanupRef,
        setPanel,
      }),
    [panel.x, panel.y, bringToFront]
  );

  const onResizeStart = useCallback(
    (edges: string) => (event: React.MouseEvent) =>
      startResize(event, {
        edges,
        panel,
        limits: { minWidth: MIN_W, minHeight: MIN_H, maxWidth: MAX_W, maxHeight: MAX_H },
        bringToFront,
        resizeRef,
        cleanupRef,
        setPanel,
      }),
    [panel, bringToFront, MIN_W, MIN_H, MAX_W, MAX_H]
  );

  return { panel, z, bringToFront, onDragStart, onResizeStart };
}

export function ResizeHandles({
  onResizeStart,
}: {
  onResizeStart: (edges: string) => (event: React.MouseEvent) => void;
}) {
  const size = 6;
  const base: React.CSSProperties = { position: "absolute" };

  return (
    <>
      <div
        aria-hidden="true"
        onMouseDown={onResizeStart("n")}
        style={{ ...base, top: 0, left: size, right: size, height: size, cursor: "n-resize" }}
      />
      <div
        aria-hidden="true"
        onMouseDown={onResizeStart("s")}
        style={{ ...base, bottom: 0, left: size, right: size, height: size, cursor: "s-resize" }}
      />
      <div
        aria-hidden="true"
        onMouseDown={onResizeStart("w")}
        style={{ ...base, top: size, bottom: size, left: 0, width: size, cursor: "w-resize" }}
      />
      <div
        aria-hidden="true"
        onMouseDown={onResizeStart("e")}
        style={{ ...base, top: size, bottom: size, right: 0, width: size, cursor: "e-resize" }}
      />
      <div
        aria-hidden="true"
        onMouseDown={onResizeStart("nw")}
        style={{ ...base, top: 0, left: 0, width: size * 2, height: size * 2, cursor: "nw-resize" }}
      />
      <div
        aria-hidden="true"
        onMouseDown={onResizeStart("ne")}
        style={{
          ...base,
          top: 0,
          right: 0,
          width: size * 2,
          height: size * 2,
          cursor: "ne-resize",
        }}
      />
      <div
        aria-hidden="true"
        onMouseDown={onResizeStart("sw")}
        style={{
          ...base,
          bottom: 0,
          left: 0,
          width: size * 2,
          height: size * 2,
          cursor: "sw-resize",
        }}
      />
      <div
        aria-hidden="true"
        onMouseDown={onResizeStart("se")}
        style={{
          ...base,
          bottom: 0,
          right: 0,
          width: size * 2,
          height: size * 2,
          cursor: "se-resize",
        }}
      />
    </>
  );
}
