import { describe, it, expect, vi } from "vitest";
import { zuRequest, ZU_BASE, safePath, type ZuResult } from "./zu";

type Call = [string, RequestInit];

function stub(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return respond(url, init);
  });
  return { f: f as unknown as typeof fetch, calls };
}

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

const fail = (r: ZuResult) => {
  if (r.ok) throw new Error("expected a failure");
  return r;
};

describe("zuRequest", () => {
  it("S-01 only calls https://api.usezu.com/v1/... and sends the documented headers", async () => {
    const { f, calls } = stub(() => res(200, { success: true, data: { leads: [] }, error: null }));
    const r1 = await zuRequest({ key: "zu-test", method: "GET", path: "/v1/leads", query: { limit: 5, tag_match: "any", existing_customer: false } }, f);
    const r2 = await zuRequest({ key: "zu-test", method: "POST", path: "/v1/leads/abc/notes", body: { body: "x" }, idempotencyKey: "idem-12345678" }, f);
    expect(r1).toMatchObject({ ok: true, status: 200, data: { leads: [] } });
    expect(r2.ok).toBe(true);
    for (const [url] of calls) expect(url.startsWith(`${ZU_BASE}/v1/`)).toBe(true);
    expect(calls[0][0]).toBe("https://api.usezu.com/v1/leads?limit=5&tag_match=any&existing_customer=false");
    const h0 = calls[0][1].headers as Record<string, string>;
    expect(h0).toEqual({ Authorization: "Bearer zu-test", Accept: "application/json" });
    expect(calls[0][1].body).toBeUndefined();
    const h1 = calls[1][1].headers as Record<string, string>;
    expect(h1).toMatchObject({ Authorization: "Bearer zu-test", "Content-Type": "application/json", "Idempotency-Key": "idem-12345678" });
    expect(calls[1][1].method).toBe("POST");
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ body: "x" });
    expect(calls[1][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("S-01 path traversal and anything outside /v1/ is refused with no request", async () => {
    const { f, calls } = stub(() => res(200, { success: true, data: {} }));
    const bad = ["/v2/leads", "v1/leads", "/v1/../admin", "/v1/leads/..", "/v1//leads", "/v1/leads?x=1", "/v1/leads#x", "/v1/le ads", "/v1/le\tads", "https://evil.example/v1/x", "//evil.example/v1/x", "/v1\\..\\x", ""];
    for (const path of bad) {
      expect(safePath(path)).toBe(false);
      const r = fail(await zuRequest({ key: "k", method: "GET", path }, f));
      expect(r).toMatchObject({ status: 0, code: "bad_path" });
    }
    expect(calls).toHaveLength(0);
  });

  it("reads the contact and rate headers into limits", async () => {
    const { f } = stub(() => res(200, { success: true, data: { id: "m1" } }, { "X-Contacts-Limit": "300", "X-Contacts-Used": "12", "X-Contacts-Remaining": "288", "X-RateLimit-Remaining": "599" }));
    const r = await zuRequest({ key: "k", method: "POST", path: "/v1/messages", body: {} }, f);
    expect(r.limits).toEqual({ contactsLimit: 300, contactsUsed: 12, contactsRemaining: 288, rateRemaining: 599 });
  });

  describe("S-02 every documented error maps to a clear reason and never throws", () => {
    const run = async (status: number, body: unknown, headers: Record<string, string> = {}) =>
      fail(await zuRequest({ key: "k", method: "GET", path: "/v1/leads" }, stub(() => res(status, body, headers)).f));

    it("400 keeps Zuops's sentence", async () => {
      const r = await run(400, { success: false, data: null, error: "subject is required for email" });
      expect(r).toMatchObject({ status: 400, code: "bad_request", reason: "subject is required for email" });
    });
    it("400 with a bare code falls back to plain English", async () => {
      const r = await run(400, { success: false, data: null, error: "invalid_body" });
      expect(r.code).toBe("invalid_body");
      expect(r.reason).toMatch(/did not accept/);
    });
    it("401", async () => {
      const r = await run(401, { success: false, error: "unauthorized" });
      expect(r).toMatchObject({ code: "unauthorized" });
      expect(r.reason).toMatch(/refused the API key/);
    });
    it("402", async () => {
      const r = await run(402, { success: false, error: "credit_limit_exceeded" });
      expect(r.code).toBe("no_credits");
      expect(r.reason).toMatch(/credits/);
    });
    it("403 scope_denied, with Zuops's message naming the scope", async () => {
      const r = await run(403, { success: false, error: "scope_denied", message: "This key needs the leads:admin scope." });
      expect(r).toMatchObject({ code: "scope_denied", reason: "This key needs the leads:admin scope." });
    });
    it("403 with no body is scope_denied", async () => {
      const r = await run(403, "");
      expect(r.code).toBe("scope_denied");
      expect(r.reason).toMatch(/not allowed/);
    });
    it("403 account_locked", async () => {
      const r = await run(403, { success: false, error: "Account locked", details: { code: "account_locked" } });
      expect(r.code).toBe("account_locked");
      expect(r.reason).toMatch(/locked/);
    });
    it("404", async () => {
      const r = await run(404, { success: false, error: "not_found" });
      expect(r.code).toBe("not_found");
      expect(r.reason).toMatch(/could not find/);
    });
    it("409 keeps details (slot_full, window_closed, idempotency_in_progress)", async () => {
      const a = await run(409, { success: false, error: "slot_full", details: { code: "slot_full", next: "2026-11-12T17:00:00Z" } });
      expect(a).toMatchObject({ code: "slot_full", details: { code: "slot_full", next: "2026-11-12T17:00:00Z" } });
      expect(a.reason).toMatch(/already taken/);
      const b = await run(409, { success: false, error: "window_closed", details: { reply_window_ends_at: "x" } });
      expect(b.code).toBe("window_closed");
      expect(b.reason).toMatch(/24 hour/);
      const c = await run(409, { success: false, error: "idempotency_in_progress" });
      expect(c.code).toBe("idempotency_in_progress");
      const d = await run(409, { success: false, error: "A lead with that phone already exists.", details: { lead_id: "l_1" } });
      expect(d).toMatchObject({ code: "conflict", reason: "A lead with that phone already exists.", details: { lead_id: "l_1" } });
    });
    it("429 with Retry-After header", async () => {
      const r = await run(429, { success: false, error: "rate_limit_exceeded" }, { "Retry-After": "17" });
      expect(r).toMatchObject({ code: "rate_limited", retryAfter: 17 });
      expect(r.reason).toMatch(/17 seconds/);
    });
    it("429 with retry_after_seconds in the body", async () => {
      const r = await run(429, { success: false, error: "rate_limit_exceeded", retry_after_seconds: 9 });
      expect(r.retryAfter).toBe(9);
    });
    it("429 sms_limit", async () => {
      const r = await run(429, { success: false, error: "sms_limit", code: "sms_limit", limit: { cap: 300 } });
      expect(r).toMatchObject({ code: "sms_limit", details: { limit: { cap: 300 } } });
      expect(r.reason).toMatch(/messaging limit/);
    });
    it("503", async () => {
      const r = await run(503, { success: false, error: "pricing_unavailable" });
      expect(r.code).toBe("unavailable");
      expect(r.reason).toMatch(/Nothing was charged/);
    });
    it("500 and 502 and a non-JSON body", async () => {
      expect((await run(500, { success: false, error: "internal_error" })).code).toBe("server_error");
      const r = await run(502, "<html>Bad gateway</html>");
      expect(r.code).toBe("server_error");
      expect(r.reason).toMatch(/its side/);
    });
    it("a 200 that is not JSON", async () => {
      const r = await run(200, "<html>ok</html>");
      expect(r).toMatchObject({ status: 200, code: "bad_response" });
    });
    it("a 200 envelope with success false", async () => {
      const r = await run(200, { success: false, data: null, error: "Lead is opted out of texts." });
      expect(r).toMatchObject({ status: 200, reason: "Lead is opted out of texts." });
    });
    it("caps a long Zuops sentence at 300 characters", async () => {
      const r = await run(400, { success: false, error: `Field problem ${"x ".repeat(400)}` });
      expect(r.reason.length).toBeLessThanOrEqual(300);
    });
    it("timeout", async () => {
      const f = vi.fn(async () => { throw new DOMException("The operation timed out.", "TimeoutError"); }) as unknown as typeof fetch;
      const r = fail(await zuRequest({ key: "k", method: "GET", path: "/v1/leads" }, f));
      expect(r).toMatchObject({ status: 0, code: "network" });
      expect(r.reason).toMatch(/20 seconds/);
    });
    it("network error, even a thrown non-Error", async () => {
      const a = fail(await zuRequest({ key: "k", method: "GET", path: "/v1/leads" }, vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch));
      expect(a).toMatchObject({ status: 0, code: "network" });
      const b = fail(await zuRequest({ key: "k", method: "GET", path: "/v1/leads" }, vi.fn(async () => { throw "boom"; }) as unknown as typeof fetch));
      expect(b.code).toBe("network");
    });
    it("Pulse's own reasons never name the key that was sent", async () => {
      for (const status of [400, 401, 402, 403, 404, 409, 429, 500, 503]) {
        const r = fail(await zuRequest({ key: "zu-secret-123", method: "GET", path: "/v1/leads" }, stub(() => res(status, "")).f));
        expect(r.reason).not.toContain("zu-secret-123");
      }
    });
  });
});
