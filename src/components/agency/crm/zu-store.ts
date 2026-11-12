/* The pure core behind useZuRead / useZuWrite: a small in-memory cache and request
   scheduler for `api.crm.call`. No React in here, so it can be unit tested with
   fake timers (use-zu.test.ts).

   Rules it keeps (design.md Addendum D2, eval P-02, P-03, X-02):
   - A read younger than FRESH_MS (30 s) is served from memory with no call, so
     revisiting a tab inside 30 s costs nothing.
   - One in-flight request per key; everyone asking for the same key shares it.
   - Stale data stays visible while a refetch runs, and after a failed one, except
     when the failure is lost access: then the data is dropped (F-U8).
   - One budget for the whole page (F-U3): every Zuops request (each page of a
     paged list and each write included) counts, and a background refetch (poll,
     webhook signal, focus) only runs while fewer than MAX_PER_MINUTE requests were
     made in the last rolling minute. Reads the person asked for (a newly opened
     view, Refresh, the re-read after a write) are never held back but do count.
     Background refetches of one key are also spaced MIN_GAP_MS apart.
   - A 429 Retry-After pauses every background refetch until it passes.
   - Nothing requests while the page is hidden: a signal or held timer only marks
     the read stale, and it refetches when the page is visible again (F-U4).
   - A paged list loads page 1, shows it, then keeps paging while `has_more`.
     Background refetches and post-write re-reads fetch page 1 only and merge it
     by id; only Refresh walks every page again.
   - clear() bumps a generation: an answer to a request made before it is thrown
     away, so nothing cached outlives lost access (F-U8).
   - The cache has an owner (the signed-in user). setOwner() with a different
     owner makes the next read, of any key, start from nothing: a new user's
     first render can never see the previous user's answers (R3-U4).
   - A write with the same op and arguments while one is pending returns the same
     promise (a double click is one request), and carries an Idempotency-Key.
   - Nothing is written to localStorage or sessionStorage, and no response body is
     ever logged. */

import { ConvexError } from "convex/values";

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

/** Walk an offset-paged list (`has_more` / `next_offset`) into one result.
 *  `idKey` (default "id") is how page-1 refreshes are merged into the list. */
export type ZuPages = { listKey: string; limit: number; max: number; idKey?: string };

export type ZuPaged<T> = {
  items: T[];
  /** More exist than `max`. */
  truncated: boolean;
  /** False while later pages are still loading (or a walk stopped on an error). */
  complete: boolean;
  /** When the last finished full walk started, or null before one finished. */
  walkStartedAt: number | null;
  /** When the fetch that last read page 1 started, and the ids it returned. */
  headStartedAt: number;
  headIds: string[];
};

export type ZuSnapshot = {
  data: unknown;
  error: ZuError | null;
  fetchedAt: number | null;
  /** When the fetch that produced `data` started (F-U12). */
  startedAt: number | null;
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
/** Zuops requests per rolling minute for the whole open CRM page (background cap). */
export const MAX_PER_MINUTE = 12;
export const DEFAULT_POLL_MS = 60_000;
/** Default poll for paged lists: they are the expensive reads. */
export const PAGED_POLL_MS = 300_000;
const MINUTE = 60_000;
const MAX_ENTRIES = 150;

export const UNREACHABLE = "Could not reach Zuops through Pulse. Check your connection and try again.";
export const UNREADABLE = "Zuops sent an answer Pulse could not read.";
export const FORBIDDEN = "The CRM is limited to Pulse agency owners and admins.";

const ACCESS_CODES = new Set([
  "FORBIDDEN", "UNAUTHENTICATED", "NO_AGENCY_MEMBER", "CAPABILITY_DENIED", "SCOPE_DENIED", "NO_WORKSPACE", "GRANT_EXPIRED",
]);

/** The action threw instead of answering: lost access or no network. The access
 *  check throws AccessError, a ConvexError whose data is `{ code, message }`
 *  (convex/lib/access.ts). The text is only matched, never shown or logged. */
export function thrown(err: unknown): ZuError {
  if (err instanceof ConvexError) {
    const code = (err.data as { code?: unknown } | null | undefined)?.code;
    if (typeof code === "string" && ACCESS_CODES.has(code)) return { reason: FORBIDDEN, code: "forbidden", status: 403 };
  }
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/FORBIDDEN|UNAUTHENTICATED|Not signed in/i.test(msg)) return { reason: FORBIDDEN, code: "forbidden", status: 403 };
  return { reason: UNREACHABLE, code: "unreachable", status: 0 };
}

