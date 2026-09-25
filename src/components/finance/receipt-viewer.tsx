"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { Check, ExternalLink, FileText, Loader2, Maximize2, Minimize2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ============================================================
   Looking at a receipt.

   The original used to open in a new tab at the photo's natural
   size - a 4000px phone picture you had to scroll around to find.
   Now it opens over the page, centred and fitted to the screen,
   with a tap to zoom in and drag around the small print. A PDF
   gets the same treatment in a framed reader.
   ============================================================ */

export type ReceiptFile = {
  url: string;
  /** Mime type when known. Unknown files are tried as an image first. */
  fileType?: string | null;
  title: string;
  subtitle?: string;
};

const isPdf = (type?: string | null, url?: string) =>
  type === "application/pdf" || (!type && !!url && /\.pdf($|\?)/i.test(url));

const ZOOM = 2.25;
/** Closing is quick and clean; only opening gets the spring. */
const EXIT = { duration: 0.18, ease: [0.4, 0, 1, 1] as const };

export function ReceiptViewer({
  file,
  onOpenChange,
}: {
  /** The receipt to show; null closes the viewer. */
  file: ReceiptFile | null;
  onOpenChange: (open: boolean) => void;
}) {
  const reduce = useReducedMotion();

  // AnimatePresence keeps the last render on screen while it animates out,
  // so the closing receipt stays put without extra state here.
  return (
    <DialogPrimitive.Root open={file !== null} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {file && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[80] bg-ink/90 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: EXIT }}
                transition={{ duration: reduce ? 0 : 0.22 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              forceMount
              className="fixed inset-0 z-[81] flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none"
              onClick={() => onOpenChange(false)}
            >
              <ViewerBody key={file.url} file={file} reduce={!!reduce} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

function ViewerBody({ file, reduce }: { file: ReceiptFile; reduce: boolean }) {
  const pdf = isPdf(file.fileType, file.url);
  const [broken, setBroken] = React.useState(false);
  const [zoomed, setZoomed] = React.useState(false);
  const [bounds, setBounds] = React.useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = React.useState(false);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const dragged = React.useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  function toggleZoom() {
    const next = !zoomed;
    const stage = stageRef.current;
    const img = imgRef.current;
    if (next && stage && img) {
      // How far the enlarged picture can travel before an edge comes inside the frame.
      setBounds({
        x: Math.max(0, (img.offsetWidth * ZOOM - stage.clientWidth) / 2),
        y: Math.max(0, (img.offsetHeight * ZOOM - stage.clientHeight) / 2),
      });
    }
    if (!next) {
      animate(x, 0, { type: "spring", visualDuration: 0.35, bounce: 0.15 });
      animate(y, 0, { type: "spring", visualDuration: 0.35, bounce: 0.15 });
    }
    setZoomed(next);
  }

  const iconButton =
    "grid size-9 place-items-center rounded-chrome border border-hairline-2 bg-coal/70 text-steel transition-colors hover:bg-coal-3 hover:text-bone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50";

  return (
    <>
      <motion.div
        className="flex shrink-0 items-center gap-2 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10, transition: EXIT }}
        transition={{ duration: reduce ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="truncate text-sm font-medium text-bone">{file.title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className={cn("truncate text-xs text-steel", !file.subtitle && "sr-only")}>
            {file.subtitle ?? "Receipt original"}
          </DialogPrimitive.Description>
        </div>
        {!pdf && !broken && (
          <button type="button" onClick={toggleZoom} aria-label={zoomed ? "Fit to screen" : "Zoom in"} aria-pressed={zoomed} className={iconButton}>
            {zoomed ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        )}
        <a href={file.url} target="_blank" rel="noreferrer" aria-label="Open the original in a new tab" className={iconButton}>
          <ExternalLink className="size-4" />
        </a>
        <DialogPrimitive.Close className={iconButton} aria-label="Close">
          <X className="size-4" />
        </DialogPrimitive.Close>
      </motion.div>

      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
          {pdf ? (
            <motion.iframe
              src={file.url}
              title={file.title}
              onClick={(e) => e.stopPropagation()}
              className="h-full w-full max-w-4xl rounded-lg bg-white shadow-elev-4"
              initial={{ opacity: 0, scale: 0.94, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10, transition: EXIT }}
              transition={reduce ? { duration: 0 } : { type: "spring", visualDuration: 0.42, bounce: 0.18 }}
            />
          ) : broken ? (
            <div onClick={(e) => e.stopPropagation()} className="grid place-items-center gap-3 rounded-lg border border-hairline-2 bg-coal/80 px-8 py-10 text-center">
              <FileText className="size-8 text-steel" />
              <p className="text-sm text-bone">This file can&apos;t be previewed here.</p>
              <a href={file.url} target="_blank" rel="noreferrer" className="text-sm text-gold hover:underline">Open the original</a>
            </div>
          ) : (
            <>
              {!loaded && <Loader2 className="absolute size-6 animate-spin text-steel" aria-hidden />}
              <motion.img
                ref={imgRef}
                src={file.url}
                alt={file.title}
                draggable={false}
                onLoad={() => setLoaded(true)}
                onError={() => setBroken(true)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (dragged.current) { dragged.current = false; return; }
                  toggleZoom();
                }}
                drag={zoomed}
                dragConstraints={{ left: -bounds.x, right: bounds.x, top: -bounds.y, bottom: bounds.y }}
                dragElastic={0.12}
                onDragStart={() => { dragged.current = true; }}
                style={{ x, y }}
                className={cn(
                  "max-h-full max-w-full select-none rounded-md object-contain shadow-elev-4",
                  zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
                )}
                initial={{ opacity: 0, scale: 0.92, y: 24 }}
                animate={{ opacity: loaded ? 1 : 0, scale: zoomed ? ZOOM : 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 12, transition: EXIT }}
                transition={reduce ? { duration: 0 } : { type: "spring", visualDuration: 0.42, bounce: 0.18 }}
              />
            </>
          )}
        </div>
      </div>

      <p className="shrink-0 px-4 pb-3 text-center text-[10px] text-steel/60" onClick={(e) => e.stopPropagation()}>
        {pdf ? "Scroll inside the document to read it" : zoomed ? "Drag to move · tap to fit" : "Tap the receipt to zoom in"}
        {" · Esc to close"}
      </p>
    </>
  );
}

/** plain: no mark; attached: green tick; uploading: spinner over the preview. */
export type ReceiptThumbStatus = "uploading" | "attached" | "plain";

/**
 * A small preview of a receipt with a status mark in the corner - a spinner
 * while it uploads, a green tick once it is attached. Clicking opens it.
 */
export function ReceiptThumb({
  url,
  fileType,
  label,
  status = "plain",
  pop = false,
  onOpen,
  className,
}: {
  url: string | null;
  fileType?: string | null;
  /** What the preview is of, for the accessible name. */
  label: string;
  status?: ReceiptThumbStatus;
  /** Play the "just attached" pop on the tick. */
  pop?: boolean;
  onOpen?: () => void;
  className?: string;
}) {
  const [broken, setBroken] = React.useState(false);
  const reduce = useReducedMotion();
  const pdf = isPdf(fileType, url ?? undefined);
  const showImage = url && !pdf && !broken;

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      aria-label={status === "uploading" ? `${label}, uploading` : `View receipt: ${label}`}
      title={status === "uploading" ? "Uploading receipt…" : status === "attached" ? "Receipt attached. Click to view." : "Click to view the receipt."}
      whileHover={reduce || !onOpen ? undefined : { scale: 1.08, y: -1 }}
      whileTap={reduce || !onOpen ? undefined : { scale: 0.95 }}
      initial={reduce ? false : { opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.4 }}
      className={cn(
        "relative block h-11 w-9 shrink-0 rounded-md border border-hairline-2 bg-coal-2 shadow-elev-1 outline-none",
        "focus-visible:ring-2 focus-visible:ring-gold/50 disabled:cursor-default",
        onOpen && "cursor-zoom-in",
        className,
      )}
    >
      <span className="absolute inset-0 overflow-hidden rounded-[inherit]">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-steel">
            <FileText className="size-4" />
            {pdf && <span className="absolute bottom-0.5 font-meta text-[0.5rem] font-semibold tracking-wide text-steel/80">PDF</span>}
          </span>
        )}
        {status === "uploading" && (
          <span className="absolute inset-0 grid place-items-center bg-ink/55">
            <Loader2 className="size-4 animate-spin text-gold" />
          </span>
        )}
      </span>
      {status === "attached" && (
        <motion.span
          aria-hidden
          initial={pop && !reduce ? { scale: 0, rotate: -45 } : false}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", visualDuration: 0.4, bounce: 0.55, delay: pop ? 0.1 : 0 }}
          className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-positive text-ink ring-2 ring-ink"
        >
          <Check className="size-2.5" strokeWidth={3.5} />
        </motion.span>
      )}
      {pop && status === "attached" && !reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-positive"
          initial={{ opacity: 0.9, scale: 1 }}
          animate={{ opacity: 0, scale: 1.45 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      )}
    </motion.button>
  );
}
