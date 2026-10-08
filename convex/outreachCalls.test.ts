import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// The script gate is covered in callGate.test.ts. Here it is open so live paths can run.
vi.mock("./outreach/callScript", async (orig) => ({ ...(await orig<typeof import("./outreach/callScript")>()), CALL_SCRIPT_APPROVED: true }));

const AGENCY = "org_agency";
const WS = "11111111-1111-1111-1111-111111111111";
const MIN = 60_000;

/** Next Tuesday 21:00 UTC (14:00 Los Angeles) at least a day after the real clock. */
function tuesdayNoon(): number {
  const d = new Date(Date.now() + 86_400_000);
  d.setUTCHours(21, 0, 0, 0);
  while (d.getUTCDay() !== 2 || d.getTime() < Date.now() + 86_400_000) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}
const NOW = tuesdayNoon();

describe("confirmation calls", () => {
  let t: ReturnType<typeof convexTest>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    t = convexTest(schema);
    fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith("https://api.bland.ai")) return new Response(JSON.stringify({ status: "success", call_id: "bland-1" }), { status: 200 });
      if (u.includes("/leads/")) return new Response(JSON.stringify({ data: { lead: { id: "L1", full_name: "Mike Sims", email: "mike@studio.com", custom_fields: { pulse_automated_call_consent: true } } } }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("BLAND_API_KEY", "KEY");
    vi.stubEnv("BLAND_WEBHOOK_SECRET", "whsec");
    vi.stubEnv("CONVEX_SITE_URL", "https://x.convex.site");
    vi.stubEnv("ZUOPS_API_KEY", "zk");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  async function seed(opts: { mode?: "dry_run" | "live"; enabled?: boolean; killSwitch?: boolean; paused?: boolean; dailyCap?: number } = {}) {
    await t.run(async (ctx) => {
      await ctx.db.insert("outreachSettings", { agencyId: AGENCY, paused: opts.paused ?? false, mode: "test_only", senders: [], zuopsWorkspaceId: WS, zuopsCalendarId: WS, updatedAt: 0, updatedBy: "t" });
      await ctx.db.insert("outreachCallSettings", {
        agencyId: AGENCY, enabled: opts.enabled ?? true, mode: opts.mode ?? "dry_run", delayMinutes: 5, windowStart: "09:00", windowEnd: "20:00",
        windowDays: [0, 1, 2, 3, 4, 5, 6], timezone: "America/Los_Angeles", dailyCap: opts.dailyCap ?? 5, maxDurationMinutes: 5,
        killSwitch: opts.killSwitch ?? false, allowTestBookings: false, enabledAt: 1, updatedAt: 0, updatedBy: "t",
      });
    });
  }

  async function booking(over: Record<string, unknown> = {}): Promise<Id<"outreachBookings">> {
    return await t.run(async (ctx) => ctx.db.insert("outreachBookings", {
      agencyId: AGENCY, zuopsBookingId: `zb-${Math.random()}`, zuopsLeadId: "L1", title: "Pulse demo", startsAt: NOW + 3 * 3_600_000, endsAt: NOW + 3 * 3_600_000 + 30 * MIN,
      timezone: "America/Los_Angeles", status: "confirmed", contactName: "Mike Sims", contactEmail: "mike@studio.com",
      consent: { call: true, email: true, sms: false }, phone: "+14085551234", phoneSynced: true, syncedAt: 0, ...over,
    } as never));
  }

  // A booking's _creationTime is the real clock, so plan far enough ahead that it is due.
  const plan = () => t.mutation(internal.outreachCalls._planDue, { now: NOW });
  const rows = () => t.run(async (ctx) => ctx.db.query("outreachCalls").collect());

  it("dry run records the exact body and reason chain and never calls fetch", async () => {
    await seed();
    await booking();
    const r = await plan();
    expect(r.dials).toHaveLength(0);
    const [row] = await rows();
    expect(row.status).toBe("dry_run");
    expect(row.dryRun?.reasons.join(" ")).toContain("consent.call=true");
    const body = row.dryRun?.body as Record<string, unknown>;
    expect(body.phone_number).toBe("+14085551234");
    expect(body.first_sentence).toMatch(/Hi Mike, this is Riley, an AI assistant calling for Pulse/);
    expect(String(body.webhook)).toContain("secret=REDACTED");
    expect(JSON.stringify(row)).not.toContain("whsec");
    await t.action(internal.outreachCalls.dispatchDueCalls, {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is idempotent: a second pass makes no second row and no second dial", async () => {
    await seed();
    await booking();
    await plan(); await plan(); await plan();
    expect(await rows()).toHaveLength(1);
  });

  it("does nothing when disabled, killed, or Outreach is paused", async () => {
    for (const o of [{ enabled: false }, { killSwitch: true }, { paused: true }]) {
      t = convexTest(schema);
      await seed(o);
      await booking();
      await plan();
      expect(await rows()).toHaveLength(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips ineligible bookings with a reason", async () => {
    await seed();
    await booking({ consent: { call: false } });
    await booking({ consent: undefined });
    await booking({ contactName: "Test Person" });
    await booking({ startsAt: NOW + 8 * MIN });
    await booking({ phone: "123" });
    await booking({ contactEmail: "sup@x.com" });
    await t.run(async (ctx) => { await ctx.db.insert("outreachSuppressions", { agencyId: AGENCY, email: "sup@x.com", reason: "unsub", at: 0 }); });
    await plan();
    const reasons = (await rows()).map((r) => r.skipReason).sort();
    expect(reasons).toEqual(["invalid_phone", "no_consent", "no_consent", "suppressed", "test_booking", "too_close"]);
    expect((await rows()).every((r) => r.status === "skipped")).toBe(true);
  });

  it("marks a cancelled booking cancelled, and a queued call whose booking is cancelled later", async () => {
    await seed();
    const id = await booking({ phone: undefined });
    await plan();
    expect((await rows())[0]).toMatchObject({ status: "queued", skipReason: "no_phone" });
    await t.run(async (ctx) => { await ctx.db.patch(id, { status: "cancelled" }); });
    await plan();
    expect((await rows())[0]).toMatchObject({ status: "cancelled" });
  });

  it("waits outside the callee window and for the daily cap", async () => {
    await seed({ dailyCap: 1 });
    await booking({ contactName: "Ann One" });
    await booking({ contactName: "Bea Two", startsAt: NOW + 4 * 3_600_000 });
    await plan();
    const r = await rows();
    expect(r.filter((x) => x.status === "dry_run")).toHaveLength(1);
    expect(r.find((x) => x.status === "queued")?.skipReason).toBe("daily_cap");
    // Same bookings at 22:00 Los Angeles: nothing is due in the window.
    t = convexTest(schema);
    await seed();
    await booking({ startsAt: NOW + 10 * 3_600_000 });
    await t.mutation(internal.outreachCalls._planDue, { now: NOW + 8 * 3_600_000 });
    expect((await rows())[0]).toMatchObject({ status: "queued", skipReason: "outside_window" });
  });

  it("a callee opt-out (phone) blocks the call", async () => {
    await seed();
    await booking();
    await t.run(async (ctx) => { await ctx.db.insert("outreachCallOptOuts", { agencyId: AGENCY, phone: "+14085551234", reason: "asked", at: 0 }); });
    await plan();
    expect((await rows())[0]).toMatchObject({ status: "skipped", skipReason: "opted_out" });
  });

  const blandCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("https://api.bland.ai"));

  it("live: re-checks consent, POSTs the documented request once, and never again", async () => {
    await seed({ mode: "live" });
    await booking();
    const out = await t.action(internal.outreachCalls.dispatchDueCalls, { now: NOW });
    expect(out).toEqual({ planned: 1, dialed: 1 });
    expect(blandCalls()).toHaveLength(1);
    const [url, init] = blandCalls()[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.bland.ai/v1/calls");
    expect((init.headers as Record<string, string>).authorization).toBe("KEY");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      phone_number: "+14085551234", from: "+14086921713", max_duration: 5, record: false, wait_for_greeting: true,
      voicemail: { action: "hangup" }, webhook: "https://x.convex.site/bland/events?secret=whsec",
    });
    expect(body.first_sentence).toMatch(/AI assistant calling for Pulse/);
    expect(body.task).toContain("at 5:00 PM P");
    expect((await rows())[0]).toMatchObject({ status: "dialing", attempts: 1, blandCallId: "bland-1" });
    // Again, and again: still one call to Bland.
    await t.action(internal.outreachCalls.dispatchDueCalls, { now: NOW + MIN });
    await t.action(internal.outreachCalls.dispatchDueCalls, { now: NOW + 2 * MIN });
    expect(blandCalls()).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it("live: consent revoked since booking means no call", async () => {
    await seed({ mode: "live" });
    await booking();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: { lead: { id: "L1", custom_fields: { pulse_automated_call_consent: false } } } }), { status: 200 }));
    const out = await t.action(internal.outreachCalls.dispatchDueCalls, { now: NOW });
    expect(out.dialed).toBe(0);
    expect(blandCalls()).toHaveLength(0);
    expect((await rows())[0]).toMatchObject({ status: "skipped", skipReason: "consent_revoked", attempts: 0 });
  });

  it("live: if Zuops cannot confirm consent the call is held, not dialed", async () => {
    await seed({ mode: "live" });
    await booking();
    fetchMock.mockImplementation(async () => new Response("{}", { status: 500 }));
    await t.action(internal.outreachCalls.dispatchDueCalls, { now: NOW });
    expect(blandCalls()).toHaveLength(0);
    expect((await rows())[0]).toMatchObject({ status: "queued", skipReason: "consent_recheck_unavailable" });
  });

  it("live: a Bland error is recorded as failed and is not retried", async () => {
    await seed({ mode: "live" });
    await booking();
    fetchMock.mockImplementation(async (url: string | URL | Request) =>
      String(url).startsWith("https://api.bland.ai")
        ? new Response(JSON.stringify({ status: "error", message: "bad" }), { status: 400 })
        : new Response(JSON.stringify({ data: { lead: { id: "L1", custom_fields: { pulse_automated_call_consent: true } } } }), { status: 200 }));
    await t.action(internal.outreachCalls.dispatchDueCalls, { now: NOW });
    await t.action(internal.outreachCalls.dispatchDueCalls, { now: NOW + MIN });
    expect(blandCalls()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("live counts toward the daily cap", async () => {
    await seed({ mode: "live", dailyCap: 1 });
    await booking({ contactName: "Ann One" });
    await booking({ contactName: "Bea Two", startsAt: NOW + 4 * 3_600_000 });
    const out = await t.action(internal.outreachCalls.dispatchDueCalls, { now: NOW });
    expect(out.dialed).toBe(1);
    expect(blandCalls()).toHaveLength(1);
    expect((await rows()).find((r) => r.status === "queued")?.skipReason).toBe("daily_cap");
  });

  it("promotes a dry_run row to a real dial when flipped to live", async () => {
    await seed();
    await booking();
    await plan();
    expect((await rows())[0].status).toBe("dry_run");
    await t.run(async (ctx) => { const s = await ctx.db.query("outreachCallSettings").first(); await ctx.db.patch(s!._id, { mode: "live" }); });
    const { dials } = await plan();
    expect(dials).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it("settings: owner only, defaults off, live needs CALL, validation", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: AGENCY, name: "AG", slug: "ag", plan: "max", status: "active", ownerClerkUserId: "u_owner", ownerEmail: "o@x.com" });
      await ctx.db.insert("agencyMembers", { agencyId: AGENCY, clerkUserId: "u_owner", email: "o@x.com", name: "Owner", role: "owner", status: "active", invitedAt: 0 });
      await ctx.db.insert("agencyMembers", { agencyId: AGENCY, clerkUserId: "u_admin", email: "a@x.com", name: "Admin", role: "admin", status: "active", invitedAt: 0 });
    });
    const owner = t.withIdentity({ subject: "u_owner", name: "Owner", orgId: AGENCY, orgType: "agency" });
    const admin = t.withIdentity({ subject: "u_admin", name: "Admin", orgId: AGENCY, orgType: "agency" });
    const s0 = await owner.query(api.outreachCalls.callSettings, {});
    expect(s0?.settings).toMatchObject({ enabled: false, mode: "dry_run", delayMinutes: 5, dailyCap: 5, maxDurationMinutes: 5, windowStart: "09:00", windowEnd: "20:00", timezone: "America/Los_Angeles" });
    await expect(admin.mutation(api.outreachCalls.setCallSettings, { enabled: true })).rejects.toThrow();
    await expect(owner.mutation(api.outreachCalls.setCallSettings, { delayMinutes: 500 })).rejects.toThrow(/Delay/);
    await owner.mutation(api.outreachCalls.setCallSettings, { enabled: true });
    await expect(owner.mutation(api.outreachCalls.setCallSettings, { mode: "live" })).rejects.toThrow(/CALL/);
    await owner.mutation(api.outreachCalls.setCallSettings, { mode: "live", confirm: "CALL" });
    expect((await owner.query(api.outreachCalls.callSettings, {}))?.settings).toMatchObject({ enabled: true, mode: "live" });
    // An admin can stop calls but not restart them.
    await admin.mutation(api.outreachCalls.setKillSwitch, { on: true });
    await expect(admin.mutation(api.outreachCalls.setKillSwitch, { on: false })).rejects.toThrow();
    await owner.mutation(api.outreachCalls.setKillSwitch, { on: false });
  });

  it("the list returns the phone masked", async () => {
    await seed();
    await booking();
    await plan();
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: AGENCY, name: "AG", slug: "ag", plan: "max", status: "active", ownerClerkUserId: "u_owner", ownerEmail: "o@x.com" });
      await ctx.db.insert("agencyMembers", { agencyId: AGENCY, clerkUserId: "u_owner", email: "o@x.com", name: "Owner", role: "owner", status: "active", invitedAt: 0 });
    });
    const owner = t.withIdentity({ subject: "u_owner", name: "Owner", orgId: AGENCY, orgType: "agency" });
    const list = await owner.query(api.outreachCalls.calls, {});
    expect(list).toHaveLength(1);
    const s = JSON.stringify(list);
    expect(s).not.toContain("5551234");
    expect(s).toContain("408-***-1234");
  });
});