const EMPTY: ZuSnapshot = Object.freeze({ data: undefined, error: null, fetchedAt: null, startedAt: null, inflight: false }) as ZuSnapshot;
export const EMPTY_SNAPSHOT = EMPTY;

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

/** A newer clear() happened: drop this answer on the floor. */
class Superseded {}

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

function isPaged(v: unknown): v is ZuPaged<unknown> {
  return !!v && typeof v === "object" && Array.isArray((v as ZuPaged<unknown>).items) && "complete" in (v as object);
}

function idOf(item: unknown, idKey: string): string | undefined {
  const v = item && typeof item === "object" ? (item as Record<string, unknown>)[idKey] : undefined;
  return typeof v === "string" || typeof v === "number" ? String(v) : undefined;
}

type Entry = {
  key: string;
  parts: KeyParts;
  snap: ZuSnapshot;
  inflight: Promise<void> | null;
  again: FetchReason | null;
  listeners: Set<() => void>;
  watchers: number;
  lastCall: number | undefined;
  lastSignal: number | undefined;
  stale: boolean;
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
  /** Start times of every Zuops request in the last minute, all keys. */
  let spent: number[] = [];
  /** A 429 asked us to wait: no background refetch before this time. */
  let pausedUntil = 0;
  /** Bumped by clear(); answers from an older generation are discarded. */
  let gen = 0;
  /** Whose answers are cached, and whose the next read is for. */
  let owner: string | null = null;
  let wantedOwner: string | null = null;

  /** Reset for a new owner without telling anyone: this runs inside a render
   *  (a read), where notifying other components is not allowed. Everything they
   *  read from now on is empty. */
  function syncOwner() {
    if (wantedOwner === owner) return;
    const had = owner !== null;
    owner = wantedOwner;
    if (!had) return;
    gen += 1;
    pendingWrites.clear();
    for (const e of entries.values()) {
      if (e.trailing) clearTimeout(e.trailing);
      e.trailing = null;
      e.inflight = null;
      e.again = null;
      e.snap = EMPTY;
      e.stale = true;
      e.lastCall = undefined;
      e.lastSignal = undefined;
    }
  }

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
        lastCall: undefined,
        lastSignal: undefined,
        stale: false,
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

  function spentNow(t: number): number {
    spent = spent.filter((c) => t - c < MINUTE);
    return spent.length;
  }

  function spend() {
    spent.push(now());
  }

  function pauseFor(retryAfter: number | undefined) {
    if (retryAfter && retryAfter > 0) pausedUntil = Math.max(pausedUntil, now() + retryAfter * 1000);
  }

  async function fetchOnce(parts: KeyParts, query: ZuQuery | undefined, myGen: number): Promise<{ data: unknown; raw: Record<string, unknown> | null }> {
    if (!caller) throw new ZuFailure({ reason: UNREACHABLE, code: "no_caller", status: 0 });
    spend();
    let res: ZuCallResult;
    try {
      res = await caller({ op: parts.op, path: parts.path, query });
    } catch (err) {
      if (myGen !== gen) throw new Superseded();
      throw new ZuFailure(thrown(err));
    }
    if (myGen !== gen) throw new Superseded();
    if (!res.ok) throw failureOf(res);
    const data = parse(res.json);
    return { data, raw: data && typeof data === "object" ? (data as Record<string, unknown>) : null };
  }

  type Page = { list: unknown[]; more: boolean; next: number };

  async function fetchPage(parts: KeyParts, pages: ZuPages, offset: number, myGen: number): Promise<Page> {
    const { raw } = await fetchOnce(parts, { ...(parts.query ?? {}), limit: pages.limit, offset }, myGen);
    const list = Array.isArray(raw?.[pages.listKey]) ? (raw![pages.listKey] as unknown[]) : [];
    const next = raw?.next_offset;
    const more = raw?.has_more === true && typeof next === "number" && list.length > 0;
    return { list, more, next: more ? (next as number) : offset };
  }

  /** Page 1, shown at once, then the rest while `has_more` (first open, Refresh). */
  async function walk(e: Entry, pages: ZuPages, startedAt: number, myGen: number): Promise<void> {
    const idKey = pages.idKey ?? "id";
    const prev = isPaged(e.snap.data) ? e.snap.data : null;
    let items: unknown[] = [];
    let headIds: string[] = [];
    let offset = 0;
    let more = true;
    let first = true;
    while (more && items.length < pages.max) {
      const page = await fetchPage(e.parts, pages, offset, myGen);
      items.push(...page.list);
      if (first) headIds = page.list.map((i) => idOf(i, idKey)).filter((x): x is string => !!x);
      more = page.more;
      offset = page.next;
      const done = !more || items.length >= pages.max;
      if (items.length > pages.max) items = items.slice(0, pages.max);
      const data: ZuPaged<unknown> = {
        items: done || !prev ? items : mergeTail(items, prev.items, idKey),
        truncated: done ? more : false,
        complete: done,
        walkStartedAt: done ? startedAt : prev?.walkStartedAt ?? null,
        headStartedAt: startedAt,
        headIds,
      };
      e.stale = false;
      e.snap = { data, error: null, fetchedAt: now(), startedAt, inflight: !done };
      if (!done) emit(e);
      first = false;
    }
  }

  /** While a walk is part way, keep showing the rest of the old list. */
  function mergeTail(fresh: unknown[], old: unknown[], idKey: string): unknown[] {
    const seen = new Set(fresh.map((i) => idOf(i, idKey)));
    return [...fresh, ...old.filter((i) => !seen.has(idOf(i, idKey)))];
  }

  /** Page 1 only, merged by id into what is already loaded (poll, signal, re-read). */
  async function head(e: Entry, pages: ZuPages, prev: ZuPaged<unknown>, startedAt: number, myGen: number): Promise<void> {
    const idKey = pages.idKey ?? "id";
    const page = await fetchPage(e.parts, pages, 0, myGen);
    const headIds = page.list.map((i) => idOf(i, idKey)).filter((x): x is string => !!x);
    let items: unknown[];
    let truncated: boolean;
    if (!page.more) {
      items = page.list.slice(0, pages.max);
      truncated = page.list.length > pages.max;
    } else {
      const merged = mergeTail(page.list, prev.items, idKey);
      items = merged.slice(0, pages.max);
      truncated = prev.truncated || merged.length > pages.max;
    }
    const data: ZuPaged<unknown> = {
      items, truncated, complete: page.more ? prev.complete : true, walkStartedAt: page.more ? prev.walkStartedAt : startedAt, headStartedAt: startedAt, headIds,
    };
    e.stale = false;
    e.snap = { data, error: null, fetchedAt: now(), startedAt, inflight: false };
  }

  function scheduleTrailing(e: Entry, at: number) {
    if (e.trailing) return;
    e.trailing = setTimeout(() => {
      e.trailing = null;
      if (e.watchers === 0) return;
      if (!isVisible()) {
        e.stale = true; // refetched when the page is visible again
        return;
      }
      void request(e.key, "signal");
    }, Math.max(0, at - now()));
  }

  /** The earliest time a background request may go, or 0 if it may go now. */
  function backgroundWait(e: Entry, t: number): number {
    let at = 0;
    if (t < pausedUntil) at = pausedUntil;
    if (e.lastCall !== undefined && t - e.lastCall < minGapMs) at = Math.max(at, e.lastCall + minGapMs);
    if (spentNow(t) >= maxPerMinute) at = Math.max(at, spent[spent.length - maxPerMinute] + MINUTE);
    return at;
  }

  function request(key: string, reason: FetchReason): Promise<void> {
    syncOwner();
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

    if (BACKGROUND.has(reason)) {
      if (!isVisible()) {
        e.stale = true;
        return Promise.resolve();
      }
      const wait = backgroundWait(e, t);
      if (wait > 0) {
        // Held back. A signal (or a read already marked stale) means the data
        // really changed, so it runs once the wait is over; focus and interval
        // on merely old data are dropped.
        if (reason === "signal" || e.stale) {
          e.stale = true;
          scheduleTrailing(e, wait);
        }
        return Promise.resolve();
      }
    }
    e.lastCall = t;
    if (e.trailing) {
      clearTimeout(e.trailing);
      e.trailing = null;
    }

    const pages = e.parts.pages;
    const prev = pages && isPaged(e.snap.data) ? e.snap.data : null;
    const full = !!pages && (reason === "user" || !prev || (!prev.complete && !BACKGROUND.has(reason)));
    const myGen = gen;
    const startedAt = t;

    setSnap(e, { ...e.snap, inflight: true });
    const p = (async () => {
      try {
        if (pages && full) await walk(e, pages, startedAt, myGen);
        else if (pages && prev) await head(e, pages, prev, startedAt, myGen);
        else {
          const { data } = await fetchOnce(e.parts, e.parts.query, myGen);
          e.stale = false;
          e.snap = { data, error: null, fetchedAt: now(), startedAt, inflight: false };
        }
      } catch (err) {
        if (err instanceof Superseded || myGen !== gen) return;
        const f = err instanceof ZuFailure ? err : new ZuFailure({ reason: UNREACHABLE, status: 0 });
        pauseFor(f.retryAfter);
        if (f.error.code === "forbidden") {
          // Lost access: nothing from before may stay on screen (F-U8).
          e.snap = { data: undefined, error: f.error, fetchedAt: null, startedAt: null, inflight: false };
        } else {
          const data = isPaged(e.snap.data) ? { ...e.snap.data, complete: false } : e.snap.data;
          e.snap = { ...e.snap, data, error: f.error, inflight: false };
        }
      } finally {
        if (myGen === gen) {
          e.inflight = null;
          emit(e);
          const again = e.again;
          e.again = null;
          if (again) void request(key, again);
        }
      }
    })();
    e.inflight = p;
    return p;
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
    /** Who the cached answers belong to (the signed-in user's id). Safe to call
     *  during render: a change only takes effect, silently, at the next read. */
    setOwner(next: string) {
      wantedOwner = next;
    },
    snapshot(key: string): ZuSnapshot {
      syncOwner();
      return entries.get(key)?.snap ?? EMPTY;
    },
    subscribe(key: string, fn: () => void): () => void {
      syncOwner();
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
     *  `pollMs` while the page is visible (default 60 s, 300 s for paged lists).
     *  Returns the stop function. */
    watch(key: string, pollMs?: number): () => void {
      const e = entry(key);
      e.watchers += 1;
      void request(key, "mount");
      const every = pollMs ?? (e.parts.pages ? PAGED_POLL_MS : DEFAULT_POLL_MS);
      const timer = every > 0 ? setInterval(() => {
        if (isVisible()) void request(key, "interval");
      }, every) : null;
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
     *  and either marked stale or older than 30 s, within the budget. */
    focus() {
      if (!isVisible()) return;
      for (const e of entries.values()) if (e.watchers > 0) void request(e.key, "focus");
    },
    /** The newest webhook pulse time for this key's kinds. The first value seen
     *  is the baseline; a later, larger one means Zuops changed something. While
     *  the page is hidden this only marks the read stale. */
    signal(key: string, value: number) {
      const e = entry(key);
      if (e.lastSignal === undefined) {
        e.lastSignal = value;
        return;
      }
      if (value > e.lastSignal) {
        e.lastSignal = value;
        if (e.watchers > 0 && isVisible()) void request(key, "signal");
        else e.stale = true;
      }
    },
    invalidate,
    /** Run a write. A second identical call while the first is pending gets the
     *  same promise. `invalidate` lists op ids whose cached reads are dropped once
     *  Zuops has answered, refused or not, so the screen shows the true state. */
    run(op: string, args: ZuWriteArgs = {}, o: { invalidate?: readonly string[] } = {}): Promise<ZuWriteResult> {
      syncOwner();
      const dedupe = stableStringify({ op, path: args.path, query: args.query, body: args.body, confirm: args.confirm });
      const existing = pendingWrites.get(dedupe);
      if (existing) return existing;
      const idem = args.idem ?? newIdem();
      const myGen = gen;
      const box: { p?: Promise<ZuWriteResult> } = {};
      const p = (async (): Promise<ZuWriteResult> => {
        if (!caller) return { ok: false, status: 0, reason: UNREACHABLE, code: "no_caller", limits: {} };
        let res: ZuCallResult;
        spend();
        try {
          res = await caller({ op, path: args.path, query: args.query, body: args.body, confirm: args.confirm, idem });
        } catch (err) {
          const e = thrown(err);
          return { ok: false, status: e.status, reason: e.reason, code: e.code, limits: {} };
        }
        pauseFor(res.retryAfter);
        if (o.invalidate && myGen === gen) invalidate(o.invalidate);
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
        if (pendingWrites.get(dedupe) === box.p) pendingWrites.delete(dedupe);
        emitWrites();
      });
      box.p = p;
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
    /** Requests made in the last rolling minute, all keys (for tests and UI). */
    spentLastMinute(): number {
      return spentNow(now());
    },
    /** Forget everything (sign-out, lost access, leaving the CRM). Requests still
     *  in flight keep running but their answers are thrown away. */
    clear() {
      gen += 1;
      pendingWrites.clear();
      for (const e of entries.values()) {
        if (e.trailing) clearTimeout(e.trailing);
        e.trailing = null;
        e.inflight = null;
        e.again = null;
        e.snap = EMPTY;
        e.stale = true;
        e.lastCall = undefined;
        e.lastSignal = undefined;
        emit(e);
      }
      for (const [k, e] of entries) if (e.listeners.size === 0 && e.watchers === 0) entries.delete(k);
      emitWrites();
    },
  };
}

export type ZuStore = ReturnType<typeof createZuStore>;
