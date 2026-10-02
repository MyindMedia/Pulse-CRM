import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

type Id = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (s: string, o: string): Id => ({ subject: s, name: s, orgId: o, orgType: "agency" });

describe("outreach calendar", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
  const as = (s: string, o: string) => t.withIdentity(idOf(s, o) as never);

  async function seed(agencyId: string, owner: string, staff?: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId, name: agencyId, slug: agencyId, plan: "agency", status: "active", ownerClerkUserId: owner, ownerEmail: `${owner}@x` });
      await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: owner, email: `${owner}@x`, name: owner, role: "owner", status: "active", invitedAt: 0 });
      if (staff) await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: staff, email: `${staff}@x`, name: staff, role: "staff", status: "active", invitedAt: 0 });
    });
  }
  const map = (agencyId: string) => t.mutation(internal.outreach.setProviderMapping, {
    agencyId, ghlLocationId: "loc1", ghlCalendarId: "cal1", bookingUrl: "https://api.leadconnectorhq.com/widget/bookings/pulse-walkthrough",
    bookingDurationMin: 30, timezone: "America/Los_Angeles", operator: "op",
  });
  const ghl = () => vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    if (u.includes("/free-slots")) return new Response(JSON.stringify({ "2026-10-05": { slots: ["2026-10-05T09:00:00-07:00", "2026-10-05T09:30:00-07:00"] } }));
    if (u.includes("/calendars/events")) return new Response(JSON.stringify({ events: [{ id: "e1", calendarId: "cal1", title: "Demo", startTime: new Date(Date.now() + 86_400_000).toISOString(), endTime: new Date(Date.now() + 86_400_000 + 1_800_000).toISOString(), appointmentStatus: "confirmed", contactName: "Jane" }] }));
    return new Response(JSON.stringify({ calendar: { id: "cal1", name: "Pulse Walkthrough", locationId: "loc1", isActive: true, slotDuration: 30, slotDurationUnit: "mins", widgetSlug: "pulse-walkthrough", formId: "f1", autoConfirm: true } }));
  }));

  it("refresh is owner/admin only, needs a mapping and the server key", async () => {
    await seed("org_a", "ua", "ustaff");
    await expect(as("ustaff", "org_a").mutation(api.outreachCalendar.refresh, {})).rejects.toThrow(/owner or admin/);
    await expect(as("ua", "org_a").mutation(api.outreachCalendar.refresh, {})).rejects.toThrow(/No calendar is mapped/);
    await map("org_a");
    await expect(as("ua", "org_a").mutation(api.outreachCalendar.refresh, {})).rejects.toThrow(/key is not configured/);
  });

  it("sync reads the mapped calendar and stores slots and upcoming appointments", async () => {
    await seed("org_a", "ua");
    await map("org_a");
    vi.stubEnv("PULSE_WALKTHROUGH_GHL_KEY", "pit-test");
    ghl();
    await t.action(internal.outreachCalendar._sync, { agencyId: "org_a" });
    const s = await as("ua", "org_a").query(api.outreachCalendar.snapshot, {});
    expect(s?.ok).toBe(true);
    expect(s?.calendar).toMatchObject({ name: "Pulse Walkthrough", active: true, durationMin: 30 });
    expect(s?.slots).toEqual([{ date: "2026-10-05", count: 2, first: "2026-10-05T09:00:00-07:00" }]);
    expect(s?.appointments[0]).toMatchObject({ title: "Demo", contactName: "Jane" });
    expect(JSON.stringify(s)).not.toContain("pit-test");
  });

  it("a calendar that belongs to another location is refused, and the last good data is kept", async () => {
    await seed("org_a", "ua");
    await map("org_a");
    vi.stubEnv("PULSE_WALKTHROUGH_GHL_KEY", "pit-test");
    ghl();
    await t.action(internal.outreachCalendar._sync, { agencyId: "org_a" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ calendar: { id: "cal1", name: "X", locationId: "ANOTHER", isActive: true } }))));
    await t.action(internal.outreachCalendar._sync, { agencyId: "org_a" });
    const s = await as("ua", "org_a").query(api.outreachCalendar.snapshot, {});
    expect(s?.ok).toBe(false);
    expect(s?.error).toMatch(/different GHL location/);
    expect(s?.calendar?.name).toBe("Pulse Walkthrough"); // last good snapshot kept
  });

  it("a refused key is reported and does not leak", async () => {
    await seed("org_a", "ua");
    await map("org_a");
    vi.stubEnv("PULSE_WALKTHROUGH_GHL_KEY", "pit-secret-value");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    await t.action(internal.outreachCalendar._sync, { agencyId: "org_a" });
    const s = await as("ua", "org_a").query(api.outreachCalendar.snapshot, {});
    expect(s?.error).toBe("GHL refused the key (HTTP 401)");
    expect(JSON.stringify(s)).not.toContain("pit-secret-value");
  });

  it("another agency never sees this snapshot, and anonymous gets null", async () => {
    await seed("org_a", "ua");
    await seed("org_b", "ub");
    await map("org_a");
    vi.stubEnv("PULSE_WALKTHROUGH_GHL_KEY", "pit-test");
    ghl();
    await t.action(internal.outreachCalendar._sync, { agencyId: "org_a" });
    const b = await as("ub", "org_b").query(api.outreachCalendar.snapshot, {});
    expect(b?.calendar).toBeNull();
    expect(b?.appointments).toEqual([]);
    expect(await t.query(api.outreachCalendar.snapshot, {})).toBeNull();
  });
});
