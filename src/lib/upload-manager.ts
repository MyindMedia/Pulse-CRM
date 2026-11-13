import { MAX_PARALLEL, queueReducer, type QueueAction, type QueueItem } from "./upload-queue";

/* The session upload store (F2-20). It lives at module level, outside React,
   so an upload keeps running, and a queued one keeps starting, after the
   session panel that started it closes. Components read it with
   useSyncExternalStore (see useSessionUploads in
   src/components/calendar/session-upload-queue.tsx).

   - Rows are kept per booking (sessionId). Each task is captured whole when it
     is added (its booking, file and the calls to make), so a second booking's
     uploads can never land on the first.
   - At most MAX_PARALLEL uploads run at once across every booking, oldest
     first.
   - The beforeunload guard is held by the store while anything is queued or
     running, whether or not a panel is open.
   - A finished row clears after DONE_LINGER_MS; failed and canceled rows stay
     until dismissed.
   - One short announcement per booking (for a role="status" node) says what
     just happened: started, uploaded, failed, canceled, plus whatever the
     section's other controls pass to say(). */

export const DONE_LINGER_MS = 4000;
const PROGRESS_EVERY_MS = 120;
/** Events this close together are read out as one announcement. */
const ANNOUNCE_JOIN_MS = 1500;

export type UploadContext = {
  signal: AbortSignal;
  onProgress: (sent: number, total: number) => void;
  /** The point of no return. Throws an AbortError when the upload was already
   *  canceled; after it returns, cancel is ignored and the row ends Uploaded. */
  commit: () => void;
};

export type UploadTask = {
  name: string;
  size: number;
  /** Does the whole upload. Throw to fail the row; an AbortError (or an aborted
   *  signal) before commit counts as a cancel. */
  run: (ctx: UploadContext) => Promise<void>;
  /** The line shown on a failed row. Never a raw browser error. */
  errorText: (err: unknown) => string;
  onDone?: () => void;
};

type UnloadTarget = {
  addEventListener: (type: "beforeunload", fn: (e: Event) => void) => void;
  removeEventListener: (type: "beforeunload", fn: (e: Event) => void) => void;
};

export type UploadManagerOptions = {
  now?: () => number;
  newId?: () => string;
  unloadTarget?: UnloadTarget | null;
};

export const NO_ROWS: readonly QueueItem[] = Object.freeze([]);

function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

function abortError(): DOMException {
  return new DOMException("Upload canceled.", "AbortError");
}

