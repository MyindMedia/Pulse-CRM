import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { TARGET } from "./pulseWalkthrough/policy";

type Identity = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (subject: string, orgId: string): Identity => ({ subject, name: subject, orgId, orgType: "agency" });

describe("outreach - tenant scope and gates", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });
  afterEach(() => { vi.unstubAllEnvs(); });

  async function seedAgency(agencyId: string, owner: string, extra?: { staff?: string }) {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId, name: agencyId, slug: agencyId, plan: "agency", status: "active",
        ownerClerkUserId: owner, ownerEmail: `${owner}@x`,
      });
      await ctx.db.insert("agencyMembers", {
        agencyId, clerkUserId: owner, email: `${owner}@x`, name: owner,
        role: "owner", status: "active", invitedAt: 0,
      });
      if (extra?.staff) {
        await ctx.db.insert("agencyMembers", {
          agencyId, clerkUserId: extra.staff, email: `${extra.staff}@x`, name: extra.staff,
          role: "staff", status: "active", invitedAt: 0,
        });
      }
    });
  }
  const as = (subject: string, orgId: string) => t.withIdentity(idOf(subject, orgId) as never);

  it("anonymous and non-agency callers get null, never data", async () => {
    await seedAgency("org_a", "ua");
    expect(await t.query(api.outreach.overview, {})).toBeNull();
    expect(await t.query(api.outreach.communications, {})).toBeNull();
    expect(await t.query(api.outreach.meetings, {})).toBeNull();
    const stranger = t.withIdentity({ subject: "stranger", name: "S", orgId: "org_x", orgType: "studio" } as never);
    expect(await stranger.query(api.outreach.activity, {})).toBeNull();
  });

  it("setPaused is rejected for anonymous and for staff, and allowed for the owner", async () => {
    await seedAgency("org_a", "ua", { staff: "ustaff" });
    await expect(t.mutation(api.outreach.setPaused, { paused: false })).rejects.toThrow();
    await expect(as("ustaff", "org_a").mutation(api.outreach.setPaused, { paused: false })).rejects.toThrow(/owner or admin/);
    await as("ua", "org_a").mutation(api.outreach.setPaused, { paused: false });
    const o = await as("ua", "org_a").query(api.outreach.overview, {});
    expect(o?.paused).toBe(false);
    expect(o?.canManage).toBe(true);
    const staffView = await as("ustaff", "org_a").query(api.outreach.overview, {});
    expect(staffView?.canManage).toBe(false);
  });

  it("one agency never sees another agency's communications or activity", async () => {
    await seedAgency("org_a", "ua");
    await seedAgency("org_b", "ub");
    await t.mutation(internal.outreach.recordCommunication, {
      agencyId: "org_a", recipient: "a@x.com", sender: "S <s@a.com>", subject: "A secret",
      isTest: true, status: "accepted", idempotencyKey: "k1", providerId: "id-a",
    });
    const a = await as("ua", "org_a").query(api.outreach.communications, {});
    const b = await as("ub", "org_b").query(api.outreach.communications, {});
    expect(a?.map((c) => c.subject)).toEqual(["A secret"]);
    expect(b).toEqual([]);
    expect(JSON.stringify(await as("ub", "org_b").query(api.outreach.activity, {}))).not.toContain("id-a");
  });

  it("pause is per agency: pausing A leaves B untouched", async () => {
    await seedAgency("org_a", "ua");
    await seedAgency("org_b", "ub");
    await as("ua", "org_a").mutation(api.outreach.setPaused, { paused: false });
    expect((await as("ub", "org_b").query(api.outreach.overview, {}))?.paused).toBe(true);
  });

  it("communication recording is idempotent and terminal statuses are final", async () => {
    await seedAgency("org_a", "ua");
    const args = {
      agencyId: "org_a", recipient: "A@X.com", sender: "S <s@a.com>", subject: "Hi",
      isTest: true, status: "submitting" as const, idempotencyKey: "same",
    };
    const id1 = await t.mutation(internal.outreach.recordCommunication, args);
    const id2 = await t.mutation(internal.outreach.recordCommunication, args);
    expect(id2).toBe(id1);
    const rows = await as("ua", "org_a").query(api.outreach.communications, {});
    expect(rows).toHaveLength(1);
    expect(rows?.[0].recipient).toBe("a@x.com");
    const upd = (status: "accepted" | "delivered") =>
      t.mutation(internal.outreach.updateCommunicationStatus, { agencyId: "org_a", idempotencyKey: "same", status });
    expect(await upd("accepted")).toBe(true);
    expect(await upd("delivered")).toBe(true);
    expect(await upd("accepted")).toBe(false);
  });

  it("an ambiguous send is stored as unknown, counts as a failure, and is redacted", async () => {
    await seedAgency("org_a", "ua");
    await t.mutation(internal.outreach.recordCommunication, {
      agencyId: "org_a", recipient: "a@x.com", sender: "S <s@a.com>", subject: "Timeout",
      isTest: true, status: "unknown", idempotencyKey: "k-unknown",
      lastError: "timeout Bearer abcdef1234567890 re_ABCDEFGH12345678",
    });
    const o = await as("ua", "org_a").query(api.outreach.overview, {});
    expect(o?.failures).toHaveLength(1);
    const rows = await as("ua", "org_a").query(api.outreach.communications, {});
    expect(rows?.[0].lastError).not.toMatch(/abcdef1234567890|re_ABCDEFGH/);
  });

  it("meetings are hidden unless the operator mapped this agency to the integration's location", async () => {
    await seedAgency("org_a", "ua");
    await seedAgency("org_b", "ub");
    await t.run(async (ctx) => {
      await ctx.db.insert("pulseWalkthroughAppointments", {
        appointment: {
          id: "appt1", contactId: "c1", locationId: TARGET.location, calendarId: TARGET.calendar,
          start: Date.now() + 3_600_000, timezone: "America/Los_Angeles", phone: "+14085550123",
          name: "Test", status: "confirmed", consent: false, dnd: false, consentEvidence: "",
        },
        version: 1, suppressed: true,
      });
    });
    expect(await as("ua", "org_a").query(api.outreach.meetings, {})).toEqual({ mapped: false, rows: [] });
    await t.mutation(internal.outreach.setProviderMapping, {
      agencyId: "org_a", ghlLocationId: TARGET.location, ghlCalendarId: TARGET.calendar,
      bookingUrl: "https://api.leadconnectorhq.com/widget/bookings/pulse-walkthrough",
      bookingDurationMin: 30, timezone: "America/Los_Angeles", operator: "op",
    });
    const mapped = await as("ua", "org_a").query(api.outreach.meetings, {});
    expect(mapped?.mapped).toBe(true);
    expect(mapped?.rows[0].phone).toBe("••• 23");
    expect(JSON.stringify(mapped)).not.toContain("+14085550123");
    expect(mapped?.rows[0].call.state).toBe("disabled");
    expect(await as("ub", "org_b").query(api.outreach.meetings, {})).toEqual({ mapped: false, rows: [] });
  });

  it("calling stays off unless both integration flags are set", async () => {
    await seedAgency("org_a", "ua");
    const calling = async () =>
      (await as("ua", "org_a").query(api.outreach.overview, {}))?.readiness.find((r) => r.key === "calling")?.state;
    expect(await calling()).toBe("disabled");
    vi.stubEnv("PULSE_WALKTHROUGH_ENABLED", "true");
    expect(await calling()).toBe("disabled");
    vi.stubEnv("PULSE_WALKTHROUGH_SCHEMA_AUDITED", "true");
    expect(await calling()).toBe("ready");
  });

  it("changed template content supersedes the old approval", async () => {
    await seedAgency("org_a", "ua");
    const base = {
      agencyId: "org_a", key: "room", name: "The Room", subject: "S",
      bookingUrl: "https://b.example/x", source: "hot4",
    };
    await t.mutation(internal.outreach.upsertTemplate, { ...base, contentHash: "h1", approvedBy: "lawrence" });
    await t.mutation(internal.outreach.upsertTemplate, { ...base, contentHash: "h1", approvedBy: "lawrence" });
    await t.mutation(internal.outreach.upsertTemplate, { ...base, contentHash: "h2" });
    const rows = await as("ua", "org_a").query(api.outreach.templates, {});
    expect(rows?.map((r) => r.approval).sort()).toEqual(["awaiting_review", "superseded"]);
  });

  it("provider mapping rejects a non-https booking link", async () => {
    await seedAgency("org_a", "ua");
    await expect(t.mutation(internal.outreach.setProviderMapping, {
      agencyId: "org_a", ghlLocationId: "L", ghlCalendarId: "C", bookingUrl: "http://insecure.example",
      bookingDurationMin: 30, timezone: "UTC", operator: "op",
    })).rejects.toThrow(/https/);
  });
});
