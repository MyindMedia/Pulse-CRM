"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AlertCircle, Check, FileUp, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { etaText, formatBytes, nextToStart, queueReducer, type QueueItem } from "@/lib/upload-queue";

/* The upload side of the session Files panel: a drop zone, and one row per
   file with its own progress bar, bytes sent, time left and a cancel button.
   At most MAX_PARALLEL files upload at once; a canceled or failed file never
   stops the others. */

export type UploadContext = {
  signal: AbortSignal;
  onProgress: (sent: number, total: number) => void;
};

/** What the caller does for one file. Throw to fail the row; an AbortError
 *  (or an aborted signal) is treated as a cancel, not a failure. */
export type UploadJob<M> = (file: File, ctx: UploadContext, meta: M | undefined) => Promise<void>;

const DONE_LINGER_MS = 4000;
const PROGRESS_EVERY_MS = 120;

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function useUploadQueue<M = undefined>(run: UploadJob<M>, errorText: (err: unknown) => string, onDone?: (file: File, meta: M | undefined) => void) {
  const [items, dispatch] = useReducer(queueReducer, [] as QueueItem[]);
  const files = useRef(new Map<string, { file: File; meta: M | undefined }>());
  const controllers = useRef(new Map<string, AbortController>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const latest = useRef({ run, errorText, onDone });
  useEffect(() => {
    latest.current = { run, errorText, onDone };
  });

  const add = useCallback((list: File[], meta?: M) => {
    if (list.length === 0) return;
    const batch = list.map((file) => {
      const id = crypto.randomUUID();
      files.current.set(id, { file, meta });
      return { id, name: file.name || "upload", size: file.size };
    });
    dispatch({ type: "add", items: batch });
  }, []);

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    files.current.delete(id);
    dispatch({ type: "cancel", id });
  }, []);

  const remove = useCallback((id: string) => {
    files.current.delete(id);
    dispatch({ type: "remove", id });
  }, []);

  // Start whatever fits. controllers is the guard that keeps a re-run of this
  // effect (React strict mode, a quick re-render) from starting a file twice.
  useEffect(() => {
    for (const id of nextToStart(items)) {
      const entry = files.current.get(id);
      if (!entry || controllers.current.has(id)) continue;
      const controller = new AbortController();
      controllers.current.set(id, controller);
      dispatch({ type: "start", id, at: Date.now() });
      let lastTick = 0;
      void (async () => {
        try {
          await latest.current.run(
            entry.file,
            {
              signal: controller.signal,
              onProgress: (sent, total) => {
                const t = Date.now();
                if (sent < total && t - lastTick < PROGRESS_EVERY_MS) return;
                lastTick = t;
                dispatch({ type: "progress", id, sent });
              },
            },
            entry.meta,
          );
          if (controller.signal.aborted) throw new DOMException("Upload canceled.", "AbortError");
          dispatch({ type: "done", id });
          latest.current.onDone?.(entry.file, entry.meta);
          const timer = setTimeout(() => {
            timers.current.delete(timer);
            files.current.delete(id);
            dispatch({ type: "remove", id });
          }, DONE_LINGER_MS);
          timers.current.add(timer);
        } catch (err) {
          if (isAbort(err) || controller.signal.aborted) dispatch({ type: "cancel", id });
          else dispatch({ type: "fail", id, error: latest.current.errorText(err) });
        } finally {
          controllers.current.delete(id);
          files.current.delete(id);
        }
      })();
    }
  }, [items]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);

  // Closing the tab mid-upload would silently drop the file, so ask first.
  const busy = items.some((i) => i.status === "queued" || i.status === "uploading");
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  return { items, busy, add, cancel, remove };
}

/* ── Drop zone ─────────────────────────────────────────────────── */

export function SessionDropZone({
  onFiles,
  onBrowse,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  onBrowse: () => void;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  return (
    <div
      data-testid="session-drop-zone"
      data-over={over ? "true" : undefined}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (!disabled) onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        "grid justify-items-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-graphite/70 bg-coal-2 px-3 py-4 text-center transition-colors motion-reduce:transition-none",
        over && "border-gold bg-gold/5",
      )}
    >
      <Upload className="size-5 text-gold" aria-hidden />
      <p className="text-sm font-semibold text-bone">
        Drop files here or{" "}
        <button
          type="button"
          onClick={onBrowse}
          disabled={disabled}
          className="inline-flex min-h-9 items-center rounded-sm px-1 font-semibold text-gold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-gold max-sm:min-h-11"
        >
          browse
        </button>
      </p>
      <p className="max-w-[34ch] text-[0.75rem] leading-snug text-steel">
        Audio, video, stems and session zips up to 2 GB. PDFs and images up to 100 MB.
      </p>
    </div>
  );
}

/* ── Queue rows ────────────────────────────────────────────────── */

export function UploadQueueList({
  items,
  onCancel,
  onDismiss,
}: {
  items: QueueItem[];
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = items.some((i) => i.status === "uploading");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Uploading" aria-live="polite" data-testid="session-upload-queue">
      {items.map((item) => {
        const pct = item.size > 0 ? Math.round((item.sent / item.size) * 100) : item.status === "done" ? 100 : 0;
        const active = item.status === "uploading" || item.status === "queued";
        const eta = item.status === "uploading" && item.startedAt ? etaText(item.sent, item.size, item.startedAt, now) : "";
        let sub: string;
        switch (item.status) {
          case "queued":
            sub = `Waiting · ${formatBytes(item.size)}`;
            break;
          case "uploading":
            sub = `${formatBytes(item.sent)} of ${formatBytes(item.size)}${eta ? ` · ${eta}` : ""}`;
            break;
          case "done":
            sub = `Uploaded · ${formatBytes(item.size)}`;
            break;
          case "canceled":
            sub = "Canceled";
            break;
          default:
            sub = item.error ?? "Upload failed.";
        }
        return (
          <li
            key={item.id}
            data-status={item.status}
            className="flex min-w-0 items-center gap-2.5 rounded-lg border border-graphite/50 bg-coal-2 p-2.5"
          >
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-md bg-coal-3",
                item.status === "done" ? "text-positive" : item.status === "failed" ? "text-critical" : "text-gold-dim",
              )}
            >
              {item.status === "done" ? (
                <Check className="size-4" aria-hidden />
              ) : item.status === "failed" ? (
                <AlertCircle className="size-4" aria-hidden />
              ) : item.status === "canceled" ? (
                <X className="size-4" aria-hidden />
              ) : (
                <FileUp className="size-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-bone" title={item.name}>
                {item.name}
              </p>
              <p
                className={cn("truncate font-meta text-[0.75rem]", item.status === "failed" ? "text-critical" : "text-steel")}
                title={item.status === "failed" ? item.error : undefined}
                role={item.status === "failed" ? "alert" : undefined}
              >
                {sub}
              </p>
              {active && (
                <div
                  role="progressbar"
                  aria-label={`Upload progress for ${item.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={item.status === "queued" ? 0 : pct}
                  className="mt-1.5 h-1 overflow-hidden rounded-full bg-coal-3"
                >
                  <div
                    className="h-full rounded-full bg-gold transition-[width] duration-150 ease-out motion-reduce:transition-none"
                    style={{ width: `${item.status === "queued" ? 0 : Math.max(pct, 2)}%` }}
                  />
                </div>
              )}
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-9 shrink-0 max-sm:size-11"
              aria-label={active ? `Cancel upload of ${item.name}` : `Dismiss ${item.name}`}
              onClick={() => (active ? onCancel(item.id) : onDismiss(item.id))}
            >
              <X className="size-4" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
