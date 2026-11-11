"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { useCrm, usePanelActive, type CrmSignalKind } from "./crm-context";
import {
  createZuStore, newIdem, zuKey, DEFAULT_POLL_MS,
  type ZuCaller, type ZuError, type ZuLimits, type ZuPages, type ZuPaged, type ZuReadArgs, type ZuSnapshot,
  type ZuWriteArgs, type ZuWriteResult,
} from "./zu-store";

/* React hooks over the pure store in zu-store.ts. One store per browser tab, in
   memory only: nothing from Zuops is put in localStorage or sessionStorage. */

export { newIdem };
export type { ZuError, ZuLimits, ZuPages, ZuPaged, ZuReadArgs, ZuWriteArgs, ZuWriteResult };

const store = createZuStore();
const EMPTY: ZuSnapshot = { data: undefined, error: null, fetchedAt: null, inflight: false };
const noSubscribe = () => () => undefined;

let attached = false;
function attachWindow() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("focus", () => store.focus());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") store.focus();
  });
}

function useCaller() {
  const call: ZuCaller = useAction(api.crm.call);
  React.useEffect(() => {
    store.setCaller(call);
    attachWindow();
  }, [call]);
}

/** Drop every cached Zuops answer (on lost access or sign-out). */
export function clearZuCache() {
  store.clear();
}

export type ZuReadOptions = {
  /** Refetch when the newest webhook pulse of one of these kinds moves. */
  kinds?: CrmSignalKind[];
  /** Background refresh while the page is visible. Default 60 s; 0 turns it off. */
  pollMs?: number;
  enabled?: boolean;
  /** Walk an offset-paged list into `{ items, truncated }`. Counts as one request
   *  for the throttle. */
  pages?: ZuPages;
  /** Keep showing the previous arguments' data while new arguments load
   *  (pagination, search). */
  keepPrevious?: boolean;
};

export type ZuRead<T> = {
  data: T | undefined;
  error: ZuError | null;
  /** Nothing to show yet. */
  loading: boolean;
  /** Showing data while a newer copy loads. */
  refreshing: boolean;
  fetchedAt: number | null;
  refresh: () => void;
};

export function useZuRead<T>(op: string | null, args?: ZuReadArgs, opts?: ZuReadOptions): ZuRead<T> {
  useCaller();
  const active = usePanelActive();
  const { signal } = useCrm();
  const enabled = (opts?.enabled ?? true) && op !== null;
  const key = op ? zuKey(op, args, opts?.pages) : null;
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;

  const subscribe = React.useCallback(
    (fn: () => void) => (key ? store.subscribe(key, fn) : noSubscribe()),
    [key],
  );
  const get = React.useCallback(() => (key ? store.snapshot(key) : EMPTY), [key]);
  const snap = React.useSyncExternalStore(subscribe, get, get);

  React.useEffect(() => {
    if (!key || !enabled || !active) return;
    return store.watch(key, pollMs);
  }, [key, enabled, active, pollMs]);

  const kinds = opts?.kinds;
  const sig = signal && kinds && kinds.length ? Math.max(...kinds.map((k) => signal[k] ?? 0)) : null;
  React.useEffect(() => {
    if (key && enabled && active && sig !== null) store.signal(key, sig);
  }, [key, enabled, active, sig]);

  // keepPrevious: remember the last snapshot that had data (render-time state
  // adjustment, the pattern React documents for derived state).
  const [held, setHeld] = React.useState<ZuSnapshot>(EMPTY);
  if (opts?.keepPrevious && snap.data !== undefined && held !== snap) setHeld(snap);

  const refresh = React.useCallback(() => {
    if (key) void store.request(key, "user");
  }, [key]);

  const showHeld = !!opts?.keepPrevious && snap.data === undefined && held.data !== undefined && snap.error === null;
  const shown = showHeld ? held : snap;
  return {
    data: shown.data as T | undefined,
    error: snap.error,
    loading: enabled && shown.data === undefined && snap.error === null,
    refreshing: (snap.inflight && snap.data !== undefined) || (showHeld && enabled),
    fetchedAt: shown.fetchedAt,
    refresh,
  };
}

export type ZuRun = (
  op: string,
  args?: ZuWriteArgs,
  opts?: { invalidate?: readonly string[] },
) => Promise<ZuWriteResult>;

/** Writes through `api.crm.call`. Each run carries an Idempotency-Key (a new one
 *  unless `idem` is given); an identical run while one is pending is the same
 *  request. `confirm` may only come from ConfirmDialog (crm-ui.tsx). */
export function useZuWrite(): { run: ZuRun; pending: boolean } {
  useCaller();
  const [pending, setPending] = React.useState(0);
  const run = React.useCallback<ZuRun>(async (op, args, opts) => {
    setPending((n) => n + 1);
    try {
      return await store.run(op, args ?? {}, opts ?? {});
    } finally {
      setPending((n) => n - 1);
    }
  }, []);
  return { run, pending: pending > 0 };
}

/** A one-off read outside render (e.g. find the lead a 409 pointed at). Goes
 *  through the cache, forced fresh. */
export function useZuFetch(): <T>(op: string, args?: ZuReadArgs) => Promise<{ data: T | undefined; error: ZuError | null }> {
  useCaller();
  return React.useCallback(async <T,>(op: string, args?: ZuReadArgs) => {
    const s = await store.load(zuKey(op, args), "user");
    return { data: s.data as T | undefined, error: s.error };
  }, []);
}
