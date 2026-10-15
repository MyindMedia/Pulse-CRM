"use client";

import * as React from "react";
import { useQueries, type RequestForQueries } from "convex/react";
import type { Value } from "convex/values";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import {
  type BootRecord,
  type BootStorage,
  type BootTheme,
  clearBootCache,
  queryKey,
  readBootRecord,
  safeStorage,
  writeBootRecord,
} from "./boot-cache";
import { useHydrated } from "./use-hydrated";
import { useBootUserId } from "./boot-user";

/*
 * The runtime side of the boot cache (src/lib/boot-cache.ts): one store per
 * signed-in person, a hook that reads a query live-or-cached, and the
 * context that says whether the tree is the inert boot preview or the live
 * app.
 *
 *  - Boot mode: the session is not confirmed yet. Queries are SKIPPED (an
 *    unauthenticated call would throw) and the hook answers from the cache.
 *    The boot shell renders this tree `inert`, so nothing in it can be
 *    clicked, focused or submitted.
 *  - Live mode: the session is confirmed. Queries run; until each answers,
 *    the hook hands back the cached value and reports the tile stale, which
 *    makes that tile inert too. Live answers are recorded for next time.
 */

const FLUSH_MS = 800;

export class BootSnapshotStore {
  readonly userId: string;
  private storage: BootStorage | null;
  private record: BootRecord | null;
  private orgId: string | null = null;
  private pending: Record<string, unknown> = {};
  private theme: BootTheme | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(userId: string, storage: BootStorage | null) {
    this.userId = userId;
    this.storage = storage;
    // Opening the cache as this person wipes everyone else's record: a
    // different account on this browser must never see the last one's data.
    clearBootCache(storage, userId);
    this.record = readBootRecord(storage, userId);
  }

  /** True when there is a cached dashboard to show. */
  hasData(): boolean {
    return !!this.record && Object.keys(this.record.queries).length > 0;
  }

  get(key: string): unknown {
    return this.record?.queries[key];
  }

  cachedOrgId(): string | null {
    return this.record?.orgId ?? null;
  }

  /** The live org. A record for another studio is dropped (org switch). */
  setOrg(orgId: string) {
    if (this.orgId === orgId) return;
    this.orgId = orgId;
    if (this.record && this.record.orgId !== orgId) {
      this.record = null;
      this.wipeStorage();
    }
    if (Object.keys(this.pending).length || this.theme) this.schedule();
  }

  put(key: string, value: unknown) {
    this.pending[key] = value;
    if (this.orgId) this.schedule();
  }

  setTheme(theme: BootTheme | undefined) {
    if (!theme) return;
    this.theme = theme;
    if (this.orgId) this.schedule();
  }

  /** Drops the cache for this person (a cached value failed to render). */
  invalidate() {
    this.record = null;
    this.wipeStorage();
  }

  private wipeStorage() {
    clearBootCache(this.storage, null);
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.orgId) return;
    const base = this.record && this.record.orgId === this.orgId ? this.record.queries : {};
    const next: BootRecord = {
      v: 1,
      userId: this.userId,
      orgId: this.orgId,
      savedAt: Date.now(),
      theme: this.theme ?? this.record?.theme,
      queries: { ...base, ...this.pending },
    };
    // The in-memory record keeps answering reads for this page; storage is
    // what the next cold load sees.
    writeBootRecord(this.storage, next);
  }
}

let shared: BootSnapshotStore | null = null;

/** The one store for this tab and person (a new person replaces it). */
export function bootSnapshotStore(userId: string | null): BootSnapshotStore | null {
  if (!userId || typeof window === "undefined") return null;
  if (!shared || shared.userId !== userId) shared = new BootSnapshotStore(userId, safeStorage());
  return shared;
}

/** Sign-out: forget the store and every record on this browser. */
export function wipeBootSnapshots() {
  shared = null;
  clearBootCache(safeStorage(), null);
}

type Mode = "boot" | "live";
const StoreContext = React.createContext<BootSnapshotStore | null>(null);
const ModeContext = React.createContext<Mode>("live");
const TileContext = React.createContext<((id: string, stale: boolean) => void) | null>(null);

