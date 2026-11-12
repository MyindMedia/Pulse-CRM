import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { createZuStore, stableStringify, thrown, zuKey, type ZuCallArgs, type ZuCallResult, type ZuPaged } from "./zu-store";
import { idemStep } from "./use-zu";

/* The pure cache and scheduler behind useZuRead / useZuWrite (eval P-02, P-03,
   X-02, X-03). Fake timers drive the clock; the caller is a mock of api.crm.call. */

const ok = (data: unknown): ZuCallResult => ({ ok: true, status: 200, json: JSON.stringify(data), limits: {} });

function setup(opts: { visible?: () => boolean; reply?: (a: ZuCallArgs) => ZuCallResult | Promise<ZuCallResult> } = {}) {
  const calls: ZuCallArgs[] = [];
  const call = vi.fn(async (a: ZuCallArgs) => {
    calls.push(a);
    return opts.reply ? opts.reply(a) : ok({ n: calls.length });
  });
  const store = createZuStore({ call, isVisible: opts.visible ?? (() => true) });
  return { store, call, calls };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("keys", () => {
  it("are stable across key order and drop empty query values", () => {
    expect(zuKey("list_leads", { query: { b: 1, a: "x", c: "", d: undefined } })).toBe(zuKey("list_leads", { query: { a: "x", b: 1 } }));
    expect(stableStringify({ b: 1, a: { d: 2, c: 1 } })).toBe('{"a":{"c":1,"d":2},"b":1}');
    expect(zuKey("x", { query: { a: "" } })).toBe(zuKey("x"));
  });
});

describe("30 second freshness (P-02)", () => {
  it("serves a read younger than 30 s from memory with no call", async () => {
    const { store, call } = setup();
    const key = zuKey("get_overview");
    const stop = store.watch(key, 0);
    await flush();
    expect(call).toHaveBeenCalledTimes(1);
    stop();

    await vi.advanceTimersByTimeAsync(10_000);
    const stop2 = store.watch(key, 0); // revisit the tab inside 30 s
    await flush();
    expect(call).toHaveBeenCalledTimes(1);
    stop2();

    await vi.advanceTimersByTimeAsync(21_000);
    const stop3 = store.watch(key, 0); // 31 s later: stale, refetch
    await flush();
    expect(call).toHaveBeenCalledTimes(2);
    stop3();
  });

  it("refresh() ('user') always fetches", async () => {
    const { store, call } = setup();
    const key = zuKey("get_overview");
    await store.load(key);
    await store.request(key, "user");
    await flush();
    expect(call).toHaveBeenCalledTimes(2);
  });
});

describe("in-flight sharing and stale data", () => {
  it("shares one request between everyone asking for the same key", async () => {
    let release!: () => void;
    const { store, call } = setup({ reply: () => new Promise((r) => { release = () => r(ok({ v: 1 })); }) });
    const key = zuKey("list_stages");
    const a = store.watch(key, 0);
    const b = store.watch(key, 0);
    const p = store.request(key, "mount");
    expect(call).toHaveBeenCalledTimes(1);
    release();
    await p;
    expect(store.snapshot(key).data).toEqual({ v: 1 });
    a(); b();
  });

  it("keeps the old data visible while a refetch runs, and after a failed one", async () => {
    let n = 0;
    let release: (() => void) | null = null;
    const { store } = setup({
      reply: () => {
        n += 1;
        if (n === 1) return ok({ v: "old" });
        return new Promise((r) => { release = () => r({ ok: false, status: 503, json: null, reason: "Zuops is down for a moment.", limits: {} }); });
      },
    });
    const key = zuKey("get_overview");
    await store.load(key);
    const p = store.request(key, "user");
    expect(store.snapshot(key)).toMatchObject({ data: { v: "old" }, inflight: true });
    release!();
    await p;
    expect(store.snapshot(key)).toMatchObject({ data: { v: "old" }, inflight: false, error: { reason: "Zuops is down for a moment.", status: 503 } });
  });

  it("never throws on a failed call; it becomes an error with a reason", async () => {
    const { store } = setup({ reply: () => { throw new Error("network"); } });
    const key = zuKey("get_overview");
    await store.load(key);
    expect(store.snapshot(key).error).toMatchObject({ status: 0 });
    expect(store.snapshot(key).error?.reason).toMatch(/Could not reach Zuops/);
  });

  it("a lost-access throw from the action reads as owner and admins only, for reads and writes", async () => {
    const { store } = setup({ reply: () => { throw new Error("[CONVEX A(crm:call)] Uncaught AccessError: FORBIDDEN: Only an owner or admin"); } });
    const key = zuKey("get_overview");
    await store.load(key);
    expect(store.snapshot(key).error).toMatchObject({ code: "forbidden", status: 403 });
    expect(store.snapshot(key).error?.reason).not.toMatch(/CONVEX|AccessError/);
    expect(await store.run("update_lead", { path: { lead_id: "l1" }, body: {} })).toMatchObject({ ok: false, code: "forbidden", status: 403 });
  });
});

describe("visibility pause (P-03)", () => {
  it("polls only while the page is visible", async () => {
    let visible = false;
    const { store, call } = setup({ visible: () => visible });
    const stop = store.watch(zuKey("get_overview"), 60_000);
    await flush();
    expect(call).toHaveBeenCalledTimes(1); // the first load

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(call).toHaveBeenCalledTimes(1); // hidden for five minutes: nothing

    visible = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(call).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(call).toHaveBeenCalledTimes(2); // closed screen: nothing
  });

  it("focus refetches only what is older than 30 s, and not while hidden", async () => {
    let visible = true;
    const { store, call } = setup({ visible: () => visible });
    const stop = store.watch(zuKey("get_overview"), 0);
    await flush();
    store.focus();
    await flush();
    expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(31_000);
    visible = false;
    store.focus();
    await flush();
    expect(call).toHaveBeenCalledTimes(1);
    visible = true;
    store.focus();
    await flush();
    expect(call).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe("request ceiling (P-03)", () => {
  it("a screen of three reads makes at most 12 requests a minute under focus and signal storms", async () => {
    const at: number[] = [];
    const { store, call } = setup({ reply: () => { at.push(Date.now()); return ok({}); } });
    const keys = [zuKey("get_overview"), zuKey("get_health_score"), zuKey("setup_status")];
    const stops = keys.map((k) => store.watch(k, 60_000));
    keys.forEach((k) => store.signal(k, 0));
    for (let s = 1; s <= 180; s++) {
      await vi.advanceTimersByTimeAsync(1000);
      store.focus();
      keys.forEach((k) => store.signal(k, s * 1000)); // a webhook pulse every second for 3 minutes
    }
    // In every rolling 60 second window.
    const worst = Math.max(...at.map((t) => at.filter((u) => u >= t && u < t + 60_000).length));
    expect(worst).toBeLessThanOrEqual(12);
    expect(call.mock.calls.length).toBeGreaterThan(12); // signals do get through over 3 minutes
    stops.forEach((s) => s());
  });

  it("holds a signal that arrives too soon and runs it once the gap is over", async () => {
    const { store, call } = setup();
    const key = zuKey("list_leads");
    const stop = store.watch(key, 0);
    store.signal(key, 0);
    await flush();
    store.signal(key, 5);
    await flush();
    expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(call).toHaveBeenCalledTimes(2);
    stop();
  });

  it("waits out a 429 Retry-After before any background refetch", async () => {
    let n = 0;
    const { store, call } = setup({
      reply: () => (++n === 1 ? ok({}) : { ok: false, status: 429, json: null, reason: "Slow down.", retryAfter: 120, code: "rate_limit_exceeded", limits: {} }),
    });
    const key = zuKey("get_overview");
    const stop = store.watch(key, 60_000);
    await flush();
    await store.request(key, "user");
    expect(call).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(call).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(call).toHaveBeenCalledTimes(3);
    stop();
  });
});

describe("paged lists", () => {
  it("walks next_offset and stops at the hard cap", async () => {
    const { store, calls } = setup({
      reply: (a) => {
        const offset = Number(a.query?.offset ?? 0);
        return ok({ leads: Array.from({ length: 200 }, (_, i) => ({ id: `l${offset + i}` })), has_more: true, next_offset: offset + 200 });
      },
    });
    const key = zuKey("list_leads", undefined, { listKey: "leads", limit: 200, max: 1000 });
    const snap = await store.load(key);
    const data = snap.data as { items: unknown[]; truncated: boolean };
    expect(data.items).toHaveLength(1000);
    expect(data.truncated).toBe(true);
    expect(calls.map((c) => c.query?.offset)).toEqual([0, 200, 400, 600, 800]);
  });
});

describe("writes", () => {
  it("a double run is one request with one Idempotency-Key (X-02)", async () => {
    let release!: () => void;
    const { store, call, calls } = setup({ reply: () => new Promise((r) => { release = () => r(ok({ id: "m1" })); }) });
    const args = { body: { lead_id: "l1", body: "Hi" } };
    const a = store.run("send_message", args);
    const b = store.run("send_message", args);
    expect(a).toBe(b);
    expect(call).toHaveBeenCalledTimes(1);
    expect(calls[0].idem).toMatch(/.{8,}/);
    release();
    expect(await a).toMatchObject({ ok: true, data: { id: "m1" } });
    expect(store.pendingWriteCount()).toBe(0);
  });

  it("different bodies are different requests; a given idem is reused on retry", async () => {
    const { store, calls } = setup();
    await store.run("create_lead_note", { path: { lead_id: "l1" }, body: { body: "a" }, idem: "k-1" });
    await store.run("create_lead_note", { path: { lead_id: "l1" }, body: { body: "a" }, idem: "k-1" });
    await store.run("create_lead_note", { path: { lead_id: "l1" }, body: { body: "b" } });
    expect(calls.map((c) => c.idem)).toEqual(["k-1", "k-1", expect.any(String)]);
    expect(calls[2].idem).not.toBe("k-1");
  });

  it("never sets confirm on its own", async () => {
    const { store, calls } = setup();
    await store.run("delete_stage", { path: { stage_id: "s1" } });
    expect(calls[0].confirm).toBeUndefined();
  });

  it("invalidate refetches open reads at once, even fresh ones, and marks closed ones stale", async () => {
    const { store, call } = setup();
    const open = zuKey("list_leads", { query: { limit: 50 } });
    const closed = zuKey("list_leads", { query: { limit: 50, offset: 50 } });
    await store.load(closed);
    const stop = store.watch(open, 0);
    await flush();
    expect(call).toHaveBeenCalledTimes(2);

    await store.run("update_lead", { path: { lead_id: "l1" }, body: { notes: "x" } }, { invalidate: ["list_leads"] });
    await flush();
    expect(call).toHaveBeenCalledTimes(4); // the write + the open read

    const stop2 = store.watch(closed, 0); // still within 30 s, but stale now
    await flush();
    expect(call).toHaveBeenCalledTimes(5);
    stop(); stop2();
  });

  it("a refused write returns Zuops's reason and still re-reads the true state (X-03)", async () => {
    let n = 0;
    const { store, call } = setup({
      reply: (a) => (a.op === "set_lead_stage" ? { ok: false, status: 409, json: null, reason: "That stage is hidden.", code: "conflict", limits: {} } : ok({ n: ++n })),
    });
    const key = zuKey("list_leads");
    const stop = store.watch(key, 0);
    await flush();
    const res = await store.run("set_lead_stage", { path: { lead_id: "l1" }, body: { stage_key: "won" } }, { invalidate: ["list_leads"] });
    expect(res).toMatchObject({ ok: false, status: 409, reason: "That stage is hidden." });
    await flush();
    expect(call).toHaveBeenCalledTimes(3);
    stop();
  });
});

/* ---------- fix round 2 ---------- */

const PAGES = { listKey: "leads", limit: 200, max: 1000 };
const pagedReply = (total: number, label = "v1") => (a: ZuCallArgs) => {
  const offset = Number(a.query?.offset ?? 0);
  const n = Math.max(0, Math.min(200, total - offset));
  const leads = Array.from({ length: n }, (_, i) => ({ id: `l${offset + i}`, v: label }));
  return ok({ leads, has_more: offset + n < total, next_offset: offset + n < total ? offset + n : null });
};

describe("F-U3 one request budget for the whole page", () => {
  it("F-U3: background refetches across all keys, page fetches included, stay at or under 12 a rolling minute; user reads still go and count", async () => {
    const at: number[] = [];
    let total = 600; // three pages
    const { store } = setup({
      reply: (a) => {
        at.push(Date.now());
        return a.op === "list_leads" ? pagedReply(total)(a) : ok({});
      },
    });
    const keys = [zuKey("get_overview"), zuKey("get_health_score"), zuKey("setup_status"), zuKey("list_stages")];
    const paged = zuKey("list_leads", undefined, PAGES);
    const stops = [...keys.map((k) => store.watch(k, 20_000)), store.watch(paged, 20_000)];
    [...keys, paged].forEach((k) => store.signal(k, 0));
    await flush();
    expect(at.length).toBe(4 + 3); // first open: four reads plus three pages, never held back
    for (let s = 1; s <= 240; s++) {
      await vi.advanceTimersByTimeAsync(1000);
      store.focus();
      [...keys, paged].forEach((k) => store.signal(k, s * 1000));
      if (s === 120) { total = 400; await store.request(paged, "user"); } // Refresh: walks every page, counted
    }
    const bg = at.filter((t) => t > at[6]);
    expect(bg.length).toBeGreaterThan(24); // signals do get through over four minutes
    const refreshAt = Date.UTC(2026, 10, 11, 12) + 120_000;
    // Every rolling minute stays at 12, except one that holds the explicit
    // Refresh, whose pages count but are never held back.
    const windows = bg.filter((t) => !(t <= refreshAt && t + 60_000 > refreshAt));
    expect(Math.max(...windows.map((t) => at.filter((u) => u >= t && u < t + 60_000).length))).toBeLessThanOrEqual(12);
    stops.forEach((x) => x());
  });

  it("F-U3: a 429 Retry-After on one key pauses background refetches of every key", async () => {
    const calls: string[] = [];
    let limited = false;
    const { store } = setup({
      reply: (a) => {
        calls.push(a.op);
        if (limited && a.op === "get_overview") return { ok: false, status: 429, json: null, reason: "Slow down.", retryAfter: 120, code: "rate_limit_exceeded", limits: {} };
        return ok({});
      },
    });
    const a = zuKey("get_overview");
    const b = zuKey("get_health_score");
    const sa = store.watch(a, 60_000);
    const sb = store.watch(b, 60_000);
    await flush();
    limited = true;
    await store.request(a, "user");
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(110_000); // two polls of b would be due
    expect(calls.length).toBe(before);
    limited = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.length).toBeGreaterThan(before);
    sa(); sb();
  });

  it("F-U3: a paged list shows page 1 first, keeps paging while has_more, then polls page 1 only (every 300 s) and merges by id; Refresh walks again", async () => {
    let label = "v1";
    const { store, calls } = setup({ reply: (a) => pagedReply(450, label)(a) });
    const key = zuKey("list_leads", undefined, PAGES);
    const seen: Array<{ n: number; complete: boolean }> = [];
    store.subscribe(key, () => {
      const d = store.snapshot(key).data as ZuPaged<{ id: string; v: string }> | undefined;
      if (d) seen.push({ n: d.items.length, complete: d.complete });
    });
    const stop = store.watch(key); // default poll for paged lists
    await flush();
    expect(calls.map((c) => c.query?.offset)).toEqual([0, 200, 400]);
    expect(seen[0]).toEqual({ n: 200, complete: false }); // page 1 on screen before the rest
    expect(seen[seen.length - 1]).toEqual({ n: 450, complete: true });

    label = "v2";
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(3); // no 60 s poll for a paged list
    await vi.advanceTimersByTimeAsync(240_000);
    expect(calls.map((c) => c.query?.offset)).toEqual([0, 200, 400, 0]); // page 1 only
    const d = store.snapshot(key).data as ZuPaged<{ id: string; v: string }>;
    expect(d.items).toHaveLength(450);
    expect(d.items[0].v).toBe("v2");
    expect(d.items[300].v).toBe("v1");
    expect(d.headIds).toHaveLength(200);

    await store.request(key, "user");
    expect(calls.map((c) => c.query?.offset)).toEqual([0, 200, 400, 0, 0, 200, 400]);
    expect((store.snapshot(key).data as ZuPaged<{ v: string }>).items[300].v).toBe("v2");
    stop();
  });
});

describe("F-U4 nothing requests while hidden", () => {
  it("F-U4: a signal while hidden only marks the read stale; it refetches once visible", async () => {
    let visible = true;
    const { store, call } = setup({ visible: () => visible });
    const key = zuKey("list_leads");
    const stop = store.watch(key, 0);
    store.signal(key, 0);
    await flush();
    expect(call).toHaveBeenCalledTimes(1);
    visible = false;
    await vi.advanceTimersByTimeAsync(20_000);
    store.signal(key, 5);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(call).toHaveBeenCalledTimes(1);
    visible = true;
    store.focus();
    await flush();
    expect(call).toHaveBeenCalledTimes(2);
    stop();
  });

  it("F-U4: a held signal whose timer fires while hidden does not request", async () => {
    let visible = true;
    const { store, call } = setup({ visible: () => visible });
    const key = zuKey("list_leads");
    const stop = store.watch(key, 0);
    store.signal(key, 0);
    await flush();
    store.signal(key, 5); // too soon: held for the 15 s gap
    visible = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(call).toHaveBeenCalledTimes(1);
    visible = true;
    store.focus();
    await flush();
    expect(call).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe("F-U8 cached personal data never outlives access", () => {
  it("F-U8: an answer to a request made before clear() is thrown away", async () => {
    let release!: () => void;
    const { store } = setup({ reply: () => new Promise((r) => { release = () => r(ok({ name: "Maya Okafor" })); }) });
    const key = zuKey("get_lead", { path: { lead_id: "l1" } });
    store.subscribe(key, () => undefined);
    const p = store.request(key, "mount");
    store.clear();
    release();
    await p;
    await flush();
    expect(store.snapshot(key).data).toBeUndefined();
    expect(store.snapshot(key).inflight).toBe(false);
  });

  it("F-U8: a read refused for lost access drops the data instead of showing the last copy", async () => {
    let n = 0;
    const { store } = setup({
      reply: () => {
        if (++n === 1) return ok({ name: "Maya Okafor" });
        throw new ConvexError({ code: "FORBIDDEN", message: "Only an owner or admin" });
      },
    });
    const key = zuKey("get_lead", { path: { lead_id: "l1" } });
    await store.load(key);
    expect(store.snapshot(key).data).toEqual({ name: "Maya Okafor" });
    await store.request(key, "user");
    expect(store.snapshot(key)).toMatchObject({ data: undefined, fetchedAt: null, error: { code: "forbidden", status: 403 } });
  });

  it("F-U19: lost access is read from ConvexError data.code, with the message only as a fallback", () => {
    expect(thrown(new ConvexError({ code: "FORBIDDEN", message: "x" }))).toMatchObject({ code: "forbidden", status: 403 });
    expect(thrown(new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required." }))).toMatchObject({ code: "forbidden" });
    expect(thrown(new ConvexError({ code: "OTHER", message: "boom" }))).toMatchObject({ code: "unreachable", status: 0 });
    expect(thrown(new Error("Uncaught AccessError: FORBIDDEN"))).toMatchObject({ code: "forbidden" });
    expect(thrown(new Error("fetch failed"))).toMatchObject({ code: "unreachable" });
  });
});

describe("F-U12 fetch start time", () => {
  it("F-U12: the snapshot records when the fetch STARTED, not when it answered", async () => {
    let release!: () => void;
    const { store } = setup({ reply: () => new Promise((r) => { release = () => r(ok({})); }) });
    const key = zuKey("list_stages");
    const start = Date.now();
    const p = store.request(key, "mount");
    await vi.advanceTimersByTimeAsync(5_000);
    release();
    await p;
    expect(store.snapshot(key).startedAt).toBe(start);
    expect(store.snapshot(key).fetchedAt).toBe(start + 5_000);
  });
});

describe("F-U9 / F-U11 idempotency key lifetime", () => {
  it("F-U9: same values keep the key, changed values get a new one, back to the old values gets the old key, a new round is new", () => {
    let n = 0;
    const make = () => `k${++n}`;
    let st = idemStep(null, "0|a", make);
    expect(st.keys["0|a"]).toBe("k1");
    st = idemStep(st, "0|a", make);
    expect(st.keys["0|a"]).toBe("k1"); // identical retry
    st = idemStep(st, "0|ab", make);
    expect(st.keys["0|ab"]).toBe("k2"); // a field changed after a failure
    st = idemStep(st, "0|a", make);
    expect(st.keys["0|a"]).toBe("k1");
    st = idemStep(st, "1|a", make);
    expect(st.keys["1|a"]).toBe("k3"); // after a success the round moves on
  });
});
