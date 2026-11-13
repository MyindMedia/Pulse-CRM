"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertCircle, Check, FileArchive, FileUp, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format-bytes";
import { fileKind } from "@/components/delivery/format";
import { etaText, type QueueItem } from "@/lib/upload-queue";
import { NO_ROWS, isFolderDrop, uploads } from "@/lib/upload-manager";

/* The upload side of the session Files panel: a drop zone, and one row per
   file with its own progress bar, bytes sent, time left and a cancel button.
   The rows live in the module-level store (src/lib/upload-manager.ts), so they
   keep going, and keep starting, after the panel closes; this file only draws
   them. At most two files upload at once across every booking. */

export const FOLDER_REFUSED = "Folders cannot be uploaded. Zip it first.";

const noRows = () => NO_ROWS;
const noText = () => "";

/** This booking's upload rows and its latest announcement, from the store.
 *  The server snapshot is empty, so the first client render matches it. */
export function useSessionUploads(sessionId: string) {
  const items = useSyncExternalStore(uploads.subscribe, () => uploads.rows(sessionId), noRows);
  const announcement = useSyncExternalStore(uploads.subscribe, () => uploads.announcement(sessionId), noText);
  return { items, announcement };
}

/* ── Drop zone ─────────────────────────────────────────────────── */

export function SessionDropZone({
  onFiles,
  onBrowse,
  disabled,
}: {
  /** Files to upload, and the names of dropped folders to refuse. */
  onFiles: (files: File[], folders: string[]) => void;
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
        if (disabled) return;
        // A dropped folder arrives as a File that cannot be read. Tell them
        // apart while the drop event is live (the entries go away after it).
        const files: File[] = [];
        const folders: string[] = [];
        const items = Array.from(e.dataTransfer.items ?? []).filter((it) => it.kind === "file");
        if (items.length > 0) {
          for (const it of items) {
            const file = it.getAsFile();
            if (isFolderDrop(it)) folders.push(file?.name || "Folder");
            else if (file) files.push(file);
          }
        } else {
          files.push(...Array.from(e.dataTransfer.files));
        }
        onFiles(files, folders);
      }}
      className={cn(
        "grid justify-items-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-graphite/70 bg-coal-2 px-3 py-4 text-center transition-colors motion-reduce:transition-none",
        over && "border-gold bg-gold/5",
      )}
    >
      <Upload className="size-5 text-[color:var(--gold-text)]" aria-hidden />
      <p className="text-sm font-semibold text-bone">
        Drop files here or{" "}
        <button
          type="button"
          onClick={onBrowse}
          disabled={disabled}
          className="inline-flex min-h-9 items-center rounded-sm px-1 font-semibold text-[color:var(--gold-text)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[color:var(--gold-text)] max-sm:min-h-11"
        >
          browse
        </button>
      </p>
      {/* No-break spaces: "2 GB" and "100 MB" never split across lines. */}
      <p className="max-w-[34ch] text-[0.75rem] leading-snug text-steel">
        Audio, video, stems and session zips up to 2{" "}GB. PDFs and images up to 100{" "}MB.
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
  items: readonly QueueItem[];
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
  // No aria-live here: progress ticks would be read out every second. The
  // panel's one role="status" node says when a file starts, lands or fails.
  return (
    <ul className="space-y-2" aria-label="Uploading" data-testid="session-upload-queue">
      {items.map((item) => {
        const pct = item.size > 0 ? Math.round((item.sent / item.size) * 100) : item.status === "done" ? 100 : 0;
        const active = item.status === "uploading" || item.status === "queued";
        const eta = item.status === "uploading" && item.startedAt && !item.committed ? etaText(item.sent, item.size, item.startedAt, now) : "";
        const archive = fileKind(item.name, "") === "archive";
        let sub: string;
        switch (item.status) {
          case "queued":
            sub = `Waiting · ${formatBytes(item.size)}`;
            break;
          case "uploading":
            sub = item.committed
              ? `Finishing · ${formatBytes(item.size)}`
              : `${formatBytes(item.sent)} of ${formatBytes(item.size)}${eta ? ` · ${eta}` : ""}`;
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
        const failed = item.status === "failed";
        return (
          <li
            key={item.id}
            data-status={item.status}
            className="flex min-w-0 items-center gap-2.5 rounded-lg border border-graphite/50 bg-coal-2 p-2.5"
          >
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-md bg-coal-3",
                item.status === "done" ? "text-[color:var(--ok-text)]" : failed ? "text-[color:var(--bad-text)]" : "text-[color:var(--gold-text)]",
              )}
            >
              {item.status === "done" ? (
                <Check className="size-4" aria-hidden />
              ) : failed ? (
                <AlertCircle className="size-4" aria-hidden />
              ) : item.status === "canceled" ? (
                <X className="size-4" aria-hidden />
              ) : archive ? (
                <FileArchive className="size-4" aria-hidden />
              ) : (
                <FileUp className="size-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-bone" title={item.name}>
                {item.name}
              </p>
              {/* A refusal can be long: it wraps instead of being cut off. */}
              <p
                className={cn(
                  "font-meta text-[0.75rem]",
                  failed ? "text-[color:var(--bad-text)] [overflow-wrap:anywhere]" : "truncate text-steel",
                )}
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
            {item.committed && active ? (
              // Past the point of no return: nothing to cancel. Keeps the row's shape.
              <span className="size-9 shrink-0 max-sm:size-11" aria-hidden />
            ) : (
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-9 shrink-0 max-sm:size-11"
                aria-label={active ? `Cancel upload of ${item.name}` : `Dismiss ${item.name}`}
                onClick={() => (active ? onCancel(item.id) : onDismiss(item.id))}
              >
                <X className="size-4" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
