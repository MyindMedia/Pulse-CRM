import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

type Id = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (subject: string, orgId: string): Id => ({ subject, name: subject, orgId, orgType: "agency" });

const WS = "e56bf309-bede-486f-b4b5-1948248b3839";
const CAL = "5b4208ab-d31c-4d07-b60b-59223ce47fc8";
const OTHER_WS = "b77d090e-a44d-41f4-9838-9411d97373c5";
const day = 86_400_000;

const iso = (ms: number) => new Date(ms).toISOString();
const calendars = { success: true, data: { calendars: [{ id: CAL, name: "Pulse | 30-minute demo", title: "30-minute Pulse demo", slug: "pulse-30-minute-demo", duration_minutes: 30, buffer_minutes: 15, min_notice_minutes: 1440, max_days_ahead: 14, timezone: "America/Los_Angeles", is_active: true, weekly_hours: { mon: [["09:00", "17:00"]], sat: [] }, location_label: "Zoom" }] } };
const lead = (id: string, email: string) => ({ success: true, data: { lead: { id, full_name: "Studio Owner", email, phone: "+14085550123", custom_fields: { pulse_sms_marketing_consent: false, pulse_automated_call_consent: true, pulse_email_marketing_consent: true } } } });

describe("zuops calendar sync", () => {
  let t: ReturnType<typeof convexTest>;
  let urls: string[];
  beforeEach(() => { t = convexTest(schema); vi.stubEnv("ZUOPS_API_KEY", "zu-test"); urls = []; });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  async function seed(agencyId: string, owner: string, staff?: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId, name: agencyId, slug: agencyId, plan: "max", status: "active", ownerClerkUserId: owner, ownerEmail: `${owner}@x` });
      await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: owner, email: `${owner}@x`, name: owner, role: "owner", status: "active", invitedAt: 0 });
      if (staff) await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: staff, email: `${staff}@x`, name: staff, role: "staff", status: "active", invitedAt: 0 });
      await ctx.db.insert("outreachSettings", { agencyId, paused: false, mode: "live", senders: [], updatedAt: 1, updatedBy: "t" });
    });
  }
  const as = (s: string, o: string) => t.withIdentity(idOf(s, o) as never);
  const map = (agencyId: string, workspaceId = WS) => t.mutation(internal.outreachZuops.setMapping, { agencyId, workspaceId, calendarId: CAL, operator: "op" });
  const stub = (bookings: unknown[], leads: Record<string, unknown> = {}) => vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    urls.push(u);
    const url = new URL(u);
    if (url.pathname.endsWith("/v1/calendars")) return new Response(JSON.stringify(calendars));
    if (url.pathname.endsWith("/v1/bookings")) return new Response(JSON.stringify({ success: true, data: { bookings } }));
    const m = /\/v1\/leads\/(.+)$/.exec(url.pathname);
    if (m && leads[decodeURIComponent(m[1])]) return new Response(JSON.stringify(leads[decodeURIComponent(m[1])]));
    return new Response("{}", { status: 404 });
  }));
  const booking = (id: string, leadId: string, startsInDays: number, status = "confirmed") => ({ id, lead_id: leadId, calendar_id: CAL, title: "Pulse demo", starts_at: iso(Date.now() + startsInDays * day), ends_at: iso(Date.now() + startsInDays * day + 1_800_000), timezone: "America/Los_Angeles", status, location: "Zoom" });

  it("mirrors bookings with name, email and consent but no phone, and matches a prospect by its published email", async () => {
    await seed("org_a", "ua");
    await map("org_a");
    const prospectId = await t.run(async (ctx) => await ctx.db.insert("outreachProspects", {
      agencyId: "org_a", dedupeKey: "web:acme.com", name: "Acme Sound", websiteUrl: "https://acme.com", source: "paste", status: "scraped",
      contacts: { emails: [{ address: "owner@acme.com", generic: false, rank: 5, sourceUrl: "https://acme.com" }], phones: [], socials: [], booking: [], pages: [], scrapedAt: 1 }, createdAt: 1, updatedAt: 1,
    }));
    stub([booking("b1", "l1", 2), booking("b2", "l2", 3, "cancelled")], { l1: lead("l1", "Owner@Acme.com"), l2: lead("l2", "other@x.com") });
    await t.action(internal.outreachZuops.sync, { agencyId: "org_a" });
    const view = (await as("ua", "org_a").query(api.outreachZuops.bookings, {}))!;
    expect(view.mapped).toBe(true);
    expect(view.upcoming).toHaveLength(1);
    expect(view.upcoming[0]).toMatchObject({ contactName: "Studio Owner", contactEmail: "owner@acme.com", prospect: "Acme Sound", consent: { sms: false, call: true, email: true } });
    expect(view.past[0].status).toBe("cancelled");
    expect(JSON.stringify(view)).not.toContain("5550123");
    const stored = await t.run(async (ctx) => JSON.stringify(await ctx.db.query("outreachBookings").collect()));
    expect(stored).not.toContain("5550123");
    expect((await t.run(async (ctx) => await ctx.db.get(prospectId)))!.bookedAt).toBeGreaterThan(Date.now());
    const snap = (await as("ua", "org_a").query(api.outreachZuops.snapshot, {}))!;
    expect(snap).toMatchObject({ ok: true, keyConfigured: true, calendar: { name: "Pulse | 30-minute demo", durationMin: 30, bufferMin: 15 } });
  });

  it("every Zuops call is pinned to the mapped workspace, read-only, with the bearer key", async () => {
    await seed("org_a", "ua");
    await map("org_a");
    stub([booking("b1", "l1", 1)], { l1: lead("l1", "o@x.com") });
    await t.action(internal.outreachZuops.sync, { agencyId: "org_a" });
    expect(urls.length).toBeGreaterThan(2);
    for (const u of urls) {
      expect(u.startsWith("https://api.zuops.com/functions/v1/api-gateway/v1/")).toBe(true);
      expect(new URL(u).searchParams.get("workspace_id")).toBe(WS);
      expect(u).not.toContain(OTHER_WS);
    }
    const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    expect(calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("re-syncing updates a cancellation in place and does not duplicate rows or re-fetch known leads", async () => {
    await seed("org_a", "ua");
    await map("org_a");
    stub([booking("b1", "l1", 2)], { l1: lead("l1", "o@x.com") });
    await t.action(internal.outreachZuops.sync, { agencyId: "org_a" });
    stub([booking("b1", "l1", 2, "cancelled")], { l1: lead("l1", "o@x.com") });
    urls = [];
    await t.action(internal.outreachZuops.sync, { agencyId: "org_a" });
    const rows = await t.run(async (ctx) => await ctx.db.query("outreachBookings").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "cancelled", contactEmail: "o@x.com" });
    expect(urls.some((u) => u.includes("/v1/leads/"))).toBe(false);
  });

  it("agencies see only their own bookings and an unmapped agency syncs nothing", async () => {
    await seed("org_a", "ua");
    await seed("org_b", "ub");
    await map("org_a");
    stub([booking("b1", "l1", 1)], { l1: lead("l1", "o@x.com") });
    await t.action(internal.outreachZuops.sync, { agencyId: "org_a" });
    await t.action(internal.outreachZuops.sync, { agencyId: "org_b" }); // not mapped: no-op
    expect((await as("ub", "org_b").query(api.outreachZuops.bookings, {}))).toMatchObject({ mapped: false, upcoming: [], past: [] });
    expect((await as("ua", "org_a").query(api.outreachZuops.bookings, {}))!.upcoming).toHaveLength(1);
    expect(await t.query(api.outreachZuops.bookings, {})).toBeNull();
  });

  it("a workspace can be mapped to only one agency, and ids must be UUIDs", async () => {
    await seed("org_a", "ua");
    await seed("org_b", "ub");
    await map("org_a");
    await expect(map("org_b")).rejects.toThrow(/already mapped/);
    await expect(t.mutation(internal.outreachZuops.setMapping, { agencyId: "org_b", workspaceId: "not-a-uuid", calendarId: CAL, operator: "op" })).rejects.toThrow(/UUID/);
  });

  it("a Zuops failure is recorded with a short reason and keeps the last good calendar", async () => {
    await seed("org_a", "ua");
    await map("org_a");
    stub([booking("b1", "l1", 1)], { l1: lead("l1", "o@x.com") });
    await t.action(internal.outreachZuops.sync, { agencyId: "org_a" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    await t.action(internal.outreachZuops.sync, { agencyId: "org_a" });
    const snap = (await as("ua", "org_a").query(api.outreachZuops.snapshot, {}))!;
    expect(snap.ok).toBe(false);
    expect(snap.error).toMatch(/scopes/);
    expect(snap.calendar?.name).toBe("Pulse | 30-minute demo");
  });

  it("refresh is manager-only and rate limited", async () => {
    await seed("org_a", "ua", "ustaff");
    await map("org_a");
    await expect(as("ustaff", "org_a").mutation(api.outreachZuops.refresh, {})).rejects.toThrow(/owner or admin/);
    stub([], {});
    await t.action(internal.outreachZuops.sync, { agencyId: "org_a" });
    await expect(as("ua", "org_a").mutation(api.outreachZuops.refresh, {})).rejects.toThrow(/Just refreshed/);
  });

  it("the webhook route needs the secret, a valid signature and a booking event; a valid one schedules a sync", async () => {
    const sign = async (body: string, secret: string) => {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    };
    const body = JSON.stringify({ workspace_id: WS, event: "appointment.booked" });
    const post = (headers: Record<string, string>, b = body) => t.fetch("/zuops/events", { method: "POST", headers, body: b });
    expect((await post({})).status).toBe(503); // no secret configured
    vi.stubEnv("ZUOPS_WEBHOOK_SECRET", "whsec");
    expect((await post({ "x-zuops-event": "appointment.booked" })).status).toBe(401);
    expect((await post({ "x-zuops-event": "appointment.booked", "x-zuops-signature": await sign(body, "wrong") })).status).toBe(401);
    expect((await post({ "x-zuops-event": "lead.created", "x-zuops-signature": await sign(body, "whsec") })).status).toBe(200);
    vi.useFakeTimers();
    const ok = await post({ "x-zuops-event": "appointment.booked", "x-zuops-signature": await sign(body, "whsec") });
    expect(ok.status).toBe(202);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });
});