/** The app shell: opens this person's boot cache. */
export function BootSnapshotProvider({ children }: { children: React.ReactNode }) {
  const userId = useBootUserId();
  const [store] = React.useState(() => bootSnapshotStore(userId));
  React.useEffect(() => {
    if (!store) return;
    const flush = () => store.flush();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [store]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/** The store, withheld until hydration so the first client render matches the server's. */
export function useBootSnapshotStore(): BootSnapshotStore | null {
  const store = React.useContext(StoreContext);
  return useHydrated() ? store : null;
}

/** Renders its subtree as the inert boot preview: queries skipped, cache only. */
export function BootMode({ children }: { children: React.ReactNode }) {
  return <ModeContext.Provider value="boot">{children}</ModeContext.Provider>;
}

export function useBootMode(): boolean {
  return React.useContext(ModeContext) === "boot";
}

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * useQuery, plus the boot cache: the live result when there is one, else the
 * value this person's dashboard last rendered (or undefined). In boot mode the
 * live query is skipped entirely. A query error throws, like useQuery.
 */
export function useSnapshotQuery<Q extends FunctionReference<"query">>(
  query: Q,
  args: FunctionArgs<Q> | "skip",
): FunctionReturnType<Q> | undefined {
  const { value, error } = useSnapshotQueryResult(query, args);
  if (error) throw error;
  return value;
}

/**
 * useSnapshotQuery that hands a query error back instead of throwing, for a
 * caller with a fallback (for example a query the deployed backend may not
 * have yet while the site and Convex deploy one after the other).
 */
export function useSnapshotQueryResult<Q extends FunctionReference<"query">>(
  query: Q,
  args: FunctionArgs<Q> | "skip",
): { value: FunctionReturnType<Q> | undefined; error: Error | null } {
  const boot = useBootMode();
  const store = useBootSnapshotStore();
  const skip = args === "skip" || boot;
  const key = args === "skip" ? null : queryKey(getFunctionName(query), args);
  // Keyed on the serialized args, as useQuery does, so a new args object with
  // the same values never resubscribes.
  const requests = React.useMemo(
    (): RequestForQueries => (skip ? {} : { q: { query, args: args as Record<string, Value> } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skip, key],
  );
  const raw = useQueries(requests).q as FunctionReturnType<Q> | Error | undefined;
  const error = raw instanceof Error ? raw : null;
  const live = raw instanceof Error ? undefined : raw;
  const cached = live === undefined && key && store ? (store.get(key) as FunctionReturnType<Q> | undefined) : undefined;

  React.useEffect(() => {
    if (!boot && store && key && live !== undefined) store.put(key, live);
  }, [boot, store, key, live]);

  const report = React.useContext(TileContext);
  const id = React.useId();
  const stale = live === undefined && cached !== undefined && !error;
  useIsoLayoutEffect(() => {
    report?.(id, stale);
  }, [report, id, stale]);
  useIsoLayoutEffect(() => () => report?.(id, false), [report, id]);

  return { value: live ?? (error ? undefined : cached), error };
}

/**
 * Wraps one dashboard tile. While any query inside it is showing a cached
 * value, the tile is inert (no clicks, no focus, no submits) and marked
 * data-snapshot; it goes live the moment every query has answered.
 */
export function SnapshotTile({ className, children }: { className?: string; children: React.ReactNode }) {
  const [staleIds, setStaleIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const report = React.useCallback((id: string, stale: boolean) => {
    setStaleIds((prev) => {
      if (prev.has(id) === stale) return prev;
      const next = new Set(prev);
      if (stale) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const stale = staleIds.size > 0;
  return (
    <TileContext.Provider value={report}>
      <div className={className} inert={stale || undefined} data-snapshot={stale ? "" : undefined} aria-busy={stale || undefined}>
        <SnapshotBoundary>{children}</SnapshotBoundary>
      </div>
    </TileContext.Provider>
  );
}

/**
 * A cached value from an older build can have a shape the current code does
 * not expect. If a render throws, drop the cache and try once more without
 * it; a second failure is a real error and goes to the shell's boundary.
 */
export class SnapshotBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { failed: boolean; retried: boolean; error: unknown }
> {
  static contextType = StoreContext;
  declare context: BootSnapshotStore | null;
  state = { failed: false, retried: false, error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  componentDidCatch() {
    this.context?.invalidate();
  }

  componentDidUpdate() {
    if (this.state.failed && !this.state.retried && this.props.fallback === undefined) {
      this.setState({ failed: false, retried: true });
    }
  }

  render() {
    if (this.state.failed) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      if (this.state.retried) throw this.state.error;
      return null;
    }
    return this.props.children;
  }
}