describe("POST /bland/events", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });
  afterEach(() => vi.unstubAllEnvs());

  const post = (qs: string, body: unknown, headers: Record<string, string> = {}) =>
    t.fetch(`/bland/events${qs}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

  async function dialingRow() {
    return await t.run(async (ctx) => {
      const b = await ctx.db.insert("outreachBookings", { agencyId: AGENCY, zuopsBookingId: "z1", title: "d", startsAt: NOW, endsAt: NOW, status: "confirmed", contactEmail: "mike@studio.com", syncedAt: 0 });
      return await ctx.db.insert("outreachCalls", { agencyId: AGENCY, bookingId: b, phone: "+14085551234", status: "dialing", scheduledFor: 0, blandCallId: "bland-1", attempts: 1, createdAt: 0, updatedAt: 0, dialedAt: 1 });
    });
  }

  it("503 when the secret is unset, 401 when wrong or missing, 200 when right", async () => {
    expect((await post("?secret=x", {})).status).toBe(503);
    vi.stubEnv("BLAND_WEBHOOK_SECRET", "whsec");
    expect((await post("", { call_id: "a" })).status).toBe(401);
    expect((await post("?secret=nope", { call_id: "a" })).status).toBe(401);
    expect((await post("?secret=whsec", { call_id: "unknown" })).status).toBe(200);
    expect((await post("", { call_id: "unknown" }, { "x-pulse-secret": "whsec" })).status).toBe(200);
    expect((await post("", { call_id: "unknown" }, { authorization: "Bearer whsec" })).status).toBe(200);
    expect((await post("?secret=whsec", { nope: 1 })).status).toBe(400);
  });

  it("updates the call from the payload", async () => {
    vi.stubEnv("BLAND_WEBHOOK_SECRET", "whsec");
    const id = await dialingRow();
    const res = await post("?secret=whsec", { call_id: "bland-1", completed: true, answered_by: "human", summary: "Confirmed the demo.", disposition_tag: "CONFIRMED", call_length: 0.4 });
    expect(await res.json()).toEqual({ ok: true, matched: true });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).toMatchObject({ status: "completed", answeredBy: "human", result: { summary: "Confirmed the demo.", disposition: "CONFIRMED" } });
    expect(await t.run(async (ctx) => ctx.db.query("outreachCallOptOuts").collect())).toHaveLength(0);
  });

  it("a do-not-call request marks the contact callOptOut, and the next plan skips them", async () => {
    vi.stubEnv("BLAND_WEBHOOK_SECRET", "whsec");
    await dialingRow();
    await post("?secret=whsec", { call_id: "bland-1", completed: true, transcripts: [{ user: "user", text: "Please do not call me again" }] });
    const opt = await t.run(async (ctx) => ctx.db.query("outreachCallOptOuts").collect());
    expect(opt).toHaveLength(1);
    expect(opt[0]).toMatchObject({ phone: "+14085551234", email: "mike@studio.com" });
    // Repeat delivery does not duplicate.
    await post("?secret=whsec", { call_id: "bland-1", completed: true, disposition_tag: "DO_NOT_CONTACT" });
    expect(await t.run(async (ctx) => ctx.db.query("outreachCallOptOuts").collect())).toHaveLength(1);
  });

  it("an error payload marks the call failed", async () => {
    vi.stubEnv("BLAND_WEBHOOK_SECRET", "whsec");
    const id = await dialingRow();
    await post("?secret=whsec", { call_id: "bland-1", completed: false, error_message: "Account not allowed to call" });
    expect(await t.run(async (ctx) => ctx.db.get(id))).toMatchObject({ status: "failed" });
  });

  it("matches by external_id when the dial response was lost", async () => {
    vi.stubEnv("BLAND_WEBHOOK_SECRET", "whsec");
    const id = await t.run(async (ctx) => {
      const b = await ctx.db.insert("outreachBookings", { agencyId: AGENCY, zuopsBookingId: "z2", title: "d", startsAt: NOW, endsAt: NOW, status: "confirmed", syncedAt: 0 });
      return await ctx.db.insert("outreachCalls", { agencyId: AGENCY, bookingId: b, phone: "+14085551234", status: "failed", scheduledFor: 0, attempts: 1, createdAt: 0, updatedAt: 0, dialedAt: 1 });
    });
    await post("?secret=whsec", { call_id: "late-1", completed: true, external_id: id });
    expect(await t.run(async (ctx) => ctx.db.get(id))).toMatchObject({ status: "completed", blandCallId: "late-1" });
  });
});

describe("Zuops sync keeps the phone for the call", () => {
  it("stores phone and marks the lead read; a later sync without the lead keeps both", async () => {
    const t = convexTest(schema);
    const b = { id: "zb1", leadId: "L1", title: "Pulse demo", startsAt: NOW, endsAt: NOW + 30 * MIN, status: "confirmed", timezone: "America/Los_Angeles" };
    await t.mutation(internal.outreachZuops._upsert, { agencyId: AGENCY, bookings: [{ ...b, lead: { name: "Mike Sims", email: "mike@studio.com", consent: { call: true }, emailOptOut: false, phone: "+14085551234" } }] });
    let [row] = await t.run(async (ctx) => ctx.db.query("outreachBookings").collect());
    expect(row).toMatchObject({ phone: "+14085551234", phoneSynced: true, consent: { call: true } });
    expect(await t.query(internal.outreachZuops._knownContacts, { agencyId: AGENCY })).toEqual(["L1"]);
    await t.mutation(internal.outreachZuops._upsert, { agencyId: AGENCY, bookings: [b] });
    [row] = await t.run(async (ctx) => ctx.db.query("outreachBookings").collect());
    expect(row).toMatchObject({ phone: "+14085551234", phoneSynced: true });
  });
  it("a row from before this feature is re-read once (not 'known' until phoneSynced)", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => { await ctx.db.insert("outreachBookings", { agencyId: AGENCY, zuopsBookingId: "old", zuopsLeadId: "L9", title: "d", startsAt: NOW, endsAt: NOW, status: "confirmed", contactEmail: "a@b.com", syncedAt: 0 }); });
    expect(await t.query(internal.outreachZuops._knownContacts, { agencyId: AGENCY })).toEqual([]);
  });
});
