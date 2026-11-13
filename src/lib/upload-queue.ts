/* The upload queue for the session Files panel, as plain data. The store in
   upload-manager.ts owns the side effects (running jobs, timers); this file
   only decides what the rows look like and which one starts next, so it can be
   tested without a browser. */

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
  /** Past the point of no return (the bytes are in and the server writes have
   *  begun): cancel is ignored and the row ends as Uploaded. */
  committed?: boolean;
};

export type QueueAction =
  | { type: "add"; items: { id: string; name: string; size: number }[] }
  | { type: "start"; id: string; at: number }
  | { type: "progress"; id: string; sent: number }
  | { type: "done"; id: string }
  | { type: "fail"; id: string; error: string }
  | { type: "commit"; id: string }
  | { type: "cancel"; id: string; reason?: string }
  | { type: "refuse"; item: { id: string; name: string; size: number }; error: string }
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
    case "commit":
      return patch(state, action.id, (i) => (i.status === "uploading" ? { ...i, committed: true } : i));
    case "cancel":
      return patch(state, action.id, (i) =>
        (i.status === "queued" || i.status === "uploading") && !i.committed
          ? { ...i, status: "canceled", error: action.reason }
          : i,
      );
    case "refuse":
      return [
        ...state,
        { id: action.item.id, name: action.item.name, size: action.item.size, sent: 0, status: "failed", error: action.error },
      ];
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
