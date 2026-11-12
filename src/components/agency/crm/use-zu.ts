"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { useCrm, usePanelActive, type CrmSignalKind } from "./crm-context";
import {
  createZuStore, newIdem, stableStringify, zuKey, EMPTY_SNAPSHOT, PAGED_POLL_MS,
  type ZuCaller, type ZuError, type ZuLimits, type ZuPages, type ZuPaged, type ZuReadArgs, type ZuSnapshot,
  type ZuWriteArgs, type ZuWriteResult,
} from "./zu-store";

/* React hooks over the pure store in zu-store.ts. One store per browser tab, in
   memory only: nothing from Zuops is put in localStorage or sessionStorage. */

export { newIdem, stableStringify, PAGED_POLL_MS };
export type { ZuError, ZuLimits, ZuPages, ZuPaged, ZuReadArgs, ZuWriteArgs, ZuWriteResult };

const store = createZuStore();
const EMPTY: ZuSnapshot = EMPTY_SNAPSHOT;
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

/** Drop every cached Zuops answer (on lost access, sign-out, a different signed-in
 *  user, or leaving the CRM). Requests still in flight cannot write back. */
export function clearZuCache() {
  store.clear();
}

/** Name the signed-in user the cache belongs to. Call it during render, before
 *  any CRM read: when it changes, every read after it starts empty (R3-U4). */
export function setZuOwner(owner: string) {
  store.setOwner(owner);
}

/** An Idempotency-Key for a form (F-U9, F-U11). The same fingerprint always gets
 *  the same key for the life of the component, so an identical retry after a
 *  failure reuses it, and any change to the values gets a different key.
 *  `valuesFingerprint` is a string of everything the request sends (for example
 *  `stableStringify(body)`); fold a counter you bump after each success into it,
 *  so the next submit after a success gets a fresh key:
 *    const [round, setRound] = useState(0);
 *    const idem = useIdemFor(`${round}|${stableStringify(body)}`);
 *    ... on success: setRound((n) => n + 1) */
export function useIdemFor(valuesFingerprint: string): string {
  const [state, setState] = React.useState<IdemState>(() => idemStep(null, valuesFingerprint, newIdem));
  if (state.fp !== valuesFingerprint) {
    // Render-time adjustment (React's documented pattern for derived state).
    const next = idemStep(state, valuesFingerprint, newIdem);
    setState(next);
    return next.keys[valuesFingerprint];
  }
  return state.keys[valuesFingerprint];
}

export type IdemState = { fp: string; keys: Readonly<Record<string, string>> };

/** The pure step behind useIdemFor: a known fingerprint keeps its key, a new one
 *  gets `make()`. */
export function idemStep(state: IdemState | null, fp: string, make: () => string): IdemState {
  if (state && state.fp === fp) return state;
  const keys = state?.keys ?? {};
  return { fp, keys: fp in keys ? keys : { ...keys, [fp]: make() } };
}

export type ZuReadOptions = {
  /** Refetch when the newest webhook pulse of one of these kinds moves. */
  kinds?: CrmSignalKind[];
  /** Background refresh while the page is visible. Default 60 s (300 s with
   *  `pages`); 0 turns it off. */
  pollMs?: number;
  enabled?: boolean;
  /** An offset-paged list as ZuPaged: page 1 first, then the rest while
   *  `has_more`. Polls and signals re-read page 1 only and merge by id; Refresh
   *  walks every page again. Every page counts toward the request budget. */
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
  /** `data` belongs to the previous arguments (keepPrevious) while the new ones
   *  load: do not label it as the new page. */
  held: boolean;
  fetchedAt: number | null;
  /** When the fetch behind `data` started (compare optimistic edits to this). */
  startedAt: number | null;
  refresh: () => void;
};

export function useZuRead<T>(op: string | null, args?: ZuReadArgs, opts?: ZuReadOptions): ZuRead<T> {
  useCaller();
  const active = usePanelActive();
  const { signal } = useCrm();
  const enabled = (opts?.enabled ?? true) && op !== null;
  const key = op ? zuKey(op, args, opts?.pages) : null;
  const pollMs = opts?.pollMs;

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
    held: showHeld,
    fetchedAt: shown.fetchedAt,
    startedAt: shown.startedAt,
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
