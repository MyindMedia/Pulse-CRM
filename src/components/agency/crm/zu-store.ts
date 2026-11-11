/* The pure core behind useZuRead / useZuWrite: a small in-memory cache and request
   scheduler for `api.crm.call`. No React and no Convex in here, so it can be unit
   tested with fake timers (use-zu.test.ts).

   Rules it keeps (design.md Addendum D2, eval P-02, P-03, X-02):
   - A read younger than FRESH_MS (30 s) is served from memory with no call, so
     revisiting a tab inside 30 s costs nothing.
   - One in-flight request per key; everyone asking for the same key shares it.
   - Stale data stays visible while a refetch runs, and stays after a failed one.
   - Background refetches (focus, interval, webhook signal) are spaced at least
     MIN_GAP_MS apart per key, and no key ever makes more than MAX_PER_MINUTE calls
     in a rolling minute. A screen reads at most three keys, so a screen stays at
     or under 12 background requests a minute.
   - The interval does nothing while the page is hidden.
   - A write with the same op and arguments while one is pending returns the same
     promise (a double click is one request), and carries an Idempotency-Key.
   - Nothing is written to localStorage or sessionStorage, and no response body is
     ever logged. */

export type ZuLimits = {
  contactsLimit?: number;
  contactsUsed?: number;
  contactsRemaining?: number;
  rateRemaining?: number;
};

export type ZuQuery = Record<string, string | number | boolean>;
export type ZuPath = Record<string, string>;

export type ZuCallArgs = {
  op: string;
  path?: ZuPath;
  query?: ZuQuery;
  body?: unknown;
  idem?: string;
  confirm?: boolean;
};

export type ZuCallResult = {
  ok: boolean;
  status: number;
  json: string | null;
  reason?: string;
  code?: string;
  retryAfter?: number;
  limits: ZuLimits;
};

export type ZuCaller = (args: ZuCallArgs) => Promise<ZuCallResult>;

export type ZuError = { reason: string; code?: string; status: number };

/** Read arguments. Query values that are undefined, null or "" are dropped, so a
 *  cleared filter and a missing filter share one cache entry. */
export type ZuReadArgs = {
  path?: ZuPath;
  query?: Record<string, string | number | boolean | null | undefined>;
};

/** Walk an offset-paged list (`has_more` / `next_offset`) into one result. */
export type ZuPages = { listKey: string; limit: number; max: number };
export type ZuPaged<T> = { items: T[]; truncated: boolean };

export type ZuSnapshot = {
  data: unknown;
  error: ZuError | null;
  fetchedAt: number | null;
  inflight: boolean;
};

export type ZuWriteArgs = {
  path?: ZuPath;
  query?: ZuQuery;
  body?: unknown;
  idem?: string;
  confirm?: boolean;
};

export type ZuWriteResult = {
  ok: boolean;
  /** The answer's data; on a refusal, Zuops's `details` when it sent them (for
   *  example `{ lead_id, matched_on }` on a duplicate lead). */
  data?: unknown;
  reason?: string;
  code?: string;
  status: number;
  retryAfter?: number;
  limits: ZuLimits;
};

export type FetchReason = "mount" | "user" | "focus" | "interval" | "signal" | "invalidate";

export const FRESH_MS = 30_000;
export const MIN_GAP_MS = 15_000;
export const MAX_PER_MINUTE = 12;
export const DEFAULT_POLL_MS = 60_000;
const MINUTE = 60_000;
const MAX_ENTRIES = 150;

export const UNREACHABLE = "Could not reach Zuops through Pulse. Check your connection and try again.";
export const UNREADABLE = "Zuops sent an answer Pulse could not read.";
export const FORBIDDEN = "The CRM is limited to Pulse agency owners and admins.";

/** The action threw instead of answering: lost access (FORBIDDEN) or no network.
 *  The error text is only matched, never shown or logged. */
function thrown(err: unknown): ZuError {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/FORBIDDEN|UNAUTHENTICATED|Not signed in/i.test(msg)) return { reason: FORBIDDEN, code: "forbidden", status: 403 };
  return { reason: UNREACHABLE, code: "unreachable", status: 0 };
}

const EMPTY: ZuSnapshot = Object.freeze({ data: undefined, error: null, fetchedAt: null, inflight: false }) as ZuSnapshot;