export function createUploadManager(opts: UploadManagerOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const unloadTarget = opts.unloadTarget ?? null;

  /** Rows per booking. Each array is replaced, never mutated. */
  const rowsBySession = new Map<string, readonly QueueItem[]>();
  /** Which booking a row is on, for every row that still exists. */
  const sessionOf = new Map<string, string>();
  /** Work not yet finished, in the order it was added (Map keeps it). */
  const work = new Map<string, { sessionId: string; task: UploadTask; controller?: AbortController }>();
  const announcements = new Map<string, { text: string; at: number }>();
  const listeners = new Set<() => void>();
  let guarded = false;

  const warn = (e: Event) => {
    e.preventDefault();
    // Older Safari and Chrome only ask when returnValue is set.
    (e as BeforeUnloadEvent).returnValue = "";
  };

  function row(id: string): QueueItem | undefined {
    const sessionId = sessionOf.get(id);
    return sessionId ? rowsBySession.get(sessionId)?.find((r) => r.id === id) : undefined;
  }

  function busy(): boolean {
    for (const rows of rowsBySession.values()) {
      if (rows.some((r) => r.status === "queued" || r.status === "uploading")) return true;
    }
    return false;
  }

  function emit() {
    const active = busy();
    if (unloadTarget && active !== guarded) {
      if (active) unloadTarget.addEventListener("beforeunload", warn);
      else unloadTarget.removeEventListener("beforeunload", warn);
      guarded = active;
    }
    for (const fn of [...listeners]) fn();
  }

  function apply(sessionId: string, action: QueueAction) {
    const before = rowsBySession.get(sessionId) ?? NO_ROWS;
    const after = queueReducer(before as QueueItem[], action);
    if (after.length === 0) rowsBySession.delete(sessionId);
    else rowsBySession.set(sessionId, after);
  }

  function announce(sessionId: string, text: string) {
    const prev = announcements.get(sessionId);
    const t = now();
    announcements.set(sessionId, { text: prev && t - prev.at < ANNOUNCE_JOIN_MS ? `${prev.text} ${text}` : text, at: t });
  }

  function removeRow(id: string) {
    const sessionId = sessionOf.get(id);
    if (!sessionId) return;
    apply(sessionId, { type: "remove", id });
    sessionOf.delete(id);
    work.delete(id);
  }

  function pump() {
    let running = 0;
    for (const w of work.values()) if (w.controller) running++;
    for (const [id, w] of work) {
      if (running >= MAX_PARALLEL) break;
      if (w.controller || row(id)?.status !== "queued") continue;
      start(id, w);
      running++;
    }
  }

  function start(id: string, w: { sessionId: string; task: UploadTask; controller?: AbortController }) {
    const { sessionId, task } = w;
    const controller = new AbortController();
    w.controller = controller;
    apply(sessionId, { type: "start", id, at: now() });
    announce(sessionId, `Uploading ${task.name}.`);
    let lastTick = 0;
    const ctx: UploadContext = {
      signal: controller.signal,
      onProgress: (sent, total) => {
        const t = now();
        if (sent < total && t - lastTick < PROGRESS_EVERY_MS) return;
        lastTick = t;
        apply(sessionId, { type: "progress", id, sent });
        emit();
      },
      commit: () => {
        if (controller.signal.aborted) throw abortError();
        apply(sessionId, { type: "commit", id });
        emit();
      },
    };

    void Promise.resolve()
      .then(() => task.run(ctx))
      .then(
        () => {
          if (controller.signal.aborted && !row(id)?.committed) throw abortError();
          apply(sessionId, { type: "done", id });
          announce(sessionId, `Uploaded ${task.name}.`);
          try {
            task.onDone?.();
          } catch {
            /* a toast failing must not undo a finished upload */
          }
          setTimeout(() => {
            if (row(id)?.status === "done") {
              removeRow(id);
              emit();
            }
          }, DONE_LINGER_MS);
        },
      )
      .catch((err: unknown) => {
        const current = row(id);
        if (!current || current.status !== "uploading") return; // canceled already, and announced then
        if ((isAbort(err) || controller.signal.aborted) && !current.committed) {
          apply(sessionId, { type: "cancel", id });
          announce(sessionId, `Canceled ${task.name}.`);
          return;
        }
        const message = task.errorText(err);
        // A committed row cannot be canceled, so it fails like any other.
        apply(sessionId, { type: "fail", id, error: message });
        announce(sessionId, `Could not upload ${task.name}. ${message}`);
      })
      .finally(() => {
        // Let go of the file. The row (if any) stays until it clears.
        work.delete(id);
        pump();
        emit();
      });
  }

  return {
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    /** This booking's rows. The same array until something changes. */
    rows(sessionId: string): readonly QueueItem[] {
      return rowsBySession.get(sessionId) ?? NO_ROWS;
    },

    /** The latest announcement for this booking, or "". */
    announcement(sessionId: string): string {
      return announcements.get(sessionId)?.text ?? "";
    },

    busy,

    add(sessionId: string, tasks: UploadTask[]) {
      if (tasks.length === 0) return;
      const items = tasks.map((task) => {
        const id = newId();
        sessionOf.set(id, sessionId);
        work.set(id, { sessionId, task });
        return { id, name: task.name || "upload", size: task.size };
      });
      apply(sessionId, { type: "add", items });
      pump();
      emit();
    },

    /** A row that is refused before it starts (a dropped folder). */
    refuse(sessionId: string, name: string, message: string) {
      const id = newId();
      sessionOf.set(id, sessionId);
      apply(sessionId, { type: "refuse", item: { id, name: name || "upload", size: 0 }, error: message });
      announce(sessionId, `Could not upload ${name || "upload"}. ${message}`);
      emit();
    },

    cancel(id: string) {
      const current = row(id);
      const sessionId = sessionOf.get(id);
      if (!current || !sessionId || current.committed) return;
      if (current.status !== "queued" && current.status !== "uploading") return;
      const w = work.get(id);
      apply(sessionId, { type: "cancel", id });
      announce(sessionId, `Canceled ${current.name}.`);
      if (w?.controller) w.controller.abort();
      else work.delete(id); // never started: nothing to stop
      pump();
      emit();
    },

    /** A result from another control in the same Files section (the Final
     *  toggle, the delivery card), read out by the section's one
     *  role="status" node alongside the upload events. */
    say(sessionId: string, text: string) {
      const line = text.trim();
      if (!line) return;
      announce(sessionId, line);
      emit();
    },

    /** Drop a finished, failed or canceled row. */
    dismiss(id: string) {
      const current = row(id);
      if (!current || current.status === "queued" || current.status === "uploading") return;
      removeRow(id);
      emit();
    },
  };
}

export type UploadManager = ReturnType<typeof createUploadManager>;

/** The one store the app uses. */
export const uploads: UploadManager = createUploadManager({
  unloadTarget: typeof window !== "undefined" ? window : null,
});

/** A dropped item that is a folder. Must be read inside the drop event. */
export function isFolderDrop(item: { webkitGetAsEntry?: () => { isDirectory: boolean } | null }): boolean {
  try {
    return item.webkitGetAsEntry?.()?.isDirectory === true;
  } catch {
    return false;
  }
}
