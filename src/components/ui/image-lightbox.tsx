"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ============================================================
   Looking at a photo properly.

   An 80px thumbnail is enough to know a photo exists and no use
   at all for reading what is written on it - which is the whole
   point of photographing the back of a rack unit. Opening it
   full-screen, then letting it go to actual size and be dragged
   around, is the difference between "there is a picture" and
   "that is XLR input 4".
   ============================================================ */

export function ImageLightbox({
  src,
  alt,
  caption,
  open,
  onOpenChange,
}: {
  src: string;
  alt: string;
  caption?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mounted, setMounted] = React.useState(false);
  const [zoomed, setZoomed] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setMounted(true), []);

  // Reset to fit each time it opens, so a previous zoom does not decide how
  // the next photo appears.
  React.useEffect(() => {
    if (open) setZoomed(false);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
      }
    }
    // Capture, so this closes before any canvas shortcut sees the key.
    window.addEventListener("keydown", onKey, true);
    // The page behind must not scroll while a full-screen viewer is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previous;
    };
  }, [open, onOpenChange]);

  /* Drag to pan when zoomed in. A photo bigger than the window is only
     useful if you can get to the corner of it, and a trackpad user should
     not have to hunt for scrollbars. */
  const drag = React.useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  function onPointerDown(event: React.PointerEvent) {
    if (!zoomed || !scrollRef.current) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: scrollRef.current.scrollLeft,
      top: scrollRef.current.scrollTop,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    const start = drag.current;
    if (!start || !scrollRef.current) return;
    scrollRef.current.scrollLeft = start.left - (event.clientX - start.x);
    scrollRef.current.scrollTop = start.top - (event.clientY - start.y);
  }

  function endDrag(event: React.PointerEvent) {
    drag.current = null;
    const el = event.currentTarget as HTMLElement;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Photo"}
      className="anim-rise fixed inset-0 z-[80] flex flex-col bg-ink/95 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="flex shrink-0 items-center gap-2 px-4 py-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="min-w-0 flex-1 truncate text-xs text-steel">{caption ?? alt}</p>
        <button
          type="button"
          onClick={() => setZoomed((v) => !v)}
          aria-label={zoomed ? "Fit to screen" : "View at full size"}
          className="grid size-8 place-items-center rounded-chrome border border-hairline-2 text-steel transition-colors hover:bg-coal hover:text-bone"
        >
          {zoomed ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
          className="grid size-8 place-items-center rounded-chrome border border-hairline-2 text-steel transition-colors hover:bg-coal hover:text-bone"
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "min-h-0 flex-1",
          zoomed ? "overflow-auto" : "grid place-items-center overflow-hidden p-4",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onClick={() => setZoomed((v) => !v)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={cn(
            "select-none",
            zoomed
              ? "max-w-none cursor-grab active:cursor-grabbing"
              : "max-h-full max-w-full cursor-zoom-in object-contain",
          )}
        />
      </div>

      <p className="shrink-0 px-4 pb-3 text-center text-[10px] text-steel/60">
        {zoomed ? "Drag to move · click to fit" : "Click the photo to view it at full size"}
        {" · Esc to close"}
      </p>
    </div>,
    document.body,
  );
}

/**
 * A thumbnail that opens the full photo when clicked.
 *
 * Kept next to the viewer so anywhere showing a small photo can offer the
 * large one without each caller wiring up its own dialog state.
 */
export function ExpandableImage({
  src,
  alt,
  caption,
  className,
  imgClassName,
}: {
  src: string;
  alt: string;
  caption?: string;
  className?: string;
  imgClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View ${alt || "photo"} full size`}
        className={cn("group relative block cursor-zoom-in overflow-hidden", className)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={cn("size-full object-cover", imgClassName)} />
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-ink/0 opacity-0 transition-opacity group-hover:bg-ink/45 group-hover:opacity-100">
          <Maximize2 className="size-4 text-bone" />
        </span>
      </button>
      <ImageLightbox
        src={src}
        alt={alt}
        caption={caption}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
