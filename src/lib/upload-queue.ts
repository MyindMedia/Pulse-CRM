/* The upload queue for the session Files panel, as plain data. The component
   in session-upload-queue.tsx owns the side effects (XHR, Convex calls); this
   file only decides what the rows look like and which one starts next, so it
   can be tested without a browser. */

export const MAX_PARALLEL = 2;

export type QueueStatus = "queued" | "uploading" | "done" | "failed" | "canceled";

export type QueueItem = {
  id: string;
  name: string;
  size: number;
  sent: number;
  status: QueueStatus;
  error?: string;
  /** When the bytes started moving (ms). Feeds etaText. */
  startedAt?: number;
};

export type QueueAction =
  | { type: "add"; items: { id: string; name: string; size: number }[] }
  | { type: "start"; id: string; at: number }
  | { type: "progress"; id: string; sent: number }
  | { type: "done"; id: string }
  | { type: "fail"; id: string; error: string }
  | { type: "cancel"; id: string }
  | { type: "remove"; id: string };

function patch(state: QueueItem[], id: string, apply: (item: QueueItem) => QueueItem): QueueItem[] {
  return state.map((item) => (item.id === id ? apply(item) : item));
}

/** Late events from an upload that was already canceled (or finished) must not
 *  bring its row back to life, so progress, done and fail only apply while a row
 *  is uploading. */
export function queueReducer(state: QueueItem[], action: QueueAction): QueueItem[] {
  switch (action.type) {
    case "add":
      return [
        ...state,
        ...action.items.map((i): QueueItem => ({ id: i.id, name: i.name, size: i.size, sent: 0, status: "queued" })),
      ];
    case "start":
      return patch(state, action.id, (i) => (i.status === "queued" ? { ...i, status: "uploading", sent: 0, startedAt: action.at } : i));
    case "progress":
      return patch(state, action.id, (i) =>
        i.status === "uploading" ? { ...i, sent: Math.max(i.sent, Math.min(Math.max(0, action.sent), i.size)) } : i,
      );
    case "done":
      return patch(state, action.id, (i) => (i.status === "uploading" ? { ...i, status: "done", sent: i.size, error: undefined } : i));
    case "fail":
      return patch(state, action.id, (i) => (i.status === "uploading" ? { ...i, status: "failed", error: action.error } : i));
    case "cancel":
      return patch(state, action.id, (i) => (i.status === "queued" || i.status === "uploading" ? { ...i, status: "canceled" } : i));
    case "remove":
      return state.filter((i) => i.id !== action.id);
  }
}

/** Ids to start now: oldest queued first, never more than MAX_PARALLEL uploading. */
export function nextToStart(state: QueueItem[]): string[] {
  const active = state.filter((i) => i.status === "uploading").length;
  const free = Math.max(0, MAX_PARALLEL - active);
  return state
    .filter((i) => i.status === "queued")
    .slice(0, free)
    .map((i) => i.id);
}

/** "about 2 min left", "a few seconds left", or "" until there are two seconds
 *  of data to base a guess on. */
export function etaText(sent: number, total: number, startedAt: number, now: number): string {
  const elapsed = now - startedAt;
  if (elapsed < 2000 || sent <= 0 || sent >= total) return "";
  const secondsLeft = ((total - sent) / (sent / elapsed)) / 1000;
  if (!Number.isFinite(secondsLeft)) return "";
  if (secondsLeft <= 20) return "a few seconds left";
  if (secondsLeft < 90) return "about 1 min left";
  const minutes = Math.round(secondsLeft / 60);
  if (minutes < 90) return `about ${minutes} min left`;
  return `about ${Math.round(minutes / 60)} hr left`;
}

/** "612 MB", "1.08 GB", "212 KB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  if (units[i] === "GB") return `${v.toFixed(2)} GB`;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