/** JSON with sorted keys and no undefined values: equal arguments, equal string. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortDeep(v);
    }
    return out;
  }
  return value;
}

function cleanQuery(q: ZuReadArgs["query"]): ZuQuery | undefined {
  if (!q) return undefined;
  const out: ZuQuery = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

type KeyParts = { op: string; path?: ZuPath; query?: ZuQuery; pages?: ZuPages };

/** The cache key for a read. It is plain JSON, so the store can rebuild the
 *  request from the key alone. */
export function zuKey(op: string, args?: ZuReadArgs, pages?: ZuPages): string {
  const parts: KeyParts = { op };
  if (args?.path && Object.keys(args.path).length) parts.path = args.path;
  const query = cleanQuery(args?.query);
  if (query) parts.query = query;
  if (pages) parts.pages = pages;
  return stableStringify(parts);
}

export function newIdem(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

class ZuFailure {
  constructor(readonly error: ZuError, readonly retryAfter?: number) {}
}

function failureOf(res: ZuCallResult): ZuFailure {
  return new ZuFailure(
    { reason: res.reason || `Zuops answered ${res.status}.`, code: res.code, status: res.status },
    res.retryAfter,
  );
}

function parse(json: string | null): unknown {
  if (json === null) return null;
  try {
    return JSON.parse(json);
  } catch {
    throw new ZuFailure({ reason: UNREADABLE, code: "bad_json", status: 200 });
  }
}

type Entry = {
  key: string;
  parts: KeyParts;
  snap: ZuSnapshot;
  inflight: Promise<void> | null;
  again: FetchReason | null;
  listeners: Set<() => void>;
  watchers: number;
  calls: number[];
  lastSignal: number | undefined;
  stale: boolean;
  blockedUntil: number;
  trailing: ReturnType<typeof setTimeout> | null;
  touched: number;
};

export type ZuStoreOptions = {
  call?: ZuCaller;
  now?: () => number;
  isVisible?: () => boolean;
  freshMs?: number;
  minGapMs?: number;
  maxPerMinute?: number;
};

const FORCED: ReadonlySet<FetchReason> = new Set(["user", "signal", "invalidate"]);
const BACKGROUND: ReadonlySet<FetchReason> = new Set(["focus", "interval", "signal"]);

export function defaultIsVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export function createZuStore(opts: ZuStoreOptions = {}) {
  let caller: ZuCaller | undefined = opts.call;
  const now = opts.now ?? (() => Date.now());
  const isVisible = opts.isVisible ?? defaultIsVisible;
  const freshMs = opts.freshMs ?? FRESH_MS;
  const minGapMs = opts.minGapMs ?? MIN_GAP_MS;
  const maxPerMinute = opts.maxPerMinute ?? MAX_PER_MINUTE;

  const entries = new Map<string, Entry>();
  const pendingWrites = new Map<string, Promise<ZuWriteResult>>();
  const writeListeners = new Set<() => void>();

  function entry(key: string): Entry {
    let e = entries.get(key);
    if (!e) {
      evict();
      e = {
        key,
        parts: JSON.parse(key) as KeyParts,
        snap: EMPTY,
        inflight: null,
        again: null,
        listeners: new Set(),
        watchers: 0,
        calls: [],
        lastSignal: undefined,
        stale: false,
        blockedUntil: 0,
        trailing: null,
        touched: now(),
      };
      entries.set(key, e);
    }
    return e;
  }

  function evict() {
    if (entries.size < MAX_ENTRIES) return;
    const idle = [...entries.values()]
      .filter((e) => e.listeners.size === 0 && e.watchers === 0 && !e.inflight)
      .sort((a, b) => a.touched - b.touched);
    for (const e of idle.slice(0, entries.size - MAX_ENTRIES + 1)) {
      if (e.trailing) clearTimeout(e.trailing);
      entries.delete(e.key);
    }
  }

  function emit(e: Entry) {
    for (const fn of [...e.listeners]) fn();
  }

  function setSnap(e: Entry, next: ZuSnapshot) {
    e.snap = next;
    emit(e);
  }

  async function fetchOnce(parts: KeyParts, query?: ZuQuery): Promise<unknown> {
    if (!caller) throw new ZuFailure({ reason: UNREACHABLE, code: "no_caller", status: 0 });
    let res: ZuCallResult;
    try {
      res = await caller({ op: parts.op, path: parts.path, query });
    } catch (err) {
      throw new ZuFailure(thrown(err));
    }
    if (!res.ok) throw failureOf(res);
    return parse(res.json);
  }

  async function fetchPages(parts: KeyParts, pages: ZuPages): Promise<ZuPaged<unknown>> {
    const items: unknown[] = [];
    let offset = 0;
    let more = true;
    while (more && items.length < pages.max) {
      const data = (await fetchOnce(parts, { ...(parts.query ?? {}), limit: pages.limit, offset })) as Record<string, unknown> | null;
      const list = Array.isArray(data?.[pages.listKey]) ? (data![pages.listKey] as unknown[]) : [];
      items.push(...list);
      const next = data?.next_offset;
      more = data?.has_more === true && typeof next === "number" && list.length > 0;
      if (more) offset = next as number;
    }
    return { items: items.slice(0, pages.max), truncated: more || items.length > pages.max };
  }

  function scheduleTrailing(e: Entry, at: number, reason: FetchReason) {
    if (e.trailing) return;
    e.trailing = setTimeout(() => {
      e.trailing = null;
      if (e.watchers > 0 || reason === "invalidate") void request(e.key, reason);
    }, Math.max(0, at - now()));
  }

  function request(key: string, reason: FetchReason): Promise<void> {
    const e = entry(key);
    e.touched = now();
    if (e.inflight) {
      if (FORCED.has(reason)) e.again = reason;
      return e.inflight;
    }
    if (!caller) return Promise.resolve();
    const t = now();
    const fresh = e.snap.fetchedAt !== null && t - e.snap.fetchedAt < freshMs && !e.stale;
    if (fresh && !FORCED.has(reason)) return Promise.resolve();
    if (t < e.blockedUntil && reason !== "user") return Promise.resolve();

    e.calls = e.calls.filter((c) => t - c < MINUTE);
    const last = e.calls[e.calls.length - 1];
    if (BACKGROUND.has(reason) && last !== undefined && t - last < minGapMs) {
      // Too soon after the last call. A signal means data really changed, so it
      // is kept and run once the gap is over; focus and interval are dropped.
      if (reason === "signal") scheduleTrailing(e, last + minGapMs, reason);
      return Promise.resolve();
    }
    if (e.calls.length >= maxPerMinute) {
      if (FORCED.has(reason)) scheduleTrailing(e, e.calls[0] + MINUTE, reason);
      return Promise.resolve();
    }
    e.calls.push(t);
    if (e.trailing) {
      clearTimeout(e.trailing);
      e.trailing = null;
    }

    setSnap(e, { ...e.snap, inflight: true });
    const parts = e.parts;
    e.inflight = (async () => {
      try {
        const data = parts.pages ? await fetchPages(parts, parts.pages) : await fetchOnce(parts, parts.query);
        e.stale = false;
        e.snap = { data, error: null, fetchedAt: now(), inflight: false };
      } catch (err) {
        const f = err instanceof ZuFailure ? err : new ZuFailure({ reason: UNREACHABLE, status: 0 });
        if (f.retryAfter && f.retryAfter > 0) e.blockedUntil = now() + f.retryAfter * 1000;
        e.snap = { ...e.snap, error: f.error, inflight: false };
      } finally {
        e.inflight = null;
        emit(e);
        const again = e.again;
        e.again = null;
        if (again) void request(key, again);
      }
    })();
    return e.inflight;
  }

  function invalidate(ops: readonly string[]) {
    if (!ops.length) return;
    const set = new Set(ops);
    for (const e of entries.values()) {
      if (!set.has(e.parts.op)) continue;
      e.stale = true;
      if (e.watchers > 0) void request(e.key, "invalidate");
    }
  }

  function emitWrites() {
    for (const fn of [...writeListeners]) fn();
  }

  return {
    setCaller(fn: ZuCaller) {
      caller = fn;
    },
    hasCaller() {
      return caller !== undefined;
    },
    snapshot(key: string): ZuSnapshot {
      return entries.get(key)?.snap ?? EMPTY;
    },
    subscribe(key: string, fn: () => void): () => void {
      const e = entry(key);
      e.listeners.add(fn);
      return () => {
        e.listeners.delete(fn);
      };
    },
    /** Ask for a key. "mount" respects the 30 s freshness; "user" always fetches. */
    request,
    /** Load a key and hand back what is cached afterwards. */
    async load(key: string, reason: FetchReason = "mount"): Promise<ZuSnapshot> {
      await request(key, reason);
      const e = entries.get(key);
      if (e?.inflight) await e.inflight;
      return entries.get(key)?.snap ?? EMPTY;
    },
    /** An open screen wants this key kept current: load it now, then poll every
     *  `pollMs` while the page is visible. Returns the stop function. */
    watch(key: string, pollMs: number = DEFAULT_POLL_MS): () => void {
      const e = entry(key);
      e.watchers += 1;
      void request(key, "mount");
      const timer = pollMs > 0 ? setInterval(() => {
        if (isVisible()) void request(key, "interval");
      }, pollMs) : null;
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        if (timer) clearInterval(timer);
        e.watchers = Math.max(0, e.watchers - 1);
        if (e.watchers === 0 && e.trailing) {
          clearTimeout(e.trailing);
          e.trailing = null;
        }
      };
    },
    /** The window came back into focus or became visible: refetch what is open
     *  and older than 30 s. */
    focus() {
      if (!isVisible()) return;
      for (const e of entries.values()) if (e.watchers > 0) void request(e.key, "focus");
    },
    /** The newest webhook pulse time for this key's kinds. The first value seen
     *  is the baseline; a later, larger one means Zuops changed something. */
    signal(key: string, value: number) {
      const e = entry(key);
      if (e.lastSignal === undefined) {
        e.lastSignal = value;
        return;
      }
      if (value > e.lastSignal) {
        e.lastSignal = value;
        if (e.watchers > 0) void request(key, "signal");
        else e.stale = true;
      }
    },
    invalidate,
    /** Run a write. A second identical call while the first is pending gets the
     *  same promise. `invalidate` lists op ids whose cached reads are dropped once
     *  Zuops has answered, refused or not, so the screen shows the true state. */
    run(op: string, args: ZuWriteArgs = {}, o: { invalidate?: readonly string[] } = {}): Promise<ZuWriteResult> {
      const dedupe = stableStringify({ op, path: args.path, query: args.query, body: args.body, confirm: args.confirm });
      const existing = pendingWrites.get(dedupe);
      if (existing) return existing;
      const idem = args.idem ?? newIdem();
      const p = (async (): Promise<ZuWriteResult> => {
        if (!caller) return { ok: false, status: 0, reason: UNREACHABLE, code: "no_caller", limits: {} };
        let res: ZuCallResult;
        try {
          res = await caller({ op, path: args.path, query: args.query, body: args.body, confirm: args.confirm, idem });
        } catch (err) {
          const e = thrown(err);
          return { ok: false, status: e.status, reason: e.reason, code: e.code, limits: {} };
        }
        if (o.invalidate) invalidate(o.invalidate);
        let data: unknown;
        try {
          data = res.json === null ? undefined : JSON.parse(res.json);
        } catch {
          data = undefined;
        }
        return {
          ok: res.ok,
          data,
          reason: res.ok ? undefined : res.reason || `Zuops answered ${res.status}.`,
          code: res.code,
          status: res.status,
          retryAfter: res.retryAfter,
          limits: res.limits ?? {},
        };
      })().finally(() => {
        pendingWrites.delete(dedupe);
        emitWrites();
      });
      pendingWrites.set(dedupe, p);
      emitWrites();
      return p;
    },
    pendingWriteCount(): number {
      return pendingWrites.size;
    },
    subscribeWrites(fn: () => void): () => void {
      writeListeners.add(fn);
      return () => {
        writeListeners.delete(fn);
      };
    },
    /** Forget everything (sign-out, lost access). */
    clear() {
      for (const e of entries.values()) {
        if (e.trailing) clearTimeout(e.trailing);
        e.snap = EMPTY;
        e.stale = true;
        e.calls = [];
        emit(e);
      }
      for (const [k, e] of entries) if (e.listeners.size === 0 && e.watchers === 0) entries.delete(k);
    },
  };
}

export type ZuStore = ReturnType<typeof createZuStore>;
