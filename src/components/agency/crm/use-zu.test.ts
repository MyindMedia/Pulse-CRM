import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZuStore, stableStringify, zuKey, type ZuCallArgs, type ZuCallResult } from "./zu-store";

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
