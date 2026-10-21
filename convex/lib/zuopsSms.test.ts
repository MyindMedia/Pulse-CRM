import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import { sendZuopsSms, fetchZuopsInbound } from "./zuopsSms";
import { sendSms } from "./sms";

/* Zuops as the SMS provider: every reminder and alert goes through sendSms,
   so the driver and the reply poll are what moves Pulse texting off GHL. */

const WS = "ws-pulse";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Call = { url: string; method: string; body: Record<string, unknown> | null };
function stubFetch(answers: Array<(c: Call) => Response>) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const c = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    const answer = answers[calls.length - 1];
    if (!answer) throw new Error(`unexpected fetch ${c.url}`);
    return answer(c);
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

beforeEach(() => {
  vi.stubEnv("ZUOPS_SMS_API_KEY", "zu-test");
  vi.stubEnv("ZUOPS_SMS_WORKSPACE_ID", WS);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("sendZuopsSms", () => {
  it("creates the lead without intake, then texts it", async () => {
    const calls = stubFetch([
      () => json(201, { success: true, data: { lead: { id: "lead-1" } } }),
      () => json(200, { success: true, data: { message_id: "m1" } }),
    ]);
    expect(await sendZuopsSms({ to: "+14045550134", body: "Reminder" })).toBe("sent");
    expect(calls[0].url).toMatch(/\/v1\/leads$/);
    expect(calls[0].body).toEqual({ workspace_id: WS, phone: "+14045550134", tags: ["pulse-sms"], run_intake: false });
    expect(calls[1].url).toMatch(/\/v1\/messages$/);
    expect(calls[1].body).toMatchObject({ lead_id: "lead-1", channel: "sms", body: "Reminder" });
  });

  it("texts the existing lead when Zuops already has that phone (409)", async () => {
    const calls = stubFetch([
      () => json(409, { success: false, error: "duplicate", details: { lead_id: "lead-old", matched_on: "phone" } }),
      () => json(200, { success: true, data: {} }),
    ]);
    expect(await sendZuopsSms({ to: "+14045550134", body: "Hi" })).toBe("sent");
    expect(calls[1].body).toMatchObject({ lead_id: "lead-old" });
  });

  it("reports failed when Zuops refuses the text (opted out, daily cap)", async () => {
    stubFetch([
      () => json(201, { success: true, data: { lead: { id: "lead-1" } } }),
      () => json(429, { success: false, error: "sms_limit" }),
    ]);
    expect(await sendZuopsSms({ to: "+14045550134", body: "Hi" })).toBe("failed");
  });

  it("simulates when the key or sub-account is missing", async () => {
    vi.stubEnv("ZUOPS_SMS_WORKSPACE_ID", "");
    const calls = stubFetch([]);
    expect(await sendZuopsSms({ to: "+14045550134", body: "Hi" })).toBe("simulated");
    expect(calls).toHaveLength(0);
  });

  it("is what sendSms uses when SMS_PROVIDER=zuops", async () => {
    vi.stubEnv("SMS_PROVIDER", "zuops");
    const calls = stubFetch([
      () => json(201, { success: true, data: { lead: { id: "lead-1" } } }),
      () => json(200, { success: true, data: {} }),
    ]);
    expect(await sendSms({ to: "+14045550134", body: "Reminder — 8 PM" })).toBe("sent");
    expect(calls.every((c) => c.url.startsWith("https://api.zuops.com/"))).toBe(true);
    expect(calls[1].body?.body).not.toContain("—");
  });
});

describe("fetchZuopsInbound", () => {
  it("keeps inbound SMS only and returns the next cursor", async () => {
    const calls = stubFetch([
      () => json(200, { success: true, data: { next_cursor: "c2", has_more: false, messages: [
        { id: "a", direction: "inbound", channel: "sms", from: "+14045550134", body: "YES" },
        { id: "b", direction: "outbound", channel: "sms", from: "+12132676846", body: "Reminder" },
      ] } }),
    ]);
    const res = await fetchZuopsInbound({ cursor: "c1" });
    expect(res).toEqual({ ok: true, messages: [{ id: "a", from: "+14045550134", body: "YES" }], next: "c2", more: false });
    expect(calls[0].url).toContain("cursor=c1");
    expect(calls[0].url).toContain("direction=inbound");
  });
});

describe("_pollZuopsInbound", () => {
  it("does nothing while another provider carries Pulse SMS", async () => {
    vi.stubEnv("SMS_PROVIDER", "ghl");
    const calls = stubFetch([]);
    const t = convexTest(schema);
    expect(await t.action(internal.sms._pollZuopsInbound, {})).toEqual({ skipped: "provider" });
    expect(calls).toHaveLength(0);
  });

  it("starts from now, then applies STOP once and advances the cursor", async () => {
    vi.stubEnv("SMS_PROVIDER", "zuops");
    const t = convexTest(schema);
    stubFetch([]);
    const first = await t.action(internal.sms._pollZuopsInbound, {});
    expect(first).toHaveProperty("started");

    const calls = stubFetch([
      () => json(200, { success: true, data: { next_cursor: "c2", has_more: false, messages: [
        { id: "a", direction: "inbound", channel: "sms", from: "+14045550134", body: "STOP" },
      ] } }),
      () => json(200, { success: true, data: { next_cursor: "c2", has_more: false, messages: [] } }),
    ]);
    expect(await t.action(internal.sms._pollZuopsInbound, {})).toEqual({ handled: 1 });
    expect(calls[0].url).toContain("since=");
    const optOut = await t.run((ctx) => ctx.db.query("smsOptOuts").withIndex("by_phone", (q) => q.eq("phone", "+14045550134")).first());
    expect(optOut?.optedOut).toBe(true);

    expect(await t.action(internal.sms._pollZuopsInbound, {})).toEqual({ handled: 0 });
    expect(calls[1].url).toContain("cursor=c2");
  });

  it("drops a page another run already applied", async () => {
    const t = convexTest(schema);
    await t.run((ctx) => ctx.db.insert("smsInboundCursors", { provider: "zuops", account: WS, position: "c3", updatedAt: 0 }));
    const res = await t.mutation(internal.sms._ingestZuopsInbound, {
      account: WS, expected: "c2", position: "c3",
      messages: [{ id: "a", from: "+14045550134", body: "STOP" }],
    });
    expect(res).toEqual({ applied: false });
    const optOut = await t.run((ctx) => ctx.db.query("smsOptOuts").first());
    expect(optOut).toBeNull();
  });
});
